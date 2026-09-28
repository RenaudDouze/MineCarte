import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { kvKey, MAX_BODY_BYTES } from '../src/index.js';
import { generateSyncCode, isValidSyncCode, normalizeSyncCode } from '../src/code.js';

function memoryKV() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value) { map.set(key, value); },
  };
}

const env = () => ({ SYNC_KV: memoryKV(), ALLOWED_ORIGIN: 'https://renauddouze.github.io/MineCarte' });
const call = (e, method, path, body) => worker.fetch(new Request(`https://w.example${path}`, {
  method,
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
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
