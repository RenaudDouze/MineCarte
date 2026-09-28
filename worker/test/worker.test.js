// @vitest-environment node
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import worker, {
  kvKey, blobKey, referencedHashes, isValidPushRequest, MAX_BODY_BYTES, MAX_BLOB_BYTES, KV_TTL_SECONDS,
} from '../src/index.js';
import { generateSyncCode, isValidSyncCode, normalizeSyncCode, ALPHABET, CODE_LENGTH } from '../src/code.js';

function memoryKV() {
  const map = new Map();
  const meta = new Map();
  const log = [];
  return {
    map,
    meta,
    log,
    async get(key, opts) { log.push(['get', key, opts]); return map.has(key) ? map.get(key) : null; },
    async getWithMetadata(key, opts) { log.push(['getWithMetadata', key, opts]); return { value: map.has(key) ? map.get(key) : null, metadata: meta.get(key) ?? null }; },
    async put(key, value, opts) { log.push(['put', key, opts]); map.set(key, value); if (opts && opts.metadata) meta.set(key, opts.metadata); },
    async delete(key) { log.push(['delete', key]); map.delete(key); meta.delete(key); },
  };
}

const env = (extra = {}) => ({ SYNC_KV: memoryKV(), ALLOWED_ORIGIN: 'https://renauddouze.github.io/MineCarte', ...extra });
const call = (e, method, path, body, headers) => worker.fetch(new Request(`https://w.example${path}`, {
  method,
  headers,
  body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
}), e);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const create = async (e) => (await (await call(e, 'POST', '/api/sync')).json()).code;

afterEach(() => vi.restoreAllMocks());

// Remplit les octets aléatoires avec une suite fixée (puis 0).
function randomBytes(seq) {
  let i = 0;
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((arr) => { arr[0] = i < seq.length ? seq[i++] : 0; return arr; });
}

describe('codes', () => {
  test('constantes', () => {
    expect(ALPHABET).toBe('ABCDEFGHJKMNPQRSTWXYZ23456789');
    expect(CODE_LENGTH).toBe(8);
  });

  test('génération : échantillonnage par rejet au-delà de 231', () => {
    randomBytes([0, 232, 255, 28, 29, 231, 57, 58, 1, 100]);
    // 0→A, 232 et 255 rejetés, 28→9, 29→A, 231→9, 57→9, 58→A, 1→B
    expect(generateSyncCode()).toBe('A9A99AB' + ALPHABET[100 % 29]);
  });

  test('génération : toujours valide', () => {
    for (let i = 0; i < 200; i++) expect(isValidSyncCode(generateSyncCode())).toBe(true);
  });

  test('normalisation et validation', () => {
    expect(normalizeSyncCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizeSyncCode('a\tb\nc')).toBe('ABC');
    expect(isValidSyncCode('ABCDEFGH')).toBe(true);
    expect(isValidSyncCode('ABCDEFG0')).toBe(false);
    expect(isValidSyncCode('ABCDEFG')).toBe(false);
    expect(isValidSyncCode('ABCDEFGHJ')).toBe(false);
    expect(isValidSyncCode('xABCDEFGH')).toBe(false);
    expect(isValidSyncCode('ABCDEFGHx')).toBe(false);
  });
});

describe('fonctions exportées', () => {
  test('clés KV', () => {
    expect(kvKey('ABCDEFGH')).toBe('sync:ABCDEFGH');
    expect(blobKey('ABCDEFGH', 'ff')).toBe('blob:ABCDEFGH:ff');
  });

  test('constantes', () => {
    expect(MAX_BODY_BYTES).toBe(512 * 1024);
    expect(MAX_BLOB_BYTES).toBe(20 * 1024 * 1024);
    expect(KV_TTL_SECONDS).toBe(180 * 24 * 3600);
  });

  test('isValidPushRequest', () => {
    expect(isValidPushRequest({ baseVersion: 0, data: {} })).toBe(true);
    expect(isValidPushRequest({ baseVersion: 3, data: { pois: [] } })).toBe(true);
    expect(isValidPushRequest(null)).toBe(false);
    expect(isValidPushRequest('x')).toBe(false);
    expect(isValidPushRequest({ baseVersion: 1.5, data: {} })).toBe(false);
    expect(isValidPushRequest({ baseVersion: '1', data: {} })).toBe(false);
    expect(isValidPushRequest({ baseVersion: 1 })).toBe(false);
    expect(isValidPushRequest({ baseVersion: 1, data: null })).toBe(false);
    expect(isValidPushRequest({ baseVersion: 1, data: 'x' })).toBe(false);
    expect(isValidPushRequest({ baseVersion: 1, data: [] })).toBe(false);
  });

  test('referencedHashes', () => {
    const h = 'a'.repeat(64);
    expect([...referencedHashes({ backgrounds: [{ hash: h }, { hash: h }, { hash: 'nope' }, { hash: 5 }, null, {}, { hash: `${h}0` }, { hash: `x${h}` }] })]).toEqual([h]);
    expect([...referencedHashes(null)]).toEqual([]);
    expect([...referencedHashes({ backgrounds: 'x' })]).toEqual([]);
    expect([...referencedHashes({ backgrounds: [[{ hash: h }]] })]).toEqual([]);
    expect([...referencedHashes({})]).toEqual([]);
  });
});

describe('CORS', () => {
  test('pré-requête OPTIONS', async () => {
    const res = await call(env(), 'OPTIONS', '/n-importe-ou');
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'access-control-allow-origin': 'https://renauddouze.github.io',
      'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    });
  });

  test('origine autorisée : absente, étoile ou invalide → *', async () => {
    const origin = async (extra) => (await call(env(extra), 'GET', '/api/sync/AAAAAAAA')).headers.get('Access-Control-Allow-Origin');
    expect(await origin({ ALLOWED_ORIGIN: undefined })).toBe('*');
    expect(await origin({ ALLOWED_ORIGIN: '' })).toBe('*');
    expect(await origin({ ALLOWED_ORIGIN: '*' })).toBe('*');
    expect(await origin({ ALLOWED_ORIGIN: 'pas une url' })).toBe('*');
    expect(await origin({ ALLOWED_ORIGIN: 'https://ex.com/chemin/' })).toBe('https://ex.com');
  });

  test('réponses JSON avec en-têtes CORS', async () => {
    const res = await call(env(), 'GET', '/api/sync/AAAAAAAA');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, PUT, POST, OPTIONS');
    expect(await res.json()).toEqual({ error: 'Code inconnu ou expiré.' });
  });
});

describe('routage', () => {
  test('chemins et méthodes inconnus', async () => {
    const e = env();
    const code = await create(e);
    const cases = [
      ['GET', '/', 404, 'Not found'],
      ['GET', '/api', 404, 'Not found'],
      ['GET', '/api/autre', 404, 'Not found'],
      ['GET', '/autre/sync', 404, 'Not found'],
      ['GET', '/api/sync', 405, 'Method not allowed'],
      ['DELETE', `/api/sync/${code}`, 405, 'Method not allowed'],
      ['GET', `/api/sync/${code}/x`, 404, 'Not found'],
      ['GET', `/api/sync/${code}/autre/${'a'.repeat(64)}`, 404, 'Not found'],
      ['GET', `/api/sync/${code}/blob/${'a'.repeat(64)}/x`, 404, 'Not found'],
      ['DELETE', `/api/sync/${code}/blob/${'a'.repeat(64)}`, 405, 'Method not allowed'],
      ['GET', '/api/sync/0000', 400, 'Code invalide.'],
      ['GET', `/api/sync/0000/blob/${'a'.repeat(64)}`, 400, 'Code ou empreinte invalide.'],
      ['GET', `/api/sync/${code}/blob/abc`, 400, 'Code ou empreinte invalide.'],
    ];
    for (const [method, path, status, error] of cases) {
      const res = await call(e, method, path);
      expect([method, path, res.status]).toEqual([method, path, status]);
      expect(await res.json()).toEqual({ error });
    }
  });

  test('erreur interne : 500 avec le détail, en-têtes CORS conservés', async () => {
    const e = env();
    e.SYNC_KV.get = async () => { throw new Error('KV absent'); };
    let res = await call(e, 'GET', '/api/sync/AAAAAAAA');
    expect(res.status).toBe(500);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://renauddouze.github.io');
    expect(await res.json()).toEqual({ error: 'Erreur interne du serveur.', detail: 'KV absent' });
    e.SYNC_KV.get = async () => { throw 'texte'; };
    res = await call(e, 'GET', '/api/sync/AAAAAAAA');
    expect(await res.json()).toEqual({ error: 'Erreur interne du serveur.', detail: 'texte' });
  });
});

describe('codes de synchronisation', () => {
  test('création : version 0, sans données, expiration 180 jours', async () => {
    const e = env();
    const res = await call(e, 'POST', '/api/sync');
    expect(res.status).toBe(201);
    const { code } = await res.json();
    expect(isValidSyncCode(code)).toBe(true);
    expect(JSON.parse(e.SYNC_KV.map.get(`sync:${code}`))).toEqual({ version: 0, data: null });
    expect(e.SYNC_KV.log.find((op) => op[0] === 'put')).toEqual(['put', `sync:${code}`, { expirationTtl: KV_TTL_SECONDS }]);
  });

  test('création : collision → nouvel essai, abandon après 5', async () => {
    const e = env();
    e.SYNC_KV.map.set('sync:AAAAAAAA', '{}');
    randomBytes([...Array(8).fill(0), ...Array(8).fill(1)]);
    const res = await call(e, 'POST', '/api/sync');
    expect(await res.json()).toEqual({ code: 'BBBBBBBB' });

    const full = env();
    full.SYNC_KV.map.set('sync:AAAAAAAA', '{}');
    randomBytes([]);
    const failed = await call(full, 'POST', '/api/sync');
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Impossible de générer un code, réessaie.' });
    expect(full.SYNC_KV.log.filter((op) => op[0] === 'get')).toHaveLength(5);
    expect(full.SYNC_KV.log.filter((op) => op[0] === 'put')).toHaveLength(0);
  });

  test('lecture', async () => {
    const e = env();
    const code = await create(e);
    const res = await call(e, 'GET', `/api/sync/${code.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 0, data: null });
    expect((await call(e, 'GET', '/api/sync/AAAAAAAA')).status).toBe(404);
  });

  test('écriture optimiste : version attendue, incrément, conflit', async () => {
    const e = env();
    const code = await create(e);
    let res = await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 0, data: { pois: [1] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1, data: { pois: [1] } });
    expect(e.SYNC_KV.log.filter((op) => op[0] === 'put').at(-1)).toEqual(['put', `sync:${code}`, { expirationTtl: KV_TTL_SECONDS }]);
    res = await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 0, data: { pois: [2] } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ version: 1, data: { pois: [1] } });
    res = await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 2, data: { pois: [2] } });
    expect(res.status).toBe(409);
    res = await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 1, data: { pois: [3] } });
    expect(await res.json()).toEqual({ version: 2, data: { pois: [3] } });
  });

  test('écriture : erreurs de format, de taille et de code', async () => {
    const e = env();
    const code = await create(e);
    const put = (body) => call(e, 'PUT', `/api/sync/${code}`, body);
    let res = await put('pas du json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'JSON invalide.' });
    res = await put({ baseVersion: 0, data: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Format invalide (baseVersion et data requis).' });
    res = await call(e, 'PUT', '/api/sync/AAAAAAAA', { baseVersion: 0, data: {} });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Code inconnu ou expiré.' });
    // Taille : le corps réel compte, limite incluse.
    const payload = (size) => {
      const base = JSON.stringify({ baseVersion: 0, data: { s: '' } });
      return JSON.stringify({ baseVersion: 0, data: { s: 'x'.repeat(size - base.length) } });
    };
    expect(payload(MAX_BODY_BYTES)).toHaveLength(MAX_BODY_BYTES);
    expect((await put(payload(MAX_BODY_BYTES))).status).toBe(200);
    res = await put(payload(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Trop volumineux.' });
  });
});

describe('images des fonds', () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const hash = sha(png);

  test('envoi puis lecture, avec type et cache immuable', async () => {
    const e = env();
    const code = await create(e);
    let res = await call(e, 'PUT', `/api/sync/${code}/blob/${hash.toUpperCase()}`, png, { 'Content-Type': 'Image/PNG ; charset=binary' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ hash });
    expect(e.SYNC_KV.log.filter((op) => op[0] === 'put').at(-1)).toEqual(['put', `blob:${code}:${hash}`, { metadata: { type: 'image/png' } }]);
    res = await call(e, 'GET', `/api/sync/${code.toLowerCase()}/blob/${hash}`);
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, max-age=31536000, immutable',
      'access-control-allow-origin': 'https://renauddouze.github.io',
    });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect(e.SYNC_KV.log.at(-1)).toEqual(['getWithMetadata', `blob:${code}:${hash}`, { type: 'arrayBuffer' }]);
  });

  test('JPEG et WebP acceptés, déjà présente : pas de réécriture', async () => {
    const e = env();
    const code = await create(e);
    const jpg = new Uint8Array([1]);
    expect((await call(e, 'PUT', `/api/sync/${code}/blob/${sha(jpg)}`, jpg, { 'Content-Type': 'image/jpeg' })).status).toBe(201);
    const webp = new Uint8Array([2]);
    expect((await call(e, 'PUT', `/api/sync/${code}/blob/${sha(webp)}`, webp, { 'Content-Type': 'image/webp' })).status).toBe(201);
    const writes = e.SYNC_KV.log.filter((op) => op[0] === 'put').length;
    const again = await call(e, 'PUT', `/api/sync/${code}/blob/${sha(jpg)}`, jpg, { 'Content-Type': 'image/jpeg' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ hash: sha(jpg) });
    expect(e.SYNC_KV.log.filter((op) => op[0] === 'put')).toHaveLength(writes);
    expect(e.SYNC_KV.log.at(-1)).toEqual(['get', `blob:${code}:${sha(jpg)}`, { type: 'stream' }]);
  });

  test('refus : code inconnu, type, taille, empreinte', async () => {
    const e = env();
    const code = await create(e);
    const put = (body, h = hash, headers = { 'Content-Type': 'image/png' }) => call(e, 'PUT', `/api/sync/${code}/blob/${h}`, body, headers);
    let res = await call(e, 'PUT', `/api/sync/AAAAAAAA/blob/${hash}`, png, { 'Content-Type': 'image/png' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Code inconnu ou expiré.' });
    res = await put(png, hash, { 'Content-Type': 'image/gif' });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Type d’image non pris en charge.' });
    expect((await put(png, hash, {})).status).toBe(415);
    res = await put(new Uint8Array([9]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Empreinte SHA-256 incorrecte.' });
    const max = new Uint8Array(MAX_BLOB_BYTES);
    expect((await put(max, sha(max))).status).toBe(201);
    const big = new Uint8Array(MAX_BLOB_BYTES + 1);
    res = await put(big, sha(big));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Image trop volumineuse.' });
  });

  test('lecture : absente → 404, sans type enregistré → octet-stream', async () => {
    const e = env();
    const code = await create(e);
    const res = await call(e, 'GET', `/api/sync/${code}/blob/${hash}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Image introuvable.' });
    e.SYNC_KV.map.set(`blob:${code}:${hash}`, png.buffer);
    expect((await call(e, 'GET', `/api/sync/${code}/blob/${hash}`)).headers.get('Content-Type')).toBe('application/octet-stream');
  });

  test('nettoyage : image supprimée quand plus aucune version ne la référence', async () => {
    const e = env();
    const code = await create(e);
    await call(e, 'PUT', `/api/sync/${code}/blob/${hash}`, png, { 'Content-Type': 'image/png' });
    const other = sha(new Uint8Array([5]));
    const data = (hashes) => ({ backgrounds: hashes.map((h, i) => ({ id: `b${i}`, hash: h })) });
    await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 0, data: data([hash, other]) });
    await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 1, data: data([hash]) });
    expect(e.SYNC_KV.log.filter((op) => op[0] === 'delete')).toEqual([['delete', `blob:${code}:${other}`]]);
    expect(e.SYNC_KV.map.has(`blob:${code}:${hash}`)).toBe(true);
    await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 2, data: data([]) });
    expect(e.SYNC_KV.map.has(`blob:${code}:${hash}`)).toBe(false);
  });
});
