/*
 * Images des fonds de carte importés (exports uNmINeD ou autre outil).
 *
 * Les métadonnées de chaque fond (nom, dimension, position, échelle…) sont dans
 * les données de la carte (store.data.backgrounds) et donc synchronisées ; les
 * images, qui peuvent peser plusieurs Mo, sont gardées ici dans IndexedDB,
 * indexées par leur empreinte SHA-256.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'minecarte';
  const BLOBS = 'blobs';
  // Ancien stockage (métadonnées + image ensemble), migré au démarrage.
  const LEGACY = 'backgrounds';

  let dbPromise = null;
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(LEGACY)) db.createObjectStore(LEGACY, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'hash' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  async function run(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
    });
  }

  async function sha256(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Dimensions en pixels d'une image (Blob ou File).
  function imageSize(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image illisible'));
      };
      img.src = url;
    });
  }

  async function getBlob(hash) {
    const entry = await run(BLOBS, 'readonly', (s) => s.get(hash));
    return entry ? entry.blob : null;
  }

  function putBlob(hash, blob) {
    return run(BLOBS, 'readwrite', (s) => s.put({ hash, blob }));
  }

  // Supprime les images qu'aucun fond ne référence plus.
  async function prune(keepHashes) {
    const keys = await run(BLOBS, 'readonly', (s) => s.getAllKeys());
    const unused = (keys || []).filter((h) => !keepHashes.has(h));
    if (unused.length) await run(BLOBS, 'readwrite', (s) => unused.forEach((h) => s.delete(h)));
  }

  // Fonds importés avant la synchronisation des images : on déplace chaque
  // image dans le stockage par empreinte et on renvoie leurs métadonnées.
  async function migrateLegacy() {
    const legacy = (await run(LEGACY, 'readonly', (s) => s.getAll())) || [];
    const metas = [];
    for (const bg of legacy) {
      if (!bg || !bg.blob) continue;
      const hash = await sha256(bg.blob);
      await putBlob(hash, bg.blob);
      const { blob, ...meta } = bg;
      metas.push(Object.assign(meta, { hash, type: blob.type }));
    }
    if (legacy.length) await run(LEGACY, 'readwrite', (s) => s.clear());
    return metas;
  }

  global.Backgrounds = { getBlob, putBlob, prune, migrateLegacy, sha256, imageSize };
})(window);
