/*
 * Worker de synchronisation MineCarte (Cloudflare Workers + KV).
 *
 *   POST /api/sync          → crée un code            → 201 { code }
 *   GET  /api/sync/:code    → état stocké             → 200 { version, data } | 404
 *   PUT  /api/sync/:code    ← { baseVersion, data }   → 200 { version, data } | 409 { version, data }
 *
 * Écriture optimiste façon « compare-and-swap » : un PUT n'est accepté que si
 * baseVersion est exactement la version stockée ; sinon 409 avec l'état
 * serveur, que le client fusionne avant de repousser. La version est un
 * entier attribué par le serveur, jamais une horloge client.
 */
import { generateSyncCode, isValidSyncCode, normalizeSyncCode } from './code.js';

// Largement suffisant pour des milliers de POI et de chemins.
export const MAX_BODY_BYTES = 512 * 1024;
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

// Les images des fonds importés (fonctionnalité retirée) étaient stockées sous
// blob:<code>:<sha256> et référencées par data.backgrounds. Les clients actuels
// n'envoient plus de fonds : au premier PUT qui les retire, leurs images sont
// supprimées du stockage (voir handlePut).
export function referencedHashes(data) {
  // test() convertit en chaîne : ni undefined, ni un nombre ne passent.
  return new Set([data?.backgrounds].flat().map((bg) => bg?.hash).filter((h) => HASH_RE.test(h)));
}

export function isValidPushRequest(value) {
  return Number.isInteger(value?.baseVersion)
    && !!value.data && typeof value.data === 'object' && !Array.isArray(value.data);
}

// Access-Control-Allow-Origin n'accepte qu'une origine nue (schéma + hôte).
// Absente, « * » ou invalide : new URL échoue et on autorise tout.
function allowedOrigin(env) {
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

  // Images d'anciens fonds qui ne sont plus référencées : on libère la place.
  const kept = referencedHashes(next.data);
  for (const hash of referencedHashes(current.data)) {
    if (!kept.has(hash)) await env.SYNC_KV.delete(blobKey(code, hash));
  }
  return json(next, 200, env);
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
