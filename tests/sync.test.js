import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from './helpers/server.js';

let CloudSync;
let Store;
beforeAll(async () => {
  await import('../js/store.js');
  await import('../js/sync.js');
  CloudSync = window.CloudSync;
  Store = window.Store;
});

const URL_ = 'https://sync.test';
const STATE_KEY = 'minecarte:sync';
const sha = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

let server;
let store;
let statuses;
let sync;

// Chaque appareil démarre avec son propre stockage : jsdom n'a qu'un
// localStorage, on le vide avant de construire l'appareil (Store et CloudSync
// ne relisent le stockage qu'à la construction).
function device({ url = URL_ } = {}) {
  localStorage.clear();
  const s = new Store();
  const st = [];
  const cs = new CloudSync(s, url, (status) => st.push({ ...status }));
  return { store: s, statuses: st, sync: cs };
}

beforeEach(() => {
  localStorage.clear();
  server = createServer();
  vi.stubGlobal('fetch', server.fetch);
  ({ store, statuses, sync } = device());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const lastStatus = () => statuses.at(-1);
const serverState = (code) => JSON.parse(server.env.SYNC_KV.map.get(`sync:${code}`));

describe('fonctions pures', () => {
  test('stable : clés triées, undefined ≡ null', () => {
    const { stable } = CloudSync;
    expect(stable({ b: 1, a: [2, { d: null, c: 'x' }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(stable({ a: 1, b: 2 })).toBe(stable({ b: 2, a: 1 }));
    expect(stable(undefined)).toBe('null');
    expect(stable([undefined, 0, false, ''])).toBe('[null,0,false,""]');
    expect(stable('texte')).toBe('"texte"');
    expect(stable({})).toBe('{}');
    expect(stable([])).toBe('[]');
  });

  test('formatCode', () => {
    expect(CloudSync.formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(CloudSync.formatCode(null)).toBe('');
    expect(CloudSync.formatCode('')).toBe('');
  });

  describe('merge (trois voies, par identifiant)', () => {
    const merge = (...args) => CloudSync.merge(...args);
    const P = (id, name) => ({ id, name });

    test('le côté modifié gagne ; les deux modifiés : le local gagne', () => {
      const base = { seed: 's', pois: [P('a', 'A'), P('b', 'B'), P('c', 'C')], paths: [] };
      const local = { seed: 's', pois: [P('a', 'A-local'), P('b', 'B'), P('c', 'C-local')], paths: [] };
      const remote = { seed: 's', pois: [P('a', 'A'), P('b', 'B-remote'), P('c', 'C-remote')], paths: [] };
      expect(merge(base, local, remote).pois).toEqual([P('a', 'A-local'), P('b', 'B-remote'), P('c', 'C-local')]);
    });

    test('ajouts des deux côtés, ordre : distant puis local', () => {
      const r = merge({ pois: [] }, { pois: [P('l', 'L')] }, { pois: [P('r', 'R')] });
      expect(r.pois).toEqual([P('r', 'R'), P('l', 'L')]);
    });

    test('suppressions : absent d’un côté et inchangé de l’autre = supprimé', () => {
      const base = { paths: [P('a', 'A'), P('b', 'B')] };
      expect(merge(base, { paths: [P('b', 'B')] }, { paths: [P('a', 'A'), P('b', 'B')] }).paths).toEqual([P('b', 'B')]);
      expect(merge(base, { paths: [P('a', 'A'), P('b', 'B')] }, { paths: [P('a', 'A')] }).paths).toEqual([P('a', 'A')]);
      // Supprimé d'un côté mais modifié de l'autre : la modification l'emporte.
      expect(merge(base, { paths: [P('a', 'A2'), P('b', 'B')] }, { paths: [P('b', 'B')] }).paths).toEqual([P('b', 'B'), P('a', 'A2')]);
    });

    test('sans base (rejoindre un code) : union, le local gagne en cas de conflit', () => {
      const r = merge(null, { seed: 'l', pois: [P('x', 'local'), P('y', 'Y')] }, { seed: 'r', pois: [P('x', 'distant'), P('z', 'Z')] });
      expect(r.pois).toEqual([P('x', 'local'), P('z', 'Z'), P('y', 'Y')]);
      expect(r.seed).toBe('l');
    });

    test('graine : même règle ; graine distante absente → graine locale', () => {
      expect(merge({ seed: 'a' }, { seed: 'a' }, { seed: 'b' }).seed).toBe('b');
      expect(merge({ seed: 'a' }, { seed: 'c' }, { seed: 'a' }).seed).toBe('c');
      expect(merge({ seed: null }, {}, { seed: 'x' }).seed).toBe('x');
      expect(merge({ seed: 'a' }, { seed: 'a' }, {}).seed).toBe('a');
    });

    test('listes absentes acceptées', () => {
      expect(merge({}, {}, {})).toEqual({ seed: undefined, pois: [], paths: [] });
      // Anciens fonds importés (fonctionnalité retirée) : plus fusionnés.
      expect(merge({}, {}, { backgrounds: [P('f', 'F')] })).toEqual({ seed: undefined, pois: [], paths: [] });
    });
  });
});

describe('état et configuration', () => {
  test('sans URL : désactivé, aucun démarrage', () => {
    for (const url of [undefined, '']) {
      const s = new Store();
      const st = [];
      const cs = new CloudSync(s, url, (x) => st.push(x));
      const onChange = vi.spyOn(s, 'onChange');
      expect(cs.enabled).toBe(false);
      cs.start();
      expect(onChange).not.toHaveBeenCalled();
      expect(st).toEqual([]);
    }
  });

  test('URL : barres finales retirées', async () => {
    const d = device({ url: `${URL_}//` });
    expect(d.sync.enabled).toBe(true);
    await d.sync.create();
    expect(server.requests[0].url).toBe(`${URL_}/api/sync`);
  });

  test('statut initial et état sauvegardé relu', () => {
    expect(sync.status).toEqual({ kind: 'off', message: '', at: null });
    expect(sync.code).toBeNull();
    localStorage.setItem(STATE_KEY, JSON.stringify({ code: 'ABCDEFGH', version: 3, base: null }));
    const cs = new CloudSync(new Store(), URL_);
    expect(cs.code).toBe('ABCDEFGH');
    expect(cs.state).toEqual({ code: 'ABCDEFGH', version: 3, base: null });
    expect(cs.status.kind).toBe('idle');
  });

  test('état sauvegardé invalide ignoré', () => {
    for (const raw of ['{', JSON.stringify({ code: 'ABC', version: 1 }), JSON.stringify({ code: 'ABCDEFGH', version: 1.5 }), JSON.stringify({ code: 'ABCDEFGH' }), 'null', '0']) {
      localStorage.setItem(STATE_KEY, raw);
      const cs = new CloudSync(new Store(), URL_);
      expect(cs.state).toBeNull();
      expect(cs.code).toBeNull();
      expect(cs.status.kind).toBe('off');
    }
    localStorage.removeItem(STATE_KEY);
    expect(new CloudSync(new Store(), URL_).state).toBeNull();
  });

  test('sans callback de statut', async () => {
    const cs = new CloudSync(new Store(), URL_);
    await cs.create();
    expect(cs.code).toMatch(/^[A-Z2-9]{8}$/);
    cs.setStatus('idle');
    expect(cs.status.kind).toBe('idle');
  });

  test('setStatus : message par défaut, date de la dernière synchro réussie', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    sync.setStatus('idle');
    expect(sync.status).toEqual({ kind: 'idle', message: '', at: new Date('2026-01-02T03:04:05Z') });
    vi.setSystemTime(new Date('2026-01-02T05:00:00Z'));
    sync.setStatus('error', 'Oups');
    expect(sync.status).toEqual({ kind: 'error', message: 'Oups', at: new Date('2026-01-02T03:04:05Z') });
    expect(lastStatus()).toEqual(sync.status);
  });

  test('stockage indisponible : l’état reste en mémoire', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('plein'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('plein'); });
    await sync.create();
    expect(sync.code).toMatch(/^[A-Z2-9]{8}$/);
    sync.leave();
    expect(sync.code).toBeNull();
  });
});

describe('créer, rejoindre, quitter', () => {
  test('créer un code envoie les données de l’appareil', async () => {
    store.savePoi({ name: 'Base' });
    const code = await sync.create();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(sync.code).toBe(code);
    expect(serverState(code).version).toBe(1);
    expect(serverState(code).data.pois.map((p) => p.name)).toEqual(['Base']);
    expect(JSON.parse(localStorage.getItem(STATE_KEY))).toEqual({ code, version: 1, base: serverState(code).data });
    expect(statuses.map((s) => s.kind)).toEqual(['syncing', 'syncing', 'idle']);
  });

  test('créer : code gardé même si le premier envoi échoue', async () => {
    const real = server.fetch;
    vi.stubGlobal('fetch', async (url, init) => (init.method === 'PUT' ? new Response('', { status: 500 }) : real(url, init)));
    await expect(sync.create()).rejects.toMatchObject({ status: 500 });
    expect(sync.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(JSON.parse(localStorage.getItem(STATE_KEY))).toEqual({ code: sync.code, version: 0, base: null });
  });

  test('créer : échec du serveur', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    await expect(sync.create()).rejects.toMatchObject({ status: 500 });
    expect(sync.code).toBeNull();
    expect(lastStatus()).toMatchObject({ kind: 'error', message: 'Synchronisation impossible (hors ligne ?). Nouvel essai automatique.' });
  });

  test('rejoindre : code normalisé, données fusionnées, envoi si l’appareil apporte du nouveau', async () => {
    store.savePoi({ name: 'A' });
    const code = await sync.create();
    const other = device();
    other.store.savePoi({ name: 'B' });
    const joined = await other.sync.join(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `);
    expect(joined).toBe(code);
    expect(other.store.data.pois.map((p) => p.name).sort()).toEqual(['A', 'B']);
    expect(serverState(code).version).toBe(2);
    expect(serverState(code).data.pois).toHaveLength(2);
    expect(other.statuses.map((s) => s.kind)).toEqual(['syncing', 'syncing', 'idle']);
  });

  test('rejoindre sans rien apporter : pas d’envoi', async () => {
    store.savePoi({ name: 'A' });
    const code = await sync.create();
    const other = device();
    const before = server.requests.length;
    await other.sync.join(code);
    expect(server.requests.slice(before).map((r) => r.method)).toEqual(['GET']);
    expect(other.store.data.pois.map((p) => p.name)).toEqual(['A']);
    expect(other.statuses.map((s) => s.kind)).toEqual(['syncing', 'idle']);
    expect(other.sync.state).toMatchObject({ code, version: 1 });
    expect(JSON.parse(localStorage.getItem(STATE_KEY))).toMatchObject({ code, version: 1 });
  });

  test('rejoindre un code neuf (aucune donnée) : les données locales sont envoyées', async () => {
    const res = await server.fetch(`${URL_}/api/sync`, { method: 'POST' });
    const { code } = await res.json();
    store.savePoi({ name: 'Local' });
    await sync.join(code);
    expect(serverState(code).data.pois.map((p) => p.name)).toEqual(['Local']);
  });

  test('rejoindre : code invalide, inconnu, serveur injoignable', async () => {
    await expect(sync.join('ABC')).rejects.toThrow('Code invalide : 8 caractères attendus.');
    await expect(sync.join('0ABCDEFGH')).rejects.toThrow('Code invalide');
    await expect(sync.join('ABCDEFGH0')).rejects.toThrow('Code invalide');
    await expect(sync.join('ABCDEFG1')).rejects.toThrow('Code invalide');
    await expect(sync.join(undefined)).rejects.toThrow('Code invalide');
    expect(statuses).toEqual([]);
    await expect(sync.join('AAAAAAAA')).rejects.toThrow('Code inconnu ou expiré.');
    expect(lastStatus()).toMatchObject({ kind: 'off', message: 'Code inconnu ou expiré.' });
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    await expect(sync.join('AAAAAAAA')).rejects.toThrow('Connexion au cloud impossible.');
    expect(lastStatus()).toMatchObject({ kind: 'off', message: 'Connexion au cloud impossible.' });
  });

  test('rejoindre un autre code alors qu’on est déjà relié : erreur affichée', async () => {
    await sync.create();
    await expect(sync.join('AAAAAAAA')).rejects.toThrow('Code inconnu ou expiré.');
    expect(lastStatus()).toMatchObject({ kind: 'error', message: 'Code inconnu ou expiré.' });
  });

  test('un envoi prévu avant de quitter n’est pas envoyé sur le code suivant', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await sync.create();
    sync.schedulePush();
    sync.leave();
    const code = await sync.create();
    const before = server.requests.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.requests.length).toBe(before);
    expect(serverState(code).version).toBe(1);
  });

  test('appliquer des données identiques : aucune écriture', () => {
    const events = [];
    store.onChange(() => events.push(1));
    sync.apply({ seed: store.data.seed, pois: [], paths: [] });
    expect(events).toEqual([]);
    sync.apply({ seed: store.data.seed, pois: [{ id: 'x', name: 'X' }], paths: [] });
    expect(events).toEqual([1]);
    expect(store.data.version).toBe(1);
  });

  test('quitter : état effacé, envoi prévu annulé', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await sync.create();
    sync.schedulePush();
    const before = server.requests.length;
    sync.leave();
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.requests.length).toBe(before);
    expect(sync.code).toBeNull();
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
    expect(lastStatus().kind).toBe('off');
  });
});

describe('envoi', () => {
  test('envoi différé de 1,5 s après la dernière modification', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const code = await sync.create();
    sync.start();
    await sync.queue; // pull de démarrage terminé
    store.savePoi({ name: 'X' });
    expect(lastStatus().kind).toBe('pending');
    await vi.advanceTimersByTimeAsync(1000);
    store.savePoi({ name: 'Y' });
    await vi.advanceTimersByTimeAsync(1499);
    expect(serverState(code).version).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(serverState(code).version).toBe(2));
    expect(serverState(code).data.pois.map((p) => p.name)).toEqual(['X', 'Y']);
  });

  test('envoi différé en échec : erreur affichée, pas de rejet non géré', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await sync.create();
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    sync.schedulePush();
    await vi.advanceTimersByTimeAsync(1500);
    await sync.queue;
    expect(lastStatus()).toMatchObject({ kind: 'error', message: 'Synchronisation impossible (hors ligne ?). Nouvel essai automatique.' });
  });

  test('modifications venant du cloud ou sans code : pas d’envoi', () => {
    const schedule = vi.spyOn(sync, 'schedulePush');
    sync.start();
    store.savePoi({ name: 'X' });
    expect(schedule).not.toHaveBeenCalled();
    sync.state = { code: 'ABCDEFGH', version: 0, base: null };
    store.replaceAll({}, 'remote');
    expect(schedule).not.toHaveBeenCalled();
    store.savePoi({ name: 'Y' });
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  test('pushNow sans code : rien', async () => {
    await sync.pushNow();
    expect(server.requests).toEqual([]);
  });

  test('conflit (409) : fusion puis nouvel envoi', async () => {
    store.savePoi({ name: 'A' });
    const code = await sync.create();
    const other = device();
    await other.sync.join(code);
    other.store.savePoi({ name: 'B' });
    await other.sync.pushNow();
    store.savePoi({ name: 'C' });
    await sync.pushNow();
    expect(serverState(code).version).toBe(3);
    expect(serverState(code).data.pois.map((p) => p.name).sort()).toEqual(['A', 'B', 'C']);
    expect(store.data.pois.map((p) => p.name).sort()).toEqual(['A', 'B', 'C']);
    expect(lastStatus().kind).toBe('idle');
  });

  test('conflit avec un code resté vide côté serveur', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (url, init) => {
      calls++;
      if (init.method === 'PUT' && calls === 1) return Response.json({ version: 4, data: null }, { status: 409 });
      return Response.json({ version: 5, data: JSON.parse(init.body).data }, { status: 200 });
    });
    sync.state = { code: 'ABCDEFGH', version: 0, base: null };
    store.savePoi({ name: 'Garde' });
    await sync.pushNow();
    expect(sync.state.version).toBe(5);
    expect(store.data.pois.map((p) => p.name)).toEqual(['Garde']);
  });

  test('trop de conflits : abandon après 5 essais', async () => {
    let puts = 0;
    vi.stubGlobal('fetch', async (url, init) => {
      if (init.method === 'PUT') puts++;
      return Response.json({ version: puts, data: { pois: [{ id: `r${puts}` }] } }, { status: 409 });
    });
    sync.state = { code: 'ABCDEFGH', version: 0, base: null };
    await expect(sync.pushNow()).rejects.toThrow('Trop de conflits');
    expect(puts).toBe(5);
    expect(JSON.parse(localStorage.getItem(STATE_KEY)).version).toBe(5);
    expect(lastStatus()).toMatchObject({ kind: 'error', message: 'Synchronisation impossible (hors ligne ?). Nouvel essai automatique.' });
  });

  test('modification pendant l’envoi : renvoyée dans la foulée', async () => {
    const code = await sync.create();
    const real = server.fetch;
    let once = true;
    vi.stubGlobal('fetch', async (url, init) => {
      const res = await real(url, init);
      if (once && init.method === 'PUT') {
        once = false;
        store.data.pois.push({ id: 'pendant', name: 'Pendant', links: [] });
      }
      return res;
    });
    store.savePoi({ name: 'Avant' });
    await sync.pushNow();
    expect(serverState(code).data.pois.map((p) => p.name)).toEqual(['Avant', 'Pendant']);
    expect(lastStatus().kind).toBe('idle');
  });

  test('erreurs à l’envoi : code expiré (404), serveur en panne, hors ligne', async () => {
    sync.state = { code: 'AAAAAAAA', version: 0, base: null };
    await expect(sync.pushNow()).rejects.toMatchObject({ status: 404 });
    expect(lastStatus()).toMatchObject({ kind: 'error', message: 'Code inconnu ou expiré.' });
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    await expect(sync.pushNow()).rejects.toMatchObject({ status: 500, json: null });
    expect(lastStatus().message).toBe('Synchronisation impossible (hors ligne ?). Nouvel essai automatique.');
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    await expect(sync.pushNow()).rejects.toThrow('Failed to fetch');
  });

  test('requêtes : corps JSON seulement quand il y a des données', async () => {
    await sync.create();
    const [post, put] = server.requests;
    expect(post).toMatchObject({ method: 'POST', body: undefined, headers: undefined });
    expect(put.method).toBe('PUT');
    expect(put.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(put.body)).toMatchObject({ baseVersion: 0, data: { pois: [] } });
  });
});

describe('réception', () => {
  test('pull sans code : aucun statut, aucune requête', async () => {
    await expect(sync.pull()).resolves.toBeUndefined();
    expect(statuses).toEqual([]);
    expect(server.requests).toEqual([]);
  });

  test('pull : applique les changements distants', async () => {
    const code = await sync.create();
    const other = device();
    await other.sync.join(code);
    other.store.savePoi({ name: 'Nouveau' });
    await other.sync.pushNow();
    const events = [];
    store.onChange((d, source) => events.push(source));
    localStorage.removeItem(STATE_KEY); // écrit par l'autre appareil (stockage partagé sous jsdom)
    await sync.pull();
    expect(store.data.pois.map((p) => p.name)).toEqual(['Nouveau']);
    expect(events).toEqual(['remote']);
    expect(sync.state.version).toBe(2);
    expect(JSON.parse(localStorage.getItem(STATE_KEY)).version).toBe(2);
    expect(lastStatus().kind).toBe('idle');
  });

  test('pull sans changement : ni écriture locale, ni envoi', async () => {
    await sync.create();
    const events = [];
    store.onChange((d, source) => events.push(source));
    const before = server.requests.length;
    await sync.pull();
    expect(events).toEqual([]);
    expect(server.requests.slice(before).map((r) => r.method)).toEqual(['GET']);
    expect(lastStatus().kind).toBe('idle');
  });

  test('pull avec modification locale non envoyée : envoi', async () => {
    const code = await sync.create();
    store.data.pois.push({ id: 'l', name: 'Local', links: [] });
    await sync.pull();
    expect(serverState(code).data.pois.map((p) => p.name)).toEqual(['Local']);
  });

  test('pull sur un code resté vide côté serveur', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ version: 7, data: null }));
    sync.state = { code: 'ABCDEFGH', version: 0, base: { seed: 'minecarte', pois: [], paths: [] } };
    store.savePoi({ name: 'Garde' });
    vi.spyOn(sync, 'pushNow').mockResolvedValue();
    await sync.pull();
    expect(sync.state.version).toBe(7);
    expect(store.data.pois.map((p) => p.name)).toEqual(['Garde']);
  });

  test('pull : sans code, code effacé entre-temps, erreurs absorbées', async () => {
    await expect(sync.pull()).resolves.toBeUndefined();
    expect(server.requests).toEqual([]);
    await sync.create();
    const before = server.requests.length;
    const p = sync.pull();
    sync.leave();
    await p;
    expect(server.requests.length).toBe(before);
    sync.state = { code: 'AAAAAAAA', version: 0, base: null };
    await expect(sync.pull()).resolves.toBeUndefined();
    expect(lastStatus()).toMatchObject({ kind: 'error', message: 'Code inconnu ou expiré.' });
  });

  test('file : une opération en échec n’empêche pas la suivante', async () => {
    const order = [];
    const failing = sync.enqueue(async () => { order.push(1); throw new Error('x'); });
    const next = sync.enqueue(async () => { order.push(2); return 'ok'; });
    await expect(failing).rejects.toThrow('x');
    await expect(next).resolves.toBe('ok');
    expect(order).toEqual([1, 2]);
  });
});

describe('démarrage : vérification périodique et au retour sur l’onglet', () => {
  let visibility;
  beforeEach(() => {
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });

  test('sans code : statut annoncé, aucune requête', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const pull = vi.spyOn(sync, 'pull');
    sync.start();
    expect(statuses).toEqual([{ kind: 'off', message: '', at: null }]);
    expect(pull).not.toHaveBeenCalled();
  });

  test('avec code : pull immédiat, puis toutes les 30 s quand l’onglet est visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    await sync.create();
    const pull = vi.spyOn(sync, 'pull').mockResolvedValue();
    sync.start();
    expect(pull).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29999);
    expect(pull).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(pull).toHaveBeenCalledTimes(2);
    visibility = 'hidden';
    vi.advanceTimersByTime(30000);
    expect(pull).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pull).toHaveBeenCalledTimes(2);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pull).toHaveBeenCalledTimes(3);
  });
});

test('anciens fonds importés dans le cloud : retirés au premier envoi, images supprimées', async () => {
  const code = await sync.create();
  const hash = sha([1, 2, 3]);
  // État laissé par une ancienne version : un fond et son image.
  server.env.SYNC_KV.map.set(`sync:${code}`, JSON.stringify({
    version: 1,
    data: { seed: 'minecarte', pois: [], paths: [], backgrounds: [{ id: 'f', hash }] },
  }));
  server.env.SYNC_KV.map.set(`blob:${code}:${hash}`, new Uint8Array([1, 2, 3]));
  await sync.pull();
  expect(serverState(code)).toEqual({ version: 2, data: { seed: 'minecarte', pois: [], paths: [] } });
  expect(server.env.SYNC_KV.map.has(`blob:${code}:${hash}`)).toBe(false);
  expect(lastStatus().kind).toBe('idle');
});
