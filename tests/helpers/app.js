// Démarre l'application complète (index.html + tous les scripts) dans jsdom.
// Chaque démarrage repart d'un DOM neuf ; les écouteurs posés sur document et
// window et les minuteries du démarrage précédent sont retirés.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { installCanvasMock } from './canvas.js';
import { loadLeaflet } from './leaflet.js';

const html = readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8');
// Corps de la page sans ses balises <script> (les scripts sont chargés un à un ci-dessous).
const page = new DOMParser().parseFromString(html, 'text/html');
page.querySelectorAll('script').forEach((el) => el.remove());
const body = page.body.innerHTML;
const MODULES = ['utils', 'noise', 'terrain', 'config', 'icons', 'store', 'sync'];

let cleanups = [];

// jsdom n'implémente pas <dialog> modal.
function installDialog() {
  const proto = HTMLDialogElement.prototype;
  proto.showModal = function showModal() { this.setAttribute('open', ''); };
  proto.close = function close() {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

function track(target) {
  const add = target.addEventListener;
  target.addEventListener = function addEventListener(type, fn, opts) {
    cleanups.push(() => target.removeEventListener(type, fn, opts));
    return add.call(this, type, fn, opts);
  };
  cleanups.push(() => { target.addEventListener = add; });
}

export function teardown() {
  for (const fn of cleanups.reverse()) fn();
  cleanups = [];
}

/**
 * @param {object} [o]
 * @param {string} [o.syncUrl] URL du worker (synchronisation active).
 * @param {object} [o.storage] Contenu initial du localStorage.
 * @param {string} [o.hash] Ancre initiale de l'URL.
 * @param {number} [o.width] Largeur de la fenêtre.
 * @param {IDBFactory|object} [o.idb] Fabrique IndexedDB.
 * @param {Function} [o.fetch] Remplaçant de fetch.
 * @param {(win: Window) => void} [o.before] Appelé juste avant le chargement d'app.js.
 */
export async function boot(o = {}) {
  teardown();
  vi.resetModules();
  localStorage.clear();
  for (const [k, v] of Object.entries(o.storage || {})) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  history.replaceState(null, '', `/${o.hash || ''}`);
  window.innerWidth = o.width || 1280;
  document.body.className = '';
  delete document.body.dataset.dim;
  document.body.innerHTML = body;
  installCanvasMock();
  installDialog();
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  vi.stubGlobal('indexedDB', o.idb || new IDBFactory());
  vi.stubGlobal('fetch', o.fetch || vi.fn(async () => new Response('{}', { status: 500 })));
  // Minuteries de l'application (poll cloud, nettoyage des images…) : arrêtées
  // au démarrage suivant pour ne pas agir sur les données d'un autre test.
  const timers = [];
  const setInt = globalThis.setInterval;
  const setTo = globalThis.setTimeout;
  vi.stubGlobal('setInterval', (...args) => { const id = setInt(...args); timers.push(id); return id; });
  vi.stubGlobal('setTimeout', (...args) => { const id = setTo(...args); timers.push(id); return id; });
  cleanups.push(() => timers.forEach((id) => { clearInterval(id); clearTimeout(id); }));
  // URL objet : jsdom ne les implémente pas.
  const urls = { created: [], revoked: [] };
  URL.createObjectURL = (blob) => { const u = `blob:mc/${urls.created.length + 1}`; urls.created.push([u, blob]); return u; };
  URL.revokeObjectURL = (u) => { urls.revoked.push(u); };
  track(document);
  track(window);
  loadLeaflet();
  for (const m of MODULES) {
    delete window[m[0].toUpperCase() + m.slice(1)];
    await import(`../../js/${m}.js`);
  }
  window.MINECARTE_CONFIG = { syncUrl: o.syncUrl || '' };
  // La carte a une taille (jsdom ne calcule aucune mise en page).
  const mapEl = document.getElementById('map');
  Object.defineProperty(mapEl, 'clientWidth', { configurable: true, value: o.mapWidth || 400 });
  Object.defineProperty(mapEl, 'clientHeight', { configurable: true, value: o.mapHeight || 300 });
  if (o.before) o.before(window);
  await import('../../js/app.js');
  const app = Object.assign(window.MineCarte, { urls });
  cleanups.push(() => { app.map.remove(); });
  return app;
}
