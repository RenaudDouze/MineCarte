import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker, { kvKey, blobKey, MAX_BODY_BYTES, MAX_BLOB_BYTES } from '../src/index.js';
import { generateSyncCode, isValidSyncCode, normalizeSyncCode } from '../src/code.js';

function memoryKV() {
  const map = new Map();
  const meta = new Map();
  return {
    map,
    writes: 0,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async getWithMetadata(key) { return { value: map.has(key) ? map.get(key) : null, metadata: meta.get(key) || null }; },
    async put(key, value, opts) { this.writes++; map.set(key, value); if (opts && opts.metadata) meta.set(key, opts.metadata); },
    async delete(key) { this.writes++; map.delete(key); meta.delete(key); },
  };
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const env = () => ({ SYNC_KV: memoryKV(), ALLOWED_ORIGIN: 'https://renauddouze.github.io/MineCarte' });
const call = (e, method, path, body, headers) => worker.fetch(new Request(`https://w.example${path}`, {
  method,
  headers,
  body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
}), e);

test('codes : génération, normalisation, validation', () => {
  for (let i = 0; i < 200; i++) assert.ok(isValidSyncCode(generateSyncCode()));
  assert.equal(normalizeSyncCode(' abcd-efgh '), 'ABCDEFGH');
  assert.ok(!isValidSyncCode('ABCDEFG0'));
  assert.ok(!isValidSyncCode('ABCDEFG'));
});

test('création, lecture, écriture optimiste', async () => {
  const e = env();
  const created = await call(e, 'POST', '/api/sync');
  assert.equal(created.status, 201);
  const { code } = await created.json();
  assert.ok(e.SYNC_KV.map.has(kvKey(code)));

  let res = await call(e, 'GET', `/api/sync/${code.toLowerCase()}`);
  assert.deepEqual(await res.json(), { version: 0, data: null });

  res = await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 0, data: { pois: [1] } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { version: 1, data: { pois: [1] } });

  // Version de base périmée : refus avec l'état serveur.
  res = await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 0, data: { pois: [2] } });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { version: 1, data: { pois: [1] } });

  res = await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 1, data: { pois: [3] } });
  assert.deepEqual(await res.json(), { version: 2, data: { pois: [3] } });
});

test('erreurs', async () => {
  const e = env();
  assert.equal((await call(e, 'GET', '/api/sync/AAAAAAAA')).status, 404);
  assert.equal((await call(e, 'PUT', '/api/sync/AAAAAAAA', { baseVersion: 0, data: {} })).status, 404);
  assert.equal((await call(e, 'GET', '/api/sync/0000')).status, 400);
  assert.equal((await call(e, 'GET', '/api/sync')).status, 405);
  assert.equal((await call(e, 'GET', '/autre')).status, 404);

  const { code } = await (await call(e, 'POST', '/api/sync')).json();
  assert.equal((await call(e, 'PUT', `/api/sync/${code}`, 'pas du json')).status, 400);
  assert.equal((await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 0, data: [] })).status, 400);
  assert.equal((await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 0, data: { s: 'x'.repeat(MAX_BODY_BYTES) } })).status, 413);
});

test('CORS', async () => {
  const res = await call(env(), 'OPTIONS', '/api/sync');
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://renauddouze.github.io');
  const open = await call({ SYNC_KV: memoryKV() }, 'GET', '/api/sync/AAAAAAAA');
  assert.equal(open.headers.get('Access-Control-Allow-Origin'), '*');
});

test('images : envoi, lecture, déduplication, nettoyage', async () => {
  const e = env();
  const { code } = await (await call(e, 'POST', '/api/sync')).json();
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const hash = sha(png);
  const put = (body, h = hash, type = 'image/png') => call(e, 'PUT', `/api/sync/${code}/blob/${h}`, body, { 'Content-Type': type });

  assert.equal((await put(png)).status, 201);
  assert.equal(e.SYNC_KV.map.has(blobKey(code, hash)), true);
  const writes = e.SYNC_KV.writes;
  assert.equal((await put(png)).status, 200, 'déjà présente');
  assert.equal(e.SYNC_KV.writes, writes, 'pas de nouvelle écriture');

  const res = await call(e, 'GET', `/api/sync/${code}/blob/${hash}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), png);

  // Erreurs
  assert.equal((await put(new Uint8Array([1, 2, 3]))).status, 400, 'empreinte fausse');
  assert.equal((await put(png, hash, 'text/plain')).status, 415);
  assert.equal((await put(png, 'abc')).status, 400);
  assert.equal((await call(e, 'GET', `/api/sync/${code}/blob/${'0'.repeat(64)}`)).status, 404);
  assert.equal((await call(e, 'PUT', `/api/sync/AAAAAAAA/blob/${hash}`, png, { 'Content-Type': 'image/png' })).status, 404);
  const big = new Uint8Array(MAX_BLOB_BYTES + 1);
  assert.equal((await put(big, sha(big))).status, 413);

  // L'image référencée reste, puis est supprimée quand plus rien ne la référence.
  const bg = { id: 'b1', hash };
  assert.equal((await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 0, data: { backgrounds: [bg] } })).status, 200);
  assert.equal(e.SYNC_KV.map.has(blobKey(code, hash)), true);
  assert.equal((await call(e, 'PUT', `/api/sync/${code}`, { baseVersion: 1, data: { backgrounds: [] } })).status, 200);
  assert.equal(e.SYNC_KV.map.has(blobKey(code, hash)), false);
});
