// Worker de synchronisation réel (worker/src/index.js) branché sur un KV en
// mémoire, exposé comme une fonction fetch pour les tests du client.
import worker from '../../worker/src/index.js';

export function memoryKV() {
  const map = new Map();
  const meta = new Map();
  return {
    map,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async getWithMetadata(key) { return { value: map.has(key) ? map.get(key) : null, metadata: meta.get(key) || null }; },
    async put(key, value, opts) { map.set(key, value); if (opts && opts.metadata) meta.set(key, opts.metadata); },
    async delete(key) { map.delete(key); meta.delete(key); },
  };
}

export function createServer() {
  const env = { SYNC_KV: memoryKV(), ALLOWED_ORIGIN: '*' };
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers });
    return worker.fetch(new Request(url, init), env);
  };
  return { env, fetch, requests };
}
