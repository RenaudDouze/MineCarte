/*
 * Fonds de carte importés (images exportées depuis uNmINeD ou un autre outil).
 *
 * Les images peuvent peser plusieurs Mo : elles sont gardées dans IndexedDB,
 * sur cet appareil uniquement (ni dans le localStorage, ni dans la
 * synchronisation cloud).
 *
 * Un fond : { id, name, dim, x, z, scale, width, height, visible, blob }
 *   x, z   : coordonnées en blocs du coin nord-ouest (haut-gauche) de l'image ;
 *   scale  : blocs par pixel (1 = 1 pixel par bloc, 0.5 = 2 pixels par bloc…).
 */
(function (global) {
  'use strict';

  const DB_NAME = 'minecarte';
  const STORE = 'backgrounds';

  let dbPromise = null;
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
    });
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

  global.Backgrounds = {
    list: () => run('readonly', (s) => s.getAll()).then((all) => all || []),
    put: (bg) => run('readwrite', (s) => s.put(bg)),
    remove: (id) => run('readwrite', (s) => s.delete(id)),
    imageSize,
  };
})(window);
