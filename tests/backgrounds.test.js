import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';

// Blob de Node : fake-indexeddb le clone correctement (celui de jsdom perd ses méthodes).
const blob = (bytes, type = 'image/png') => new NodeBlob([new Uint8Array(bytes)], { type });
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

let B;
let factory;
async function fresh(idb = new IDBFactory()) {
  factory = idb;
  vi.stubGlobal('indexedDB', idb);
  vi.resetModules();
  delete window.Backgrounds;
  await import('../js/backgrounds.js');
  B = window.Backgrounds;
}

// Base de données au format de la version 1 (ancien stockage des fonds).
function createV1(idb, entries) {
  return new Promise((resolve, reject) => {
    const req = idb.open('minecarte', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('backgrounds', { keyPath: 'id' });
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('backgrounds', 'readwrite');
      entries.forEach((e) => tx.objectStore('backgrounds').put(e));
      tx.oncomplete = () => { db.close(); resolve(); };
    };
    req.onerror = () => reject(req.error);
  });
}

function storeNames(idb) {
  return new Promise((resolve) => {
    const req = idb.open('minecarte');
    req.onsuccess = () => {
      const names = [...req.result.objectStoreNames];
      const version = req.result.version;
      req.result.close();
      resolve({ names, version });
    };
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('sha256', () => {
  beforeEach(() => fresh());
  test('empreinte hexadécimale (octets < 16 complétés par un zéro)', async () => {
    expect(await B.sha256(blob([97, 98, 99]))).toBe(ABC_SHA256);
    expect(await B.sha256(blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('imageSize', () => {
  let revoked;
  let behaviour;
  beforeEach(async () => {
    await fresh();
    revoked = [];
    vi.stubGlobal('URL', Object.assign(function URLStub() {}, {
      createObjectURL: (b) => `blob:${b.size}`,
      revokeObjectURL: (u) => revoked.push(u),
    }));
    vi.stubGlobal('Image', class {
      set src(value) {
        this.url = value;
        queueMicrotask(() => {
          if (behaviour === 'ok') {
            this.naturalWidth = 640;
            this.naturalHeight = 480;
            this.onload();
          } else {
            this.onerror();
          }
        });
      }
    });
  });

  test('dimensions de l’image, URL libérée', async () => {
    behaviour = 'ok';
    await expect(B.imageSize(blob([1, 2, 3]))).resolves.toEqual({ width: 640, height: 480 });
    expect(revoked).toEqual(['blob:3']);
  });

  test('image illisible : rejet, URL libérée', async () => {
    behaviour = 'ko';
    await expect(B.imageSize(blob([1]))).rejects.toThrow('Image illisible');
    expect(revoked).toEqual(['blob:1']);
  });
});

describe('stockage des images (IndexedDB)', () => {
  beforeEach(() => fresh());

  test('base créée en version 2 avec le seul stockage par empreinte', async () => {
    expect(await B.getBlob('x')).toBeNull();
    expect(await storeNames(factory)).toEqual({ names: ['blobs'], version: 2 });
  });

  test('enregistrer, relire, écraser', async () => {
    await B.putBlob('h1', blob([1, 2, 3], 'image/webp'));
    const got = await B.getBlob('h1');
    expect(got.type).toBe('image/webp');
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([1, 2, 3]);
    await B.putBlob('h1', blob([9]));
    expect([...new Uint8Array(await (await B.getBlob('h1')).arrayBuffer())]).toEqual([9]);
    expect(await B.getBlob('h2')).toBeNull();
  });

  test('nettoyage : seules les images référencées restent', async () => {
    await B.putBlob('a', blob([1]));
    await B.putBlob('b', blob([2]));
    await B.putBlob('c', blob([3]));
    await B.prune(new Set(['b', 'zzz']));
    expect(await B.getBlob('a')).toBeNull();
    expect(await B.getBlob('b')).not.toBeNull();
    expect(await B.getBlob('c')).toBeNull();
    await B.prune(new Set());
    expect(await B.getBlob('b')).toBeNull();
  });

  test('pas d’ancien stockage : rien à migrer', async () => {
    expect(await B.migrateLegacy()).toEqual([]);
  });
});

describe('migration depuis la version 1', () => {
  test('images déplacées par empreinte, métadonnées renvoyées, ancien stockage vidé', async () => {
    const idb = new IDBFactory();
    await createV1(idb, [
      { id: 'bg-1', name: 'Spawn', dim: 'nether', x: -5, z: 7, scale: 2, width: 3, height: 1, blob: blob([97, 98, 99], 'image/jpeg') },
      { id: 'bg-2', name: 'Sans image' },
    ]);
    await fresh(idb);
    const metas = await B.migrateLegacy();
    expect(metas).toEqual([
      { id: 'bg-1', name: 'Spawn', dim: 'nether', x: -5, z: 7, scale: 2, width: 3, height: 1, hash: ABC_SHA256, type: 'image/jpeg' },
    ]);
    expect((await B.getBlob(ABC_SHA256)).type).toBe('image/jpeg');
    expect(await storeNames(idb)).toEqual({ names: ['backgrounds', 'blobs'], version: 2 });
    // Déjà migré : plus rien au deuxième passage.
    expect(await B.migrateLegacy()).toEqual([]);
  });
});

describe('erreurs IndexedDB', () => {
  // Faux IndexedDB entièrement piloté par le test.
  function fakeIDB({ openFails = 0 } = {}) {
    const state = { opens: 0, tx: null };
    const db = {
      objectStoreNames: { contains: () => false },
      transaction: () => {
        state.tx = { objectStore: () => ({ get: () => ({ result: undefined }) }) };
        return state.tx;
      },
    };
    const idb = {
      open(name, version) {
        state.opens++;
        state.args = [name, version];
        const req = {};
        queueMicrotask(() => {
          if (state.opens <= openFails) {
            req.error = new Error('ouverture refusée');
            req.onerror();
          } else {
            req.result = db;
            req.onsuccess();
          }
        });
        return req;
      },
    };
    return { idb, state };
  }

  test('ouverture refusée : rejet, puis nouvel essai au prochain appel', async () => {
    const { idb, state } = fakeIDB({ openFails: 1 });
    await fresh(idb);
    const refused = await B.getBlob('x').catch((e) => e);
    expect(refused).toBeInstanceOf(Error);
    expect(refused.message).toBe('ouverture refusée');
    const pending = B.getBlob('x');
    await vi.waitFor(() => expect(state.tx).not.toBeNull());
    state.tx.oncomplete();
    await expect(pending).resolves.toBeNull();
    expect(state.opens).toBe(2);
    expect(state.args).toEqual(['minecarte', 2]);
  });

  test('base ouverte une seule fois', async () => {
    const { idb, state } = fakeIDB();
    await fresh(idb);
    const first = B.getBlob('x');
    await vi.waitFor(() => expect(state.tx).not.toBeNull());
    state.tx.oncomplete();
    await first;
    const second = B.getBlob('y');
    await vi.waitFor(() => expect(state.tx.oncomplete).toBeDefined());
    state.tx.oncomplete();
    await second;
    expect(state.opens).toBe(1);
  });

  test('transaction en erreur ou annulée : rejet', async () => {
    const { idb, state } = fakeIDB();
    await fresh(idb);
    const failing = B.getBlob('x');
    await vi.waitFor(() => expect(state.tx).not.toBeNull());
    const full = new Error('disque plein');
    state.tx.error = full;
    state.tx.onerror();
    await expect(failing).rejects.toBe(full);

    state.tx = null;
    const aborted = B.getBlob('y');
    await vi.waitFor(() => expect(state.tx).not.toBeNull());
    const quota = new Error('quota');
    state.tx.error = quota;
    state.tx.onabort();
    await expect(aborted).rejects.toBe(quota);

    state.tx = null;
    const cancelled = B.getBlob('z');
    await vi.waitFor(() => expect(state.tx).not.toBeNull());
    state.tx.error = null;
    state.tx.onabort();
    const err = await cancelled.catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Transaction annulée');
  });
});
