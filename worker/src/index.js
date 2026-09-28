/*
 * Worker de synchronisation MineCarte (Cloudflare Workers + KV).
 *
 *   POST /api/sync          → crée un code            → 201 { code }
 *   GET  /api/sync/:code    → état stocké             → 200 { version, data } | 404
 *   PUT  /api/sync/:code    ← { baseVersion, data }   → 200 { version, data } | 409 { version, data }
 *   PUT  /api/sync/:code/blob/:sha256  ← image           → 201 | 200 (déjà présente)
 *   GET  /api/sync/:code/blob/:sha256  → image           → 200 | 404
 *
 * Les images des fonds de carte sont stockées à part, une clé par image,
 * adressées par leur empreinte SHA-256 (vérifiée à l'envoi). data.backgrounds
 * ne contient que leurs métadonnées ; quand une image n'y est plus référencée,
 * elle est supprimée du stockage.
 *
 * Écriture optimiste façon « compare-and-swap » : un PUT n'est accepté que si
 * baseVersion est exactement la version stockée ; sinon 409 avec l'état
 * serveur, que le client fusionne avant de repousser. La version est un
 * entier attribué par le serveur, jamais une horloge client.
 */
import { generateSyncCode, isValidSyncCode, normalizeSyncCode } from './code.js';

// Largement suffisant pour des milliers de POI et de chemins.
export const MAX_BODY_BYTES = 512 * 1024;
// Taille maximale d'une image de fond (la limite d'une valeur KV est 25 Mio).
export const MAX_BLOB_BYTES = 20 * 1024 * 1024;
const BLOB_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const HASH_RE = /^[0-9a-f]{64}$/;
// Un code inutilisé pendant 180 jours expire.
export const KV_TTL_SECONDS = 60 * 60 * 24 * 180;
const CREATE_ATTEMPTS = 5;

export function kvKey(code) {
  return `sync:${code}`;
}

export function blobKey(code, hash) {
  return `blob:${code}:${hash}`;
}

// Empreintes des images référencées par des données synchronisées.
export function referencedHashes(data) {
  const list = data && Array.isArray(data.backgrounds) ? data.backgrounds : [];
  return new Set(list.map((bg) => bg && bg.hash).filter((h) => typeof h === 'string' && HASH_RE.test(h)));
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isValidPushRequest(value) {
  return !!value && typeof value === 'object'
    && Number.isInteger(value.baseVersion)
    && !!value.data && typeof value.data === 'object' && !Array.isArray(value.data);
}

// Access-Control-Allow-Origin n'accepte qu'une origine nue (schéma + hôte).
function allowedOrigin(env) {
  if (!env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN === '*') return '*';
  try {
    return new URL(env.ALLOWED_ORIGIN).origin;
  } catch {
    return '*';
  }
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(env),
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

async function handleCreate(env) {
  for (let i = 0; i < CREATE_ATTEMPTS; i++) {
    const code = generateSyncCode();
    if (await env.SYNC_KV.get(kvKey(code)) !== null) continue;
    // Version 0 = rien de poussé : le premier PUT doit envoyer baseVersion 0.
    await env.SYNC_KV.put(kvKey(code), JSON.stringify({ version: 0, data: null }), { expirationTtl: KV_TTL_SECONDS });
    return json({ code }, 201, env);
  }
  return json({ error: 'Impossible de générer un code, réessaie.' }, 500, env);
}

async function handleGet(env, code) {
  const stored = await env.SYNC_KV.get(kvKey(code));
  if (stored === null) return json({ error: 'Code inconnu ou expiré.' }, 404, env);
  return json(JSON.parse(stored), 200, env);
}

async function handlePut(request, env, code) {
  // Taille réelle du corps, pas l'en-tête Content-Length (absent ou mensonger).
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return json({ error: 'Trop volumineux.' }, 413, env);

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json({ error: 'JSON invalide.' }, 400, env);
  }
  if (!isValidPushRequest(payload)) {
    return json({ error: 'Format invalide (baseVersion et data requis).' }, 400, env);
  }

  const raw = await env.SYNC_KV.get(kvKey(code));
  if (raw === null) return json({ error: 'Code inconnu ou expiré.' }, 404, env);
  const current = JSON.parse(raw);
  if (payload.baseVersion !== current.version) return json(current, 409, env);

  const next = { version: current.version + 1, data: payload.data };
  await env.SYNC_KV.put(kvKey(code), JSON.stringify(next), { expirationTtl: KV_TTL_SECONDS });

  // Images qui ne sont plus référencées : on libère la place.
  const kept = referencedHashes(next.data);
  for (const hash of referencedHashes(current.data)) {
    if (!kept.has(hash)) await env.SYNC_KV.delete(blobKey(code, hash));
  }
  return json(next, 200, env);
}

async function handlePutBlob(request, env, code, hash) {
  if (await env.SYNC_KV.get(kvKey(code)) === null) return json({ error: 'Code inconnu ou expiré.' }, 404, env);
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!BLOB_TYPES.includes(type)) return json({ error: 'Type d’image non pris en charge.' }, 415, env);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BLOB_BYTES) return json({ error: 'Image trop volumineuse.' }, 413, env);
  if (await sha256Hex(body) !== hash) return json({ error: 'Empreinte SHA-256 incorrecte.' }, 400, env);
  // Déjà présente (même contenu) : pas d'écriture, le quota KV est limité.
  if (await env.SYNC_KV.get(blobKey(code, hash), { type: 'stream' }) !== null) return json({ hash }, 200, env);
  await env.SYNC_KV.put(blobKey(code, hash), body, { metadata: { type } });
  return json({ hash }, 201, env);
}

async function handleGetBlob(env, code, hash) {
  const { value, metadata } = await env.SYNC_KV.getWithMetadata(blobKey(code, hash), { type: 'arrayBuffer' });
  if (value === null) return json({ error: 'Image introuvable.' }, 404, env);
  return new Response(value, {
    status: 200,
    headers: {
      'Content-Type': (metadata && metadata.type) || 'application/octet-stream',
      // Contenu adressé par son empreinte : il ne change jamais.
      'Cache-Control': 'private, max-age=31536000, immutable',
      ...corsHeaders(env),
    },
  });
}

async function route(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });

  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  if (segments[0] !== 'api' || segments[1] !== 'sync') return json({ error: 'Not found' }, 404, env);

  if (segments.length === 2) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, env);
    return handleCreate(env);
  }
  if (segments.length === 3) {
    const code = normalizeSyncCode(segments[2]);
    if (!isValidSyncCode(code)) return json({ error: 'Code invalide.' }, 400, env);
    if (request.method === 'GET') return handleGet(env, code);
    if (request.method === 'PUT') return handlePut(request, env, code);
    return json({ error: 'Method not allowed' }, 405, env);
  }
  if (segments.length === 5 && segments[3] === 'blob') {
    const code = normalizeSyncCode(segments[2]);
    const hash = segments[4].toLowerCase();
    if (!isValidSyncCode(code) || !HASH_RE.test(hash)) return json({ error: 'Code ou empreinte invalide.' }, 400, env);
    if (request.method === 'GET') return handleGetBlob(env, code, hash);
    if (request.method === 'PUT') return handlePutBlob(request, env, code, hash);
    return json({ error: 'Method not allowed' }, 405, env);
  }
  return json({ error: 'Not found' }, 404, env);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      // Répondre nous-mêmes garde les en-têtes CORS : sinon le navigateur ne
      // voit qu'une erreur réseau, sans aucun détail.
      return json({ error: 'Erreur interne du serveur.', detail: err instanceof Error ? err.message : String(err) }, 500, env);
    }
  },
};
