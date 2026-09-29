import { describe, test, expect, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { boot, teardown } from './helpers/app.js';
import { createServer } from './helpers/server.js';

afterEach(async () => {
  // Laisse finir les chargements d'images en cours avant de détruire la carte.
  vi.useRealTimers();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  teardown();
  // Les tests n'installent de fausses minuteries qu'après boot() : sinon
  // unstubAllGlobals remettrait un faux setTimeout déjà désinstallé.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const text = (sel) => $(sel).textContent;
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };
// Attend qu'une condition (éventuellement asynchrone) soit vraie.
const until = async (fn) => { for (let i = 0; i < 100 && !(await fn()); i++) await tick(); expect(await fn()).toBeTruthy(); };
// Bouton visible dont le texte contient `label` (popups, menus…).
function button(label, root = document) {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent.includes(label));
  if (!found) throw new Error(`Bouton « ${label} » introuvable`);
  return found;
}
const popup = () => $('.leaflet-popup-content');
const input = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
const change = (el, value) => { if (typeof value === 'boolean') el.checked = value; else el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
const submit = (form) => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
const key = (k, opts = {}, target = document.body) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(e);
  return e;
};
const layers = (app, pred) => { const out = []; app.map.eachLayer((l) => { if (pred(l)) out.push(l); }); return out; };
const ll = (x, z) => Utils.toLatLng(x, z);
// Couleur telle que jsdom la normalise dans style.background.
const css = (color) => { const d = document.createElement('div'); d.style.background = color; return d.style.background; };

const POI = (o) => ({ name: 'P', color: '#e53935', dim: 'overworld', x: 0, y: 64, z: 0, links: [], ...o });
const DATA = (o) => ({ seed: 's', pois: [], paths: [], ...o });
const withData = (data, extra = {}) => boot({ ...extra, storage: { 'minecarte:data': DATA(data), ...extra.storage } });

describe('démarrage et options', () => {
  test('dimension initiale, panneau et grille par défaut', async () => {
    const app = await boot();
    expect(app.state.dim).toBe('overworld');
    expect(document.body.dataset.dim).toBe('overworld');
    expect(document.body.classList.contains('sidebar-hidden')).toBe(false);
    expect($('.dim-btn[data-dim="overworld"]').classList.contains('active')).toBe(true);
    expect($('.dim-btn[data-dim="nether"]').classList.contains('active')).toBe(false);
    expect(app.map.getContainer().style.background).toBe(css(Terrain.background.overworld));
    expect($('#opt-grid').checked).toBe(true);
    expect($('#opt-labels').checked).toBe(true);
    expect($('#opt-links').checked).toBe(true);
    expect($('#poi-all-dims').checked).toBe(false);
    expect(layers(app, (l) => l instanceof Terrain.GridOverlay)).toHaveLength(1);
    expect(location.hash).toBe('#overworld/0/0/0');
    expect(text('#coords')).toBe('X 0  Z 0  ·  Chunk 0, 0  ·  Région r.0.0  ·  Nether ≈ 0, 0');
    expect($('#sync-section').hidden).toBe(true);
    expect(app.map.getPane('gridPane').style.zIndex).toBe('250');
    expect(app.map.getPane('linkPane').style.zIndex).toBe('390');
    expect(app.map.getPane('pathPane').style.zIndex).toBe('395');
    expect(app.map.options.crs).toBe(L.CRS.Simple);
    expect([app.map.getMinZoom(), app.map.getMaxZoom()]).toEqual([-6, 5]);
    expect(app.map.options.zoomSnap).toBe(1);
    expect(app.map.options.boxZoom).toBe(false);
    expect(app.map.attributionControl).toBeUndefined();
  });

  test('ancre de départ et écran étroit', async () => {
    const app = await boot({ hash: '#nether/80/-16/2', width: 500 });
    expect(app.state.dim).toBe('nether');
    expect(app.map.getZoom()).toBe(2);
    expect(app.map.getCenter()).toEqual(ll(80, -16));
    expect(document.body.classList.contains('sidebar-hidden')).toBe(true);
    expect(text('#coords')).toBe('X 80  Z -16  ·  Chunk 5, -1  ·  Région r.0.-1  ·  Overworld ≈ 640, -128');
  });

  test('options enregistrées, illisibles ou partielles', async () => {
    let app = await boot({ storage: { 'minecarte:options': { grid: false, labels: false, links: false, allDims: true } } });
    expect($('#opt-grid').checked).toBe(false);
    expect($('#poi-all-dims').checked).toBe(true);
    expect(layers(app, (l) => l instanceof Terrain.GridOverlay)).toHaveLength(0);
    expect(app.map.getContainer().classList.contains('hide-labels')).toBe(true);
    app = await boot({ storage: { 'minecarte:options': '{pas du json' } });
    expect(app.state.options).toEqual({ grid: true, labels: true, links: true, allDims: false, hiddenCats: [] });
    app = await boot({ storage: { 'minecarte:options': { labels: false } } });
    expect(app.state.options).toEqual({ grid: true, labels: false, links: true, allDims: false, hiddenCats: [] });
  });

  test('changer une option : enregistrée et appliquée', async () => {
    const app = await boot();
    change($('#opt-grid'), false);
    expect(JSON.parse(localStorage.getItem('minecarte:options')).grid).toBe(false);
    expect(layers(app, (l) => l instanceof Terrain.GridOverlay)).toHaveLength(0);
    change($('#opt-grid'), true);
    expect(layers(app, (l) => l instanceof Terrain.GridOverlay)).toHaveLength(1);
    change($('#opt-labels'), false);
    expect(app.map.getContainer().classList.contains('hide-labels')).toBe(true);
    // Stockage plein : l'option s'applique quand même.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('plein'); });
    change($('#opt-labels'), true);
    expect(app.state.options.labels).toBe(true);
    expect(app.map.getContainer().classList.contains('hide-labels')).toBe(false);
  });

  test('sans configuration : pas de synchronisation', async () => {
    const app = await boot({ before: (w) => { delete w.MINECARTE_CONFIG; } });
    expect(app.cloud.enabled).toBe(false);
  });
});

describe('dimensions', () => {
  test('bascule : vue mémorisée par dimension, couches remplacées', async () => {
    const app = await boot();
    app.map.setView(ll(100, 50), 2, { animate: false });
    $('.dim-btn[data-dim="nether"]').click();
    expect(app.state.dim).toBe('nether');
    expect(app.map.getZoom()).toBe(1);
    expect($('.dim-btn[data-dim="nether"]').classList.contains('active')).toBe(true);
    expect($('.dim-btn[data-dim="overworld"]').classList.contains('active')).toBe(false);
    const terrains = layers(app, (l) => l instanceof Terrain.TerrainLayer);
    expect(terrains).toHaveLength(1);
    expect(terrains[0].options.dimension).toBe('nether');
    expect(app.map.getContainer().style.background).toBe(css(Terrain.background.nether));
    $('.dim-btn[data-dim="overworld"]').click();
    expect(app.map.getZoom()).toBe(2);
    expect(app.map.getCenter()).toEqual(ll(100, 50));
    expect(layers(app, (l) => l instanceof Terrain.TerrainLayer)[0].options.dimension).toBe('overworld');
  });

  test('même dimension : rien ne change', async () => {
    const app = await boot();
    app.map.setView(ll(10, 10), 3, { animate: false });
    $('.dim-btn[data-dim="overworld"]').click();
    expect(app.map.getZoom()).toBe(3);
  });

  test('ancre modifiée à la main', async () => {
    const app = await boot();
    location.hash = '#end/5/6/-1';
    await new Promise((r) => window.addEventListener('hashchange', r, { once: true }));
    expect(app.state.dim).toBe('end');
    expect(app.map.getZoom()).toBe(-1);
    expect(text('#coords')).toBe('X 5  Z 6  ·  Chunk 0, 0  ·  Région r.0.0');
    location.hash = '#rien';
    await new Promise((r) => window.addEventListener('hashchange', r, { once: true }));
    expect(app.state.dim).toBe('end');
  });

  test('l’ancre suit les déplacements', async () => {
    const app = await boot();
    app.map.setView(ll(-33, 12), 1, { animate: false });
    expect(location.hash).toBe('#overworld/-33/12/1');
  });
});

const MANIFEST = {
  items: [
    { id: 'minecraft:diamond', readable: 'Diamond', texture: 'item/diamond.png' },
    { id: 'minecraft:totem_of_undying', readable: 'Totem of Undying', texture: 'item/totem.png' },
  ],
};
const TEX = 'https://cdn.jsdelivr.net/npm/minecraft-textures@26.3.0/dist/textures/assets/item/diamond.png';
function iconFetch({ fail = false } = {}) {
  return vi.fn(async (url) => {
    if (String(url).includes('/manifest/')) return fail ? new Response('', { status: 503 }) : Response.json(MANIFEST);
    return new Response('{}', { status: 500 });
  });
}

describe('POI sur la carte', () => {
  const pois = [
    POI({ id: 'a', name: 'Alpha', x: 10, z: 20, links: ['b', 'n'] }),
    POI({ id: 'b', name: 'Beta', color: '#1e88e5', x: -5, y: 70, z: 3, links: ['a'] }),
    POI({ id: 'n', name: 'Nether', dim: 'nether', x: 1, z: 2, links: ['a'] }),
  ];

  test('marqueurs de la dimension, étiquettes et liens (un seul trait par paire)', async () => {
    const app = await withData({ pois });
    expect([...app.state.markers.keys()]).toEqual(['a', 'b']);
    const el = app.state.markers.get('b').getElement();
    expect(el.title).toBe('Beta (-5, 70, 3)');
    expect(el.querySelector('.poi-label').textContent).toBe('Beta');
    expect(el.querySelector('.poi-pin').getAttribute('style')).toBe('background:#1e88e5');
    expect(el.classList.contains('poi-icon')).toBe(true);
    expect(app.state.markers.get('a').options.riseOnHover).toBe(true);
    const links = layers(app, (l) => l instanceof L.Polyline && l.options.pane === 'linkPane');
    expect(links).toHaveLength(1);
    expect(links[0].options).toMatchObject({ color: '#ffffff', weight: 2, opacity: 0.7, dashArray: '4 6', interactive: false });
    expect(links[0].getLatLngs()).toEqual([ll(10, 20), ll(-5, 3)]);
    change($('#opt-links'), false);
    expect(layers(app, (l) => l instanceof L.Polyline && l.options.pane === 'linkPane')).toHaveLength(0);
  });

  test('nom échappé dans l’étiquette', async () => {
    const app = await withData({ pois: [POI({ id: 'x', name: '<b>x</b>' })] });
    expect(app.state.markers.get('x').getElement().querySelector('.poi-label').innerHTML).toBe('&lt;b&gt;x&lt;/b&gt;');
  });

  test('icône d’item : image une fois la liste chargée', async () => {
    const app = await withData({ pois: [POI({ id: 'x', name: 'Mine', icon: 'minecraft:diamond' })] }, { fetch: iconFetch() });
    await flush();
    const pin = app.state.markers.get('x').getElement().querySelector('.poi-pin');
    expect(pin.classList.contains('poi-pin-item')).toBe(true);
    expect(pin.getAttribute('style')).toBe('border-color:#e53935');
    expect(pin.querySelector('img').getAttribute('src')).toBe(TEX);
    const dot = $('#poi-list .dot');
    expect(dot.className).toBe('dot dot-item');
    expect(dot.getAttribute('style')).toBe('border-color:#e53935');
    expect(dot.querySelector('img').getAttribute('src')).toBe(TEX);
  });

  test('icônes chargées seulement si un POI en utilise, échec silencieux', async () => {
    let f = iconFetch();
    await withData({ pois: [POI({ id: 'x' })] }, { fetch: f });
    await flush();
    expect(f).not.toHaveBeenCalled();
    f = iconFetch({ fail: true });
    const app = await withData({ pois: [POI({ id: 'x', icon: 'minecraft:diamond' })] }, { fetch: f });
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    expect(app.state.markers.get('x').getElement().querySelector('img')).toBeNull();
    // Une modification relance le chargement.
    app.store.savePoi({ ...app.store.getPoi('x'), name: 'y' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('popup : coordonnées, conversion, liens et actions', async () => {
    const app = await withData({ pois });
    app.state.markers.get('a').fire('click');
    const p = popup();
    expect(p.querySelector('.popup-title').textContent).toBe('Alpha');
    expect(p.querySelector('.popup-coords').textContent).toBe('X 10Y 64Z 20');
    expect(p.querySelector('.popup-coords .y').title).toBe('Hauteur (information)');
    expect(p.querySelector('.popup-sub').textContent).toBe('≈ Nether : X 1, Z 2');
    const linkBtns = p.querySelectorAll('.link-btn');
    expect(linkBtns).toHaveLength(2);
    expect(linkBtns[0].title).toBe('Aller à Beta');
    expect(linkBtns[0].querySelector('.badge')).toBeNull();
    expect(linkBtns[1].querySelector('.badge').textContent).toBe('Nether');
    expect(linkBtns[1].querySelector('.badge').className).toBe('badge badge-nether');
    expect(linkBtns[1].querySelector('.arrow').textContent).toBe('➜');
    expect(button('Portail Nether', p).title).toBe('Créer un lieu lié dans le Nether aux coordonnées converties');
    const leafletPopup = app.map._popup;
    expect(leafletPopup.options).toMatchObject({ offset: [0, -4], minWidth: 220, maxWidth: 320 });
    expect(leafletPopup.getLatLng()).toEqual(ll(10, 20));
  });

  test('popup : sans lien, sans conversion dans l’End', async () => {
    const app = await withData({ pois: [POI({ id: 'e', name: 'Fin', dim: 'end' })] }, { hash: '#end/0/0/0' });
    app.state.markers.get('e').fire('click');
    expect(popup().querySelector('.popup-sub')).toBeNull();
    expect(popup().querySelector('.popup-links')).toBeNull();
    expect(popup().textContent).not.toContain('Portail');
  });

  test('lien vers un autre POI : même vue, déplacement animé, saut lointain, autre dimension', async () => {
    const app = await withData({ pois: [
      POI({ id: 'a', name: 'A', links: ['b', 'c', 'd', 'n'] }),
      POI({ id: 'b', name: 'Proche', x: 20, z: 20 }),
      POI({ id: 'c', name: 'Moyen', x: 500, z: 0 }),
      POI({ id: 'd', name: 'Loin', x: 50000, z: 0 }),
      POI({ id: 'n', name: 'Nether', dim: 'nether', x: 7, z: 8 }),
    ] });
    const go = (name) => { app.state.markers.get('a').fire('click'); button(name, popup()).click(); };
    app.map.setZoom(-1, { animate: false });
    go('Proche');
    expect(app.map.getCenter()).toEqual(L.latLng(0, 0));
    expect(popup().querySelector('.popup-title').textContent).toBe('Proche');
    const el = app.state.markers.get('b').getElement();
    expect(el.classList.contains('pulse')).toBe(true);

    app.map.setView(ll(0, 0), 0, { animate: false });
    const moved = new Promise((r) => app.map.once('moveend', r));
    const fly = vi.spyOn(app.map, 'flyTo');
    go('Moyen');
    expect(fly).toHaveBeenCalledWith(ll(500, 0), 0, { duration: 0.6 });
    await moved;
    expect(popup().querySelector('.popup-title').textContent).toBe('Moyen');

    app.map.setView(ll(0, 0), -2, { animate: false });
    go('Loin');
    expect(app.map.getCenter()).toEqual(ll(50000, 0));
    // Zoom jamais négatif après un saut.
    expect(app.map.getZoom()).toBe(0);
    expect(popup().querySelector('.popup-title').textContent).toBe('Loin');

    app.map.setView(ll(0, 0), 0, { animate: false });
    app.state.markers.get('a').fire('click');
    app.map.setZoom(3, { animate: false });
    button('Nether', popup()).click();
    expect(app.state.dim).toBe('nether');
    expect(app.map.getZoom()).toBe(3);
    expect(app.map.getCenter()).toEqual(ll(7, 8));
    expect(popup().querySelector('.popup-title').textContent).toBe('Nether');
  });

  test('lien vers un POI supprimé entre-temps, marqueur sans élément', async () => {
    const app = await withData({ pois: [POI({ id: 'a', name: 'A', links: ['b'] }), POI({ id: 'b', name: 'B' })] });
    app.state.markers.get('a').fire('click');
    const btn = button('B', popup());
    app.store.data.pois = app.store.data.pois.filter((p) => p.id !== 'b');
    btn.click();
    expect(popup().querySelector('.popup-title').textContent).toBe('A');
    app.state.markers.delete('a');
    $('#poi-list .item').click();
    expect(popup().querySelector('.popup-title').textContent).toBe('A');
  });

  test('actions de la popup : modifier, portail, copier, supprimer', async () => {
    const app = await withData({ pois: [POI({ id: 'a', name: 'Base', icon: 'minecraft:diamond', x: 80, y: 12, z: -16 })] });
    app.state.markers.get('a').fire('click');
    button('Modifier', popup()).click();
    expect($('#poi-dialog').open).toBe(true);
    expect($('#poi-dialog-title').textContent).toBe('Modifier le lieu');
    expect($('#poi-form').elements.label.value).toBe('Base');
    $('#poi-dialog').close();

    app.state.markers.get('a').fire('click');
    button('Portail Nether', popup()).click();
    const f = $('#poi-form').elements;
    expect($('#poi-dialog-title').textContent).toBe('Nouveau lieu');
    expect([f.label.value, f.dim.value, f.x.value, f.y.value, f.z.value, f.icon.value])
      .toEqual(['Base (Nether)', 'nether', '10', '12', '-2', 'minecraft:diamond']);
    expect($('#poi-links input:checked').value).toBe('a');
    $('#poi-dialog').close();

    vi.stubGlobal('prompt', vi.fn());
    app.state.markers.get('a').fire('click');
    button('Copier', popup()).click();
    expect(prompt).toHaveBeenCalledWith('Copier :', '80 12 -16');

    vi.stubGlobal('confirm', vi.fn(() => false));
    button('Supprimer', popup()).click();
    expect(confirm).toHaveBeenCalledWith('Supprimer le lieu « Base » ?');
    expect(app.store.data.pois).toHaveLength(1);
    confirm.mockReturnValue(true);
    button('Supprimer', popup()).click();
    expect(app.store.data.pois).toHaveLength(0);
    expect(popup()).toBeNull();
  });

  test('portail depuis le Nether vers l’Overworld', async () => {
    const app = await withData({ pois: [POI({ id: 'n', name: 'N', dim: 'nether', x: 3, z: -1 })] }, { hash: '#nether/0/0/0' });
    app.state.markers.get('n').fire('click');
    const b = button('Portail Overworld', popup());
    expect(b.title).toBe("Créer un lieu lié dans l'Overworld aux coordonnées converties");
    b.click();
    expect($('#poi-form').elements.x.value).toBe('24');
    expect($('#poi-form').elements.z.value).toBe('-8');
  });
});

describe('copie', () => {
  test('presse-papiers disponible : copie puis message', async () => {
    const app = await withData({ pois: [POI({ id: 'a', x: 1, y: 2, z: 3 })] });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('prompt', vi.fn());
    app.state.markers.get('a').fire('click');
    button('Copier', popup()).click();
    await flush();
    expect(writeText).toHaveBeenCalledWith('1 2 3');
    expect(text('#toast')).toBe('Copié : 1 2 3');
    expect($('#toast').hidden).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
    writeText.mockRejectedValue(new Error('refus'));
    button('Copier', popup()).click();
    await flush();
    expect(prompt).toHaveBeenCalledWith('Copier :', '1 2 3');
  });

  test('contexte non sécurisé : invite de copie', async () => {
    const app = await withData({ pois: [POI({ id: 'a' })] });
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } });
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('prompt', vi.fn());
    app.state.markers.get('a').fire('click');
    button('Copier', popup()).click();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledWith('Copier :', '0 64 0');
  });

  test('le message disparaît après 2,2 s, minuterie relancée', async () => {
    const app = await withData({ pois: [POI({ id: 'a' })] });
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    vi.stubGlobal('isSecureContext', true);
    app.state.markers.get('a').fire('click');
    button('Copier', popup()).click();
    await vi.advanceTimersByTimeAsync(2000);
    button('Copier', popup()).click();
    await vi.advanceTimersByTimeAsync(2000);
    expect($('#toast').hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect($('#toast').hidden).toBe(true);
  });
});

describe('listes du panneau', () => {
  test('POI triés, filtrés, toutes dimensions, liens, vide', async () => {
    const app = await withData({ pois: [
      POI({ id: 'z', name: 'Zèbre', x: 1, y: 2, z: 3, links: ['e'] }),
      POI({ id: 'e', name: 'Écurie' }),
      POI({ id: 'n', name: 'Nid', dim: 'nether' }),
    ] });
    const names = () => $$('#poi-list .item-name').map((e) => e.textContent);
    expect(names()).toEqual(['Écurie', 'Zèbre']);
    expect($$('#poi-list .item')[1].querySelector('.item-sub').textContent).toBe('X 1 · Y 2 · Z 3');
    expect($$('#poi-list .item')[1].querySelector('.item-links').textContent).toBe('🔗 1');
    expect($$('#poi-list .item')[1].querySelector('.item-links').title).toBe('Liens');
    expect($('#poi-list .badge')).toBeNull();
    change($('#poi-all-dims'), true);
    expect(names()).toEqual(['Écurie', 'Nid', 'Zèbre']);
    expect($$('#poi-list .item')[1].querySelector('.badge').textContent).toBe('Nether');
    expect($$('#poi-list .badge')).toHaveLength(1);
    input($('#poi-search'), '  ZÈ ');
    expect(names()).toEqual(['Zèbre']);
    input($('#poi-search'), 'rien');
    expect(text('#poi-list')).toBe('Aucun résultat.');
    input($('#poi-search'), '');
    app.store.replaceAll({});
    expect(text('#poi-list')).toBe('Aucun lieu. Clic droit sur la carte ou « + Lieu ».');
    expect($('#poi-list li').className).toBe('empty');
  });

  test('un clic sur un POI d’une autre dimension y va', async () => {
    const app = await withData({ pois: [POI({ id: 'n', name: 'Nid', dim: 'nether', x: 4, z: 4 })] }, { storage: { 'minecarte:options': { allDims: true } } });
    $('#poi-list .item').click();
    expect(app.state.dim).toBe('nether');
    expect(popup().querySelector('.popup-title').textContent).toBe('Nid');
  });

  test('sur mobile, aller à un POI ferme le panneau', async () => {
    const app = await withData({ pois: [POI({ id: 'a' })] }, { width: 600 });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    document.body.classList.remove('sidebar-hidden');
    const inv = vi.spyOn(app.map, 'invalidateSize');
    $('#poi-list .item').click();
    expect(document.body.classList.contains('sidebar-hidden')).toBe(true);
    vi.advanceTimersByTime(219);
    expect(inv).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(inv).toHaveBeenCalled();
  });
});

describe('dialogue POI', () => {
  test('nouveau POI au centre de la vue, couleurs, enregistrement', async () => {
    const app = await withData({ pois: [POI({ id: 'o', name: 'Autre' })] });
    app.map.setView(ll(40, -8), 1, { animate: false });
    $('#add-poi').click();
    const f = $('#poi-form').elements;
    expect($('#poi-dialog-title').textContent).toBe('Nouveau lieu');
    expect([f.id.value, f.label.value, f.color.value, f.dim.value, f.x.value, f.y.value, f.z.value, f.icon.value])
      .toEqual(['', '', '#e53935', 'overworld', '40', '64', '-8', '']);
    expect($('#icon-picker').hidden).toBe(true);
    expect(document.activeElement).toBe(f.label);
    const sw = $$('#poi-form .swatches .swatch');
    expect(sw).toHaveLength(Utils.SWATCHES.length);
    expect(sw[2].title).toBe(Utils.SWATCHES[2]);
    expect(sw[2].getAttribute('style')).toBe(`background:${Utils.SWATCHES[2]}`);
    sw[2].click();
    expect(f.color.value).toBe(Utils.SWATCHES[2]);
    f.label.value = 'Maison';
    f.z.value = '5';
    $('#poi-links input').click();
    submit($('#poi-form'));
    expect($('#poi-dialog').open).toBe(false);
    const saved = app.store.data.pois.find((p) => p.name === 'Maison');
    expect(saved).toMatchObject({ color: Utils.SWATCHES[2], x: 40, y: 64, z: 5, links: ['o'], icon: '' });
    expect(popup().querySelector('.popup-title').textContent).toBe('Maison');
  });

  test('modification : liens décochés, filtre, POI courant exclu', async () => {
    const app = await withData({ pois: [
      POI({ id: 'a', name: 'A', links: ['b'] }),
      POI({ id: 'b', name: 'Bravo', x: 3, z: 4 }),
      POI({ id: 'c', name: 'Charlie', dim: 'end' }),
      POI({ id: 'd', name: 'Delta', dim: 'nether' }),
      POI({ id: 'e', name: 'Écho', dim: 'nether' }),
    ] });
    app.state.markers.get('a').fire('click');
    button('Modifier', popup()).click();
    const names = () => $$('#poi-links .link-name').map((e) => e.textContent);
    expect(names()).toEqual(['Bravo', 'Delta', 'Écho', 'Charlie']);
    const first = $('#poi-links .link-option');
    expect(first.querySelector('.item-sub').textContent).toBe('3, 4');
    expect(first.querySelector('.badge').textContent).toBe('Overworld');
    input($('#poi-link-filter'), ' CHAR ');
    // Les POI cochés restent visibles.
    expect(names()).toEqual(['Bravo', 'Charlie']);
    $$('#poi-links input')[1].click();
    $$('#poi-links input')[0].click();
    input($('#poi-link-filter'), '');
    expect($$('#poi-links input:checked').map((i) => i.value)).toEqual(['c']);
    submit($('#poi-form'));
    expect(app.store.getPoi('a').links).toEqual(['c']);
  });

  test('aucun autre POI', async () => {
    await boot();
    $('#add-poi').click();
    expect(text('#poi-links')).toBe('Aucun autre lieu pour le moment.');
  });

  test('fermeture par le bouton', async () => {
    await boot();
    $('#add-poi').click();
    $('#poi-dialog [data-close]').click();
    expect($('#poi-dialog').open).toBe(false);
  });
});

describe('catégories', () => {
  const chips = () => $$('#cat-filter .cat-chip');
  const names = () => $$('#poi-list .item-name').map((e) => e.textContent);

  test('choix dans le dialogue, affichage dans la liste et la popup', async () => {
    const app = await boot();
    $('#add-poi').click();
    const f = $('#poi-form').elements;
    expect([...f.category.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Sans catégorie'],
      ...Store.CATEGORIES.map((c) => [c.id, `${c.emoji} ${c.label}`]),
    ]);
    expect(f.category.value).toBe('');
    f.label.value = 'Champ';
    f.category.value = 'farm';
    submit($('#poi-form'));
    const poi = app.store.data.pois[0];
    expect(poi.category).toBe('farm');
    expect(text('#poi-list .item-sub')).toBe('🌾 Ferme · X 0 · Y 64 · Z 0');
    expect(text('.leaflet-popup-content .popup-cat')).toBe('🌾 Ferme');
    // Modifier : la catégorie est reprise.
    button('Modifier', popup()).click();
    expect(f.category.value).toBe('farm');
  });

  test('sans catégorie : ni mention dans la liste ni dans la popup', async () => {
    const app = await withData({ pois: [POI({ id: 'a', x: 1, y: 2, z: 3 })] });
    expect(text('#poi-list .item-sub')).toBe('X 1 · Y 2 · Z 3');
    app.state.markers.get('a').fire('click');
    expect(popup().querySelector('.popup-cat')).toBeNull();
  });

  test('filtre : une pastille par catégorie utilisée, masquer / afficher', async () => {
    const app = await withData({ pois: [
      POI({ id: 'a', name: 'Maison', category: 'base', links: ['b'] }),
      POI({ id: 'b', name: 'Blé', category: 'farm', x: 50 }),
      POI({ id: 'c', name: 'Carotte', category: 'farm', x: 90 }),
      POI({ id: 'd', name: 'Divers', x: 20 }),
    ] });
    expect($('#cat-filter').hidden).toBe(false);
    expect(chips().map((c) => c.textContent)).toEqual(['Sans catégorie (1)', '🏠 Base (1)', '🌾 Ferme (2)']);
    expect(chips().every((c) => c.getAttribute('aria-pressed') === 'true')).toBe(true);
    expect(chips()[2].title).toBe('Masquer cette catégorie');
    expect(layers(app, (l) => l instanceof L.Polyline && l.options.pane === 'linkPane')).toHaveLength(1);

    chips()[2].click();
    expect(app.state.options.hiddenCats).toEqual(['farm']);
    expect(JSON.parse(localStorage.getItem('minecarte:options')).hiddenCats).toEqual(['farm']);
    expect(names()).toEqual(['Divers', 'Maison']);
    expect([...app.state.markers.keys()].sort()).toEqual(['a', 'd']);
    // Lien vers un lieu masqué : pas de trait.
    expect(layers(app, (l) => l instanceof L.Polyline && l.options.pane === 'linkPane')).toHaveLength(0);
    const off = chips()[2];
    expect(off.className).toBe('cat-chip off');
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(off.title).toBe('Afficher cette catégorie');

    chips()[0].click();
    expect(app.state.options.hiddenCats).toEqual(['farm', '']);
    expect(names()).toEqual(['Maison']);
    chips()[2].click();
    expect(app.state.options.hiddenCats).toEqual(['']);
    expect(names()).toEqual(['Blé', 'Carotte', 'Maison']);
  });

  test('une seule catégorie utilisée : pas de filtre', async () => {
    await withData({ pois: [POI({ id: 'a', category: 'mine' }), POI({ id: 'b', category: 'mine' })] });
    expect($('#cat-filter').hidden).toBe(true);
    expect(chips()).toHaveLength(1);
  });

  test('catégories masquées retrouvées au démarrage', async () => {
    const app = await withData({ pois: [POI({ id: 'a', category: 'mine' }), POI({ id: 'b' })] }, { storage: { 'minecarte:options': { hiddenCats: ['mine'] } } });
    expect([...app.state.markers.keys()]).toEqual(['b']);
  });

  test('enregistrer un lieu dans une catégorie masquée la réaffiche', async () => {
    const app = await withData({ pois: [POI({ id: 'a', category: 'mine' }), POI({ id: 'b' })] }, { storage: { 'minecarte:options': { hiddenCats: ['mine', 'farm'] } } });
    $('#add-poi').click();
    const f = $('#poi-form').elements;
    f.label.value = 'Galerie';
    f.category.value = 'mine';
    submit($('#poi-form'));
    expect(app.state.options.hiddenCats).toEqual(['farm']);
    expect(JSON.parse(localStorage.getItem('minecarte:options')).hiddenCats).toEqual(['farm']);
    expect(app.state.markers.has('a')).toBe(true);
  });

  test('portail : la catégorie est reprise', async () => {
    const app = await withData({ pois: [POI({ id: 'a', name: 'Porte', category: 'portal' })] });
    app.state.markers.get('a').fire('click');
    button('Portail Nether', popup()).click();
    expect($('#poi-form').elements.category.value).toBe('portal');
  });
});

describe('choix de l’icône', () => {
  test('chargement, recherche, choix, retrait', async () => {
    let resolve;
    const f = vi.fn(() => new Promise((r) => { resolve = r; }));
    await boot({ fetch: f });
    $('#add-poi').click();
    expect(text('#icon-current')).toBe('—Aucune (pastille de couleur)');
    expect($('#icon-clear').hidden).toBe(true);
    input($('#icon-search'), 'dia');
    expect($('#icon-grid').children).toHaveLength(0);
    $('#icon-choose').click();
    expect($('#icon-picker').hidden).toBe(false);
    expect(document.activeElement).toBe($('#icon-search'));
    expect(text('#icon-grid')).toBe('Chargement des icônes…');
    resolve(Response.json(MANIFEST));
    await flush();
    expect($$('#icon-grid .icon-cell')).toHaveLength(1);
    const cell = $('#icon-grid .icon-cell');
    expect(cell.title).toBe('Diamond (minecraft:diamond)');
    expect(cell.className).toBe('icon-cell');
    const img = cell.querySelector('img');
    expect([img.getAttribute('src'), img.alt, img.getAttribute('loading')]).toEqual([TEX, 'Diamond', 'lazy']);
    input($('#icon-search'), '');
    expect($$('#icon-grid .icon-cell')).toHaveLength(2);
    input($('#icon-search'), 'zzz');
    expect(text('#icon-grid')).toBe('Aucun item trouvé (recherche en anglais : diamond, totem, bed…).');
    input($('#icon-search'), 'diamond');
    $('#icon-grid .icon-cell').click();
    expect($('#poi-form').elements.icon.value).toBe('minecraft:diamond');
    expect($('#icon-picker').hidden).toBe(true);
    expect(text('#icon-current')).toBe('Diamond');
    expect($('#icon-current img').getAttribute('src')).toBe(TEX);
    expect($('#icon-clear').hidden).toBe(false);
    // Réouverture : liste déjà chargée, item courant repéré.
    $('#icon-choose').click();
    expect($('#icon-grid .icon-cell').className).toBe('icon-cell selected');
    $('#icon-choose').click();
    expect($('#icon-picker').hidden).toBe(true);
    $('#icon-clear').click();
    expect($('#poi-form').elements.icon.value).toBe('');
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('échec du chargement', async () => {
    await boot({ fetch: iconFetch({ fail: true }) });
    $('#add-poi').click();
    $('#icon-choose').click();
    await flush();
    expect(text('#icon-grid')).toBe('Impossible de charger les icônes (connexion internet requise).');
  });

  test('Entrée dans la recherche ne soumet pas le formulaire', async () => {
    await boot();
    expect(key('Enter', {}, $('#icon-search')).defaultPrevented).toBe(true);
    expect(key('a', {}, $('#icon-search')).defaultPrevented).toBe(false);
  });

  test('icône inconnue : nom lisible sans image', async () => {
    const app = await withData({ pois: [POI({ id: 'a', icon: 'minecraft:old_thing' })] });
    app.state.markers.get('a').fire('click');
    button('Modifier', popup()).click();
    expect(text('#icon-current')).toBe('—old thing');
  });
});

const PATH = (o) => ({ name: 'Route', color: '#43a047', dim: 'overworld', weight: 4, points: [[0, 0], [30, 40]], ...o });
const pathLines = (app) => layers(app, (l) => l instanceof L.Polyline && l.options.pane === 'pathPane' && l.options.interactive !== false);
const vertices = (app) => layers(app, (l) => l instanceof L.Marker && l.options.draggable);
const mouse = (x = 0, y = 0) => new MouseEvent('contextmenu', { clientX: x, clientY: y });

describe('chemins', () => {
  test('tracés de la dimension avec ombre et infobulle', async () => {
    const app = await withData({ paths: [PATH({ id: 'r', name: '<i>R</i>' }), PATH({ id: 'n', dim: 'nether' })] });
    const lines = pathLines(app);
    expect(lines).toHaveLength(1);
    expect(lines[0].options).toMatchObject({ color: '#43a047', weight: 4, opacity: 0.95 });
    expect(lines[0].getLatLngs()).toEqual([ll(0, 0), ll(30, 40)]);
    expect(lines[0].getTooltip().getContent()).toBe('&lt;i&gt;R&lt;/i&gt;');
    expect(lines[0].getTooltip().options.sticky).toBe(true);
    const shadow = layers(app, (l) => l instanceof L.Polyline && l.options.pane === 'pathPane' && l.options.interactive === false);
    expect(shadow).toHaveLength(1);
    expect(shadow[0].options).toMatchObject({ color: '#000', weight: 7, opacity: 0.35 });
    expect(text('#path-list .item-name')).toBe('<i>R</i>');
    expect(text('#path-list .item-sub')).toBe('50 blocs · 2 points');
    expect($('#path-list .swatch-line').getAttribute('style')).toBe('background:#43a047');
  });

  test('liste vide', async () => {
    await boot();
    expect(text('#path-list')).toBe('Aucun chemin dans cette dimension. Clic droit sur la carte ou « + Tracer un chemin ».');
    expect($('#path-list li').className).toBe('empty');
  });

  test('popup : longueur, équivalent Overworld dans le Nether, actions', async () => {
    const app = await withData({ paths: [PATH({ id: 'n', dim: 'nether' })] }, { hash: '#nether/0/0/0' });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    const subs = [...popup().querySelectorAll('.popup-sub')].map((e) => e.textContent);
    expect(subs).toEqual(['50 blocs · 2 points', "≈ 400 blocs dans l'Overworld"]);
    expect(popup().querySelector('.popup-title').textContent).toBe('Route');
    expect(app.map._popup.getLatLng()).toEqual(ll(3, 4));
    expect(app.map._popup.options.minWidth).toBe(220);
    button('Modifier', popup()).click();
    expect(popup()).toBeNull();
    const f = $('#path-form').elements;
    expect([f.id.value, f.label.value, f.color.value, f.weight.value]).toEqual(['n', 'Route', '#43a047', '4']);
    expect(text('#path-info')).toBe('Nether · 50 blocs · 2 points');
    expect(text('#weight-value')).toBe('4 px');
    expect($('#weight-preview').style.cssText).toBe('height: 4px; background: rgb(67, 160, 71);');
    expect(document.activeElement).toBe(f.label);
  });

  test('popup dans l’Overworld : pas d’équivalent', async () => {
    const app = await withData({ paths: [PATH({ id: 'r' })] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    expect(popup().querySelectorAll('.popup-sub')).toHaveLength(1);
  });

  test('dialogue : largeur, couleur, enregistrement', async () => {
    const app = await withData({ paths: [PATH({ id: 'r' })] });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    button('Modifier', popup()).click();
    const f = $('#path-form').elements;
    input(f.weight, '9');
    expect(text('#weight-value')).toBe('9 px');
    input(f.color, '#000000');
    expect($('#weight-preview').style.cssText).toBe('height: 9px; background: rgb(0, 0, 0);');
    $('#path-form .swatch').click();
    vi.runAllTimers();
    expect($('#weight-preview').style.background).toBe(css(Utils.SWATCHES[0]));
    f.label.value = 'Autoroute';
    submit($('#path-form'));
    expect($('#path-dialog').open).toBe(false);
    expect(app.store.getPath('r')).toMatchObject({ name: 'Autoroute', color: Utils.SWATCHES[0], weight: 9 });
  });

  test('dialogue : chemin supprimé entre-temps', async () => {
    const app = await withData({ paths: [PATH({ id: 'r' })] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    button('Modifier', popup()).click();
    app.store.deletePath('r');
    submit($('#path-form'));
    expect($('#path-dialog').open).toBe(false);
    expect(app.store.data.paths).toEqual([]);
  });

  test('suppression avec confirmation', async () => {
    const app = await withData({ paths: [PATH({ id: 'r' })] });
    vi.stubGlobal('confirm', vi.fn(() => false));
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    button('Supprimer', popup()).click();
    expect(confirm).toHaveBeenCalledWith('Supprimer le chemin « Route » ?');
    expect(app.store.data.paths).toHaveLength(1);
    confirm.mockReturnValue(true);
    button('Supprimer', popup()).click();
    expect(app.store.data.paths).toHaveLength(0);
    expect(popup()).toBeNull();
  });

  test('aller à un chemin depuis la liste : cadrage et popup au point du milieu', async () => {
    const app = await withData({ paths: [PATH({ id: 'r', points: [[0, 0], [10, 0], [200, 0]] })] });
    const fit = vi.spyOn(app.map, 'fitBounds');
    $('#path-list .item').click();
    expect(fit.mock.calls[0][0]).toEqual(L.latLngBounds([ll(0, 0), ll(200, 0)]).pad(0.2));
    expect(fit.mock.calls[0][1]).toMatchObject({ maxZoom: 2, animate: false });
    expect(app.map._popup.getLatLng()).toEqual(ll(10, 0));
  });
});

describe('tracé d’un chemin', () => {
  test('points au clic, accroche aux POI, doublons ignorés, aperçu, fin au double-clic', async () => {
    const app = await withData({ pois: [POI({ id: 'a', x: 50, z: 50 })], paths: [PATH({ id: 'r' })] });
    $('#new-path').click();
    expect(app.state.mode).toBe('draw');
    expect(app.map.doubleClickZoom.enabled()).toBe(false);
    expect(app.map.getContainer().classList.contains('drawing')).toBe(true);
    expect($('#mode-banner').hidden).toBe(false);
    expect($('#mode-undo').hidden).toBe(false);
    expect(text('#mode-text')).toBe('Tracé — 0 point(s), 0 blocs. Clic : ajouter · clic sur un lieu : s’y accrocher · double-clic / Entrée : terminer');
    // Pas d'aperçu sans point.
    app.map.fire('mousemove', { latlng: ll(5, 5) });
    expect(app.state.draw.preview.getLatLngs()).toEqual([]);
    app.map.fire('click', { latlng: ll(0, 0) });
    app.map.fire('click', { latlng: L.latLng(-0.9, 0.1) });
    app.state.markers.get('a').fire('click');
    expect(app.state.draw.points).toEqual([[0, 0], [50, 50]]);
    expect(popup()).toBeNull();
    expect(text('#mode-text')).toContain('2 point(s), 71 blocs');
    const vs = layers(app, (l) => l instanceof L.CircleMarker && l.options.fillColor === app.state.draw.color);
    expect(vs).toHaveLength(2);
    expect(vs[0].options).toMatchObject({ radius: 4, color: '#fff', weight: 2, fillOpacity: 1, interactive: false });
    app.map.fire('mousemove', { latlng: ll(60, 60) });
    expect(app.state.draw.preview.getLatLngs()).toEqual([ll(50, 50), ll(60, 60)]);
    expect(app.state.draw.color).toBe(Utils.SWATCHES[1]);
    app.map.fire('dblclick');
    expect(app.state.mode).toBe(null);
    expect(app.map.doubleClickZoom.enabled()).toBe(true);
    expect(app.map.getContainer().classList.contains('drawing')).toBe(false);
    expect($('#mode-banner').hidden).toBe(true);
    const created = app.store.data.paths[1];
    expect(created).toMatchObject({ name: 'Chemin 2', color: Utils.SWATCHES[1], dim: 'overworld', points: [[0, 0], [50, 50]], weight: 4 });
    expect($('#path-dialog').open).toBe(true);
    expect($('#path-form').elements.id.value).toBe(created.id);
  });

  test('moins de 2 points : refusé', async () => {
    const app = await boot();
    $('#new-path').click();
    app.map.fire('click', { latlng: ll(0, 0) });
    button('Terminer', $('#mode-banner')).click();
    expect(text('#toast')).toBe('Un chemin doit avoir au moins 2 points.');
    expect(app.state.mode).toBe('draw');
  });

  test('annuler le dernier point, abandonner', async () => {
    const app = await boot();
    $('#new-path').click();
    app.map.fire('click', { latlng: ll(0, 0) });
    app.map.fire('click', { latlng: ll(5, 0) });
    app.map.fire('mousemove', { latlng: ll(9, 9) });
    $('#mode-undo').click();
    expect(app.state.draw.points).toEqual([[0, 0]]);
    expect(app.state.draw.preview.getLatLngs()).toEqual([]);
    $('#mode-cancel').click();
    expect(app.state.mode).toBe(null);
    expect(app.store.data.paths).toEqual([]);
    // Hors tracé : rien.
    $('#mode-undo').click();
    $('#mode-cancel').click();
    $('#mode-finish').click();
    expect(app.state.mode).toBe(null);
  });

  test('prolonger un chemin existant', async () => {
    const app = await withData({ paths: [PATH({ id: 'r', color: '#8e24aa', weight: 7 })] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    button('Prolonger', popup()).click();
    expect(app.state.draw.pathId).toBe('r');
    expect(app.state.draw.line.options).toMatchObject({ color: '#8e24aa', weight: 7 });
    expect(app.state.draw.preview.options).toMatchObject({ weight: 2, dashArray: '6 6' });
    // Le chemin prolongé n'est plus dessiné à part.
    expect(pathLines(app)).toHaveLength(0);
    expect(text('#mode-text')).toContain('Tracé (prolongement) — 2 point(s)');
    // Clics sur le tracé ignorés pendant le mode.
    app.map.fire('click', { latlng: ll(30, 80) });
    key('Enter');
    expect(app.store.getPath('r').points).toEqual([[0, 0], [30, 40], [30, 80]]);
    expect($('#path-dialog').open).toBe(false);
  });

  test('prolonger un chemin supprimé : nouveau tracé', async () => {
    const app = await withData({ paths: [PATH({ id: 'r' })] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    const b = button('Prolonger', popup());
    app.store.deletePath('r');
    b.click();
    expect(app.state.draw.pathId).toBe(null);
    expect(app.state.draw.points).toEqual([]);
    expect(app.state.draw.color).toBe(Utils.SWATCHES[0]);
  });

  test('pendant un mode : popups et menu désactivés', async () => {
    const app = await withData({ pois: [POI({ id: 'a' })], paths: [PATH({ id: 'r' }), PATH({ id: 's' })] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    button('Éditer le tracé', popup()).click();
    const other = pathLines(app).find((l) => l !== app.state.edit.line);
    other.fire('click', { latlng: ll(3, 4) });
    app.state.markers.get('a').fire('click');
    app.map.fire('contextmenu', { latlng: ll(0, 0), originalEvent: mouse() });
    expect(popup()).toBeNull();
    expect($('#context-menu').hidden).toBe(true);
    app.map.fire('dblclick', { latlng: ll(0, 0), containerPoint: L.point(0, 0), originalEvent: new MouseEvent('dblclick') });
    expect(app.state.mode).toBe('edit');
  });

  test('changer de dimension annule le tracé', async () => {
    const app = await boot();
    $('#new-path').click();
    $('.dim-btn[data-dim="end"]').click();
    expect(app.state.mode).toBe(null);
  });

  test('sur mobile, le panneau se ferme', async () => {
    await boot({ width: 700 });
    document.body.classList.remove('sidebar-hidden');
    $('#new-path').click();
    expect(document.body.classList.contains('sidebar-hidden')).toBe(true);
  });
});

describe('édition d’un tracé', () => {
  const start = async (points = [[0, 0], [100, 0], [100, 100]]) => {
    const app = await withData({ paths: [PATH({ id: 'r', weight: 3, points })] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    button('Éditer le tracé', popup()).click();
    return app;
  };

  test('bandeau, sommets, ligne épaissie', async () => {
    const app = await start();
    expect(app.state.mode).toBe('edit');
    expect(app.map.getContainer().classList.contains('editing')).toBe(true);
    expect($('#mode-undo').hidden).toBe(true);
    expect(text('#mode-text')).toBe('Édition de « Route » — 3 points, 200 blocs. Glisser : déplacer · clic sur un segment : insérer · clic droit sur un sommet : supprimer');
    expect(app.state.edit.line.options.weight).toBe(6);
    expect(vertices(app)).toHaveLength(3);
    expect(vertices(app)[0].options).toMatchObject({ zIndexOffset: 1000 });
    expect(vertices(app)[0].options.icon.options).toMatchObject({ className: 'vertex-icon', iconSize: [12, 12] });
  });

  test('ligne épaisse : +2', async () => {
    const app = await withData({ paths: [PATH({ id: 'r', weight: 8 })] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    button('Éditer le tracé', popup()).click();
    expect(app.state.edit.line.options.weight).toBe(10);
  });

  test('glisser un sommet, insérer, supprimer, terminer', async () => {
    const app = await start();
    const v = vertices(app)[1];
    v.setLatLng(ll(90, 10));
    v.fire('drag');
    expect(app.state.edit.points[1]).toEqual([90, 10]);
    expect(app.state.edit.line.getLatLngs()[1]).toEqual(ll(90, 10));
    expect(text('#coords')).toContain('X 90  Z 10');
    v.fire('dragend');
    expect(text('#mode-text')).toContain('3 points');
    const stopped = new MouseEvent('click');
    app.state.edit.line.fire('click', { latlng: ll(95, 60), originalEvent: stopped });
    expect(app.state.edit.points).toEqual([[0, 0], [90, 10], [95, 60], [100, 100]]);
    expect(vertices(app)).toHaveLength(4);
    vertices(app)[0].fire('contextmenu', { originalEvent: mouse() });
    expect(app.state.edit.points).toEqual([[90, 10], [95, 60], [100, 100]]);
    key('Enter');
    expect(app.state.mode).toBe(null);
    expect(app.store.getPath('r').points).toEqual([[90, 10], [95, 60], [100, 100]]);
    expect(pathLines(app)).toHaveLength(1);
  });

  test('insertion sur le premier segment', async () => {
    const app = await start();
    app.state.edit.line.fire('click', { latlng: ll(50, 1), originalEvent: new MouseEvent('click') });
    expect(app.state.edit.points[1]).toEqual([50, 1]);
  });

  test('au moins 2 points gardés', async () => {
    const app = await start([[0, 0], [10, 0]]);
    vertices(app)[0].fire('contextmenu', { originalEvent: mouse() });
    expect(text('#toast')).toBe('Un chemin doit garder au moins 2 points.');
    expect(app.state.edit.points).toHaveLength(2);
  });

  test('chemin supprimé pendant l’édition', async () => {
    const app = await start();
    app.store.deletePath('r');
    $('#mode-finish').click();
    expect(app.state.mode).toBe(null);
    expect(app.store.data.paths).toEqual([]);
  });

  test('éditer un chemin disparu : rien', async () => {
    const app = await withData({ paths: [PATH({ id: 'r' })] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    const b = button('Éditer le tracé', popup());
    app.store.deletePath('r');
    b.click();
    expect(app.state.mode).toBe(null);
  });
});

describe('menu contextuel', () => {
  test('actions : POI, chemin, copie, centrer', async () => {
    const app = await boot();
    const open = () => app.map.fire('contextmenu', { latlng: ll(12, -7), originalEvent: mouse(100, 50) });
    open();
    const menu = $('#context-menu');
    expect(menu.hidden).toBe(false);
    expect(text('.menu-title')).toBe('X 12 · Z -7');
    expect([menu.style.left, menu.style.top]).toEqual(['100px', '50px']);
    button('Ajouter un lieu', menu).click();
    expect(menu.hidden).toBe(true);
    expect($('#poi-form').elements.x.value).toBe('12');
    expect($('#poi-form').elements.z.value).toBe('-7');
    $('#poi-dialog').close();
    open();
    button('Commencer un chemin', menu).click();
    expect(app.state.draw.points).toEqual([[12, -7]]);
    $('#mode-cancel').click();
    vi.stubGlobal('prompt', vi.fn());
    open();
    button('Copier', menu).click();
    expect(prompt).toHaveBeenCalledWith('Copier :', '12 ~ -7');
    open();
    const pan = vi.spyOn(app.map, 'panTo');
    button('Centrer', menu).click();
    expect(pan).toHaveBeenCalledWith(ll(12, -7));
  });

  test('position gardée dans la fenêtre', async () => {
    const app = await boot();
    const menu = $('#context-menu');
    Object.defineProperty(menu, 'offsetWidth', { value: 200 });
    Object.defineProperty(menu, 'offsetHeight', { value: 100 });
    window.innerHeight = 700;
    app.map.fire('contextmenu', { latlng: ll(0, 0), originalEvent: mouse(1200, 690) });
    expect([menu.style.left, menu.style.top]).toEqual(['1076px', '596px']);
    app.map.fire('contextmenu', { latlng: ll(0, 0), originalEvent: mouse(-50, 1) });
    expect([menu.style.left, menu.style.top]).toEqual(['4px', '4px']);
  });

  test('fermeture : clic ailleurs, clic sur la carte, déplacement, Échap', async () => {
    const app = await boot();
    const open = () => app.map.fire('contextmenu', { latlng: ll(0, 0), originalEvent: mouse() });
    const menu = $('#context-menu');
    open();
    menu.querySelector('.menu-title').click();
    expect(menu.hidden).toBe(false);
    $('#sidebar').click();
    expect(menu.hidden).toBe(true);
    open();
    app.map.fire('click', { latlng: ll(0, 0) });
    expect(menu.hidden).toBe(true);
    open();
    app.map.fire('movestart');
    expect(menu.hidden).toBe(true);
    open();
    app.map.fire('zoomstart');
    expect(menu.hidden).toBe(true);
    open();
    key('Escape');
    expect(menu.hidden).toBe(true);
  });
});

describe('clavier', () => {
  test('raccourcis du tracé', async () => {
    const app = await boot();
    $('#new-path').click();
    for (const [x, z] of [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]) app.map.fire('click', { latlng: ll(x, z) });
    expect(key('Backspace').defaultPrevented).toBe(true);
    key('z', { ctrlKey: true });
    key('z', { metaKey: true });
    expect(app.state.draw.points).toEqual([[0, 0], [1, 0]]);
    expect(key('z').defaultPrevented).toBe(false);
    expect(key('x', { ctrlKey: true }).defaultPrevented).toBe(false);
    // En saisie : ignoré, sauf Échap.
    key('Backspace', {}, $('#poi-search'));
    key('Enter', {}, $('#poi-search'));
    expect(app.state.draw.points).toHaveLength(2);
    key('Escape', {}, $('#poi-search'));
    expect(app.state.mode).toBe(null);
  });

  test('sans mode : Entrée et Retour arrière ne font rien', async () => {
    const app = await withData({ paths: [PATH({ id: 'r' })] });
    expect(key('Enter').defaultPrevented).toBe(false);
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    button('Éditer le tracé', popup()).click();
    expect(key('Backspace').defaultPrevented).toBe(false);
    expect(app.state.mode).toBe('edit');
  });

  test('dialogue ouvert : raccourcis inactifs', async () => {
    const app = await boot();
    $('#new-path').click();
    $('#poi-dialog').showModal();
    key('Escape');
    expect(app.state.mode).toBe('draw');
    $('#poi-dialog').close();
    key('Escape');
    expect(app.state.mode).toBe(null);
  });
});

describe('recherche de coordonnées', () => {
  const go = (x, z, y = '') => {
    input($('#global-search'), y === '' ? `${x} ${z}` : `${x} ${y} ${z}`);
    submit($('#search'));
  };

  test('décimales : le bloc qui les contient', async () => {
    await boot();
    go('-0.5', '2.6');
    expect(popup().querySelector('.popup-title').textContent).toBe('📌 X -1 · Z 2');
  });

  test('emplacement avec hauteur : repère, conversion, POI', async () => {
    const app = await withData({ pois: [] });
    app.map.setZoom(3, { animate: false });
    go('80.4', '-16', '70');
    expect(app.map.getZoom()).toBe(3);
    expect(app.map.getCenter()).toEqual(ll(80, -16));
    expect(popup().querySelector('.popup-title').textContent).toBe('📌 X 80 · Y 70 · Z -16');
    expect(popup().querySelector('.popup-sub').textContent).toBe('≈ Nether : X 10, Z -2');
    expect(popup().querySelector('select')).toBeNull();
    expect(app.map._popup.options).toMatchObject({ minWidth: 230, offset: [0, -4] });
    const marker = layers(app, (l) => l instanceof L.CircleMarker);
    expect(marker).toHaveLength(1);
    expect(marker[0].options).toMatchObject({ radius: 7, color: '#fff', weight: 2, fillColor: '#000', fillOpacity: 0.4, interactive: false });
    vi.stubGlobal('prompt', vi.fn());
    button('Copier', popup()).click();
    expect(prompt).toHaveBeenCalledWith('Copier :', '80 70 -16');
    const b = button('Créer un lieu', popup());
    expect(b.className).toBe('primary');
    b.click();
    expect(popup()).toBeNull();
    expect(layers(app, (l) => l instanceof L.CircleMarker)).toHaveLength(0);
    const f = $('#poi-form').elements;
    expect([f.x.value, f.y.value, f.z.value]).toEqual(['80', '70', '-16']);
  });

  test('sans hauteur, zoom minimal 1, dans l’End', async () => {
    const app = await boot({ hash: '#end/0/0/-2' });
    go('3', '4');
    expect(app.map.getZoom()).toBe(1);
    expect(popup().querySelector('.popup-title').textContent).toBe('📌 X 3 · Z 4');
    expect(popup().querySelector('.popup-sub')).toBeNull();
    vi.stubGlobal('prompt', vi.fn());
    button('Copier', popup()).click();
    expect(prompt).toHaveBeenCalledWith('Copier :', '3 ~ 4');
    button('Créer un lieu', popup()).click();
    expect($('#poi-form').elements.y.value).toBe('64');
  });

  test('commencer un chemin, ajouter au tracé en cours', async () => {
    const app = await boot();
    go('3', '4');
    button('Commencer un chemin', popup()).click();
    expect(app.state.draw.points).toEqual([[3, 4]]);
    go('9', '4');
    expect(popup().querySelectorAll('.popup-actions')[0].textContent).toBe('➕ Ajouter au tracé en cours');
    button('Ajouter au tracé', popup()).click();
    expect(popup()).toBeNull();
    expect(app.state.draw.points).toEqual([[3, 4], [9, 4]]);
  });

  test('pendant l’édition : seulement la copie', async () => {
    const app = await withData({ paths: [PATH({ id: 'r' })] });
    pathLines(app)[0].fire('click', { latlng: ll(3, 4) });
    button('Éditer le tracé', popup()).click();
    go('1', '1');
    expect(popup().querySelectorAll('.popup-actions')).toHaveLength(1);
    expect(popup().querySelector('select')).toBeNull();
  });

  test('ajouter au bout d’un chemin', async () => {
    const app = await withData({ paths: [PATH({ id: 'r' }), PATH({ id: 's', name: 'Sentier' }), PATH({ id: 'n', dim: 'nether' })] });
    go('7', '8');
    const select = popup().querySelector('select');
    expect(select.className).toBe('append-path edit');
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([['', 'Ajouter au bout d’un chemin…'], ['r', 'Route'], ['s', 'Sentier']]);
    change(select, '');
    expect(popup()).not.toBeNull();
    change(select, 's');
    expect(popup()).toBeNull();
    expect(app.store.getPath('s').points).toEqual([[0, 0], [30, 40], [7, 8]]);
    expect(text('#toast')).toBe('Point ajouté à « Sentier ».');
  });
});

describe('recherche globale', () => {
  const search = () => $('#global-search');
  const results = () => $$('#search-results li');
  const type = (value) => input(search(), value);
  const data = () => withData({
    pois: [
      POI({ id: 'a', name: 'Village', x: 10, z: 20 }),
      POI({ id: 'n', name: 'Forteresse du village', dim: 'nether', x: 5, z: 6 }),
    ],
    paths: [PATH({ id: 'r', name: 'Route du village', dim: 'end', points: [[0, 0], [100, 0], [300, 0]] })],
  });

  test('propositions : lieux et chemins de toutes les dimensions', async () => {
    await data();
    type('vill');
    expect($('#search-results').hidden).toBe(false);
    expect(results().map((li) => li.querySelector('.item-name').textContent)).toEqual(['Village', 'Forteresse du village', 'Route du village']);
    expect(results().map((li) => li.querySelector('.item-sub').textContent)).toEqual([
      'Overworld · X 10 · Z 20',
      'Nether · X 5 · Z 6',
      'End · chemin de 300 blocs',
    ]);
    expect(results()[0].className).toBe('search-item active');
    expect(results()[0].getAttribute('aria-selected')).toBe('true');
    expect(results()[1].getAttribute('aria-selected')).toBe('false');
    expect(results()[0].getAttribute('role')).toBe('option');
    expect(results()[2].querySelector('.swatch-line').getAttribute('style')).toBe('background:#43a047');
  });

  test('coordonnées reconnues en premier', async () => {
    await withData({ pois: [POI({ id: 'a', name: '120 ans' })] });
    type('120 64 -40');
    expect(results().map((li) => li.querySelector('.item-name').textContent)).toEqual(['Aller à X 120 · Y 64 · Z -40']);
    type('120');
    expect(results().map((li) => li.querySelector('.item-name').textContent)).toEqual(['120 ans']);
    type('7 8');
    expect(results()[0].querySelector('.item-name').textContent).toBe('Aller à X 7 · Z 8');
    expect(results()[0].querySelector('.item-sub').textContent).toBe('Overworld');
    expect(results()[0].querySelector('.search-icon').textContent).toBe('📌');
  });

  test('flèches, Entrée : aller au résultat choisi, dans sa dimension', async () => {
    const app = await data();
    type('vill');
    key('ArrowDown', {}, search());
    expect(results()[1].className).toBe('search-item active');
    key('ArrowDown', {}, search());
    key('ArrowDown', {}, search());
    expect(results()[0].className).toBe('search-item active');
    expect(key('ArrowUp', {}, search()).defaultPrevented).toBe(true);
    expect(results()[2].className).toBe('search-item active');
    key('ArrowUp', {}, search());
    submit($('#search'));
    expect(app.state.dim).toBe('nether');
    expect(popup().querySelector('.popup-title').textContent).toBe('Forteresse du village');
    expect(search().value).toBe('');
    expect($('#search-results').hidden).toBe(true);
  });

  test('clic sur un chemin d’une autre dimension', async () => {
    const app = await data();
    type('route');
    const li = results()[0];
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    li.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    li.click();
    expect(app.state.dim).toBe('end');
    expect(popup().querySelector('.popup-title').textContent).toBe('Route du village');
  });

  test('aucun résultat, champ vidé, Échap, perte de focus', async () => {
    await data();
    type('zzz');
    expect(results().map((li) => [li.className, li.textContent])).toEqual([['empty', 'Aucun résultat.']]);
    // Entrée sans résultat : rien.
    submit($('#search'));
    expect(search().value).toBe('zzz');
    key('ArrowDown', {}, search());
    type('   ');
    expect($('#search-results').hidden).toBe(true);
    type('vill');
    key('a', {}, search());
    expect($('#search-results').hidden).toBe(false);
    key('Escape', {}, search());
    expect(search().value).toBe('');
    expect($('#search-results').hidden).toBe(true);
    type('vill');
    search().dispatchEvent(new Event('blur'));
    expect($('#search-results').hidden).toBe(true);
    // Retour dans le champ : les propositions reviennent.
    search().dispatchEvent(new Event('focus'));
    expect($('#search-results').hidden).toBe(false);
  });

  test('« / » place le curseur dans la recherche', async () => {
    await boot();
    expect(key('/').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search());
    // Dans un champ, « / » reste un caractère.
    expect(key('/', {}, search()).defaultPrevented).toBe(false);
  });
});

describe('annuler / rétablir', () => {
  const names = (app) => app.store.data.pois.map((p) => p.name);

  test('boutons : désactivés au départ, actifs après une modification', async () => {
    const app = await boot();
    expect($('#undo-btn').disabled).toBe(true);
    expect($('#redo-btn').disabled).toBe(true);
    expect($('#undo-btn').title).toBe('Annuler (Ctrl+Z)');
    expect($('#redo-btn').title).toBe('Rétablir (Ctrl+Y)');
    app.store.savePoi({ name: 'A' });
    expect($('#undo-btn').disabled).toBe(false);
    expect($('#redo-btn').disabled).toBe(true);
  });

  test('annuler une création, une suppression ; rétablir', async () => {
    const app = await withData({ pois: [POI({ id: 'a', name: 'A' })] });
    app.store.savePoi({ name: 'B' });
    app.store.deletePoi('a');
    expect(names(app)).toEqual(['B']);
    $('#undo-btn').click();
    expect(names(app)).toEqual(['A', 'B']);
    expect(text('#toast')).toBe('Modification annulée.');
    $('#undo-btn').click();
    expect(names(app)).toEqual(['A']);
    expect($('#undo-btn').disabled).toBe(true);
    expect($('#redo-btn').disabled).toBe(false);
    $('#redo-btn').click();
    expect(names(app)).toEqual(['A', 'B']);
    expect(text('#toast')).toBe('Modification rétablie.');
    // Les états restaurés sont enregistrés comme n'importe quelle modification.
    expect(JSON.parse(localStorage.getItem('minecarte:data')).pois.map((p) => p.name)).toEqual(['A', 'B']);
    $('#redo-btn').click();
    expect(names(app)).toEqual(['B']);
    expect($('#redo-btn').disabled).toBe(true);
    // Plus rien à rétablir : sans effet.
    $('#redo-btn').disabled = false;
    $('#redo-btn').click();
    expect(names(app)).toEqual(['B']);
  });

  test('« Tout effacer » peut être annulé', async () => {
    const app = await withData({ pois: [POI({ id: 'a', name: 'A' })] });
    vi.stubGlobal('confirm', () => true);
    $('#reset').click();
    expect(app.store.data.pois).toEqual([]);
    $('#undo-btn').click();
    expect(names(app)).toEqual(['A']);
  });

  test('raccourcis : Ctrl+Z, Ctrl+Y, Ctrl+Maj+Z, Cmd+Z', async () => {
    const app = await boot();
    app.store.savePoi({ name: 'A' });
    app.store.savePoi({ name: 'B' });
    expect(key('z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(names(app)).toEqual(['A']);
    key('z', { metaKey: true });
    expect(names(app)).toEqual([]);
    expect(key('y', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(names(app)).toEqual(['A']);
    expect(key('Z', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(names(app)).toEqual(['A', 'B']);
    // Autres touches avec Ctrl : ignorées.
    expect(key('s', { ctrlKey: true }).defaultPrevented).toBe(false);
    // Sans Ctrl : rien.
    key('z');
    expect(names(app)).toEqual(['A', 'B']);
    // En saisie : laissé au champ.
    key('z', { ctrlKey: true }, $('#poi-search'));
    expect(names(app)).toEqual(['A', 'B']);
  });

  test('pendant un tracé, Ctrl+Z retire un point ; les boutons annulent le mode', async () => {
    const app = await boot();
    app.store.savePoi({ name: 'A' });
    $('#new-path').click();
    app.map.fire('click', { latlng: ll(0, 0) });
    app.map.fire('click', { latlng: ll(5, 0) });
    key('z', { ctrlKey: true });
    expect(app.state.draw.points).toEqual([[0, 0]]);
    expect(names(app)).toEqual(['A']);
    $('#undo-btn').click();
    expect(app.state.mode).toBe(null);
    expect(names(app)).toEqual([]);
  });

  test('modification venue d’un autre appareil : historique vidé', async () => {
    const app = await boot();
    app.store.savePoi({ name: 'A' });
    app.store.replaceAll({ pois: [POI({ id: 'r', name: 'Distant' })] }, 'remote');
    expect($('#undo-btn').disabled).toBe(true);
    key('z', { ctrlKey: true });
    expect(names(app)).toEqual(['Distant']);
  });
});

describe('tout afficher', () => {
  const fitButton = () => $('.leaflet-control .fit-all');

  test('bouton sous le zoom', async () => {
    await boot();
    const b = fitButton();
    expect(b.title).toBe('Afficher tous les lieux et chemins');
    expect(b.getAttribute('aria-label')).toBe('Afficher tous les lieux et chemins');
    expect(b.getAttribute('role')).toBe('button');
    expect(b.textContent).toBe('⤢');
    expect(b.closest('.leaflet-top.leaflet-left')).not.toBeNull();
  });

  test('cadre les lieux et chemins de la dimension affichée', async () => {
    const app = await withData({
      pois: [POI({ id: 'a', x: 100, z: -50 }), POI({ id: 'n', dim: 'nether', x: 9999, z: 9999 })],
      paths: [PATH({ id: 'r', points: [[-200, 0], [0, 300]] })],
    });
    const fit = vi.spyOn(app.map, 'fitBounds');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    fitButton().dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(fit.mock.calls[0][0]).toEqual(L.latLngBounds(ll(-200, -50), ll(100, 300)).pad(0.1));
    expect(fit.mock.calls[0][1]).toMatchObject({ maxZoom: 2, animate: false });
  });

  test('dimension vide : message, carte inchangée', async () => {
    const app = await withData({ pois: [POI({ id: 'n', dim: 'nether' })] });
    const fit = vi.spyOn(app.map, 'fitBounds');
    fitButton().click();
    expect(fit).not.toHaveBeenCalled();
    expect(text('#toast')).toBe('Aucun lieu ni chemin dans cette dimension.');
  });

  test('pendant un tracé, le clic n’ajoute pas de point', async () => {
    const app = await withData({ pois: [POI({ id: 'a' })] });
    $('#new-path').click();
    fitButton().click();
    expect(app.state.draw.points).toEqual([]);
  });
});

describe('panneau latéral', () => {
  test('masquer / afficher, onglets', async () => {
    const app = await boot();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const inv = vi.spyOn(app.map, 'invalidateSize');
    $('#toggle-sidebar').click();
    expect(document.body.classList.contains('sidebar-hidden')).toBe(true);
    vi.advanceTimersByTime(220);
    expect(inv).toHaveBeenCalledTimes(1);
    $('#toggle-sidebar').click();
    expect(document.body.classList.contains('sidebar-hidden')).toBe(false);
    const tabs = $$('.tab');
    tabs[1].click();
    expect(tabs.map((t) => t.classList.contains('active'))).toEqual(tabs.map((t, i) => i === 1));
    const active = $$('.panel').filter((p) => p.classList.contains('active'));
    expect(active.map((p) => p.dataset.panel)).toEqual([tabs[1].dataset.tab]);
  });
});

describe('écrans tactiles', () => {
  const pointer = (app, type) => app.map.getContainer().dispatchEvent(
    Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: type }));

  test('au doigt, les coordonnées suivent le centre ; à la souris, le curseur', async () => {
    const app = await boot();
    app.map.fire('mousemove', { latlng: ll(7, 8) });
    app.map.setView(ll(40, -24), 0, { animate: false });
    expect(text('#coords')).toContain('X 7  Z 8');
    pointer(app, 'touch');
    expect(document.body.classList.contains('touch')).toBe(true);
    app.map.setView(ll(40, -24), 1, { animate: false });
    expect(text('#coords')).toContain('X 40  Z -24');
    pointer(app, 'mouse');
    expect(document.body.classList.contains('touch')).toBe(false);
    app.map.fire('mousemove', { latlng: ll(7, 8) });
    app.map.setView(ll(90, 10), 1, { animate: false });
    expect(text('#coords')).toContain('X 7  Z 8');
  });

  test('toucher la carte ferme le panneau sur petit écran seulement', async () => {
    let app = await boot({ width: 500 });
    document.body.classList.remove('sidebar-hidden');
    app.map.fire('click', { latlng: ll(0, 0) });
    expect(document.body.classList.contains('sidebar-hidden')).toBe(true);
    teardown();
    app = await boot();
    app.map.fire('click', { latlng: ll(0, 0) });
    expect(document.body.classList.contains('sidebar-hidden')).toBe(false);
  });
});

const setFiles = (el, files) => {
  Object.defineProperty(el, 'files', { configurable: true, value: files });
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('export, import, effacement', () => {
  test('export JSON', async () => {
    const app = await withData({ pois: [POI({ id: 'a' })] });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicked.push([this.href, this.download, this.isConnected]); });
    $('#export').click();
    const [url, blob] = app.urls.created.at(-1);
    expect(clicked).toEqual([[url, 'minecarte.json', true]]);
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toEqual(JSON.parse(app.store.exportJson()));
    expect(document.querySelector(`a[href="${url}"]`)).toBeNull();
    vi.advanceTimersByTime(999);
    expect(app.urls.revoked).not.toContain(url);
    vi.advanceTimersByTime(1);
    expect(app.urls.revoked).toContain(url);
  });

  test('import : fichier valide, refusé, invalide, absent', async () => {
    const app = await withData({ pois: [POI({ id: 'a' })] });
    const clicked = vi.spyOn($('#import-file'), 'click').mockImplementation(() => {});
    $('#import').click();
    expect(clicked).toHaveBeenCalled();
    const file = (content) => ({ text: async () => content });
    vi.stubGlobal('confirm', vi.fn(() => false));
    vi.stubGlobal('alert', vi.fn());
    setFiles($('#import-file'), [file(JSON.stringify(DATA({ pois: [POI({ id: 'x' }), POI({ id: 'y' })], paths: [PATH({})] })))]);
    await flush();
    expect(confirm).toHaveBeenCalledWith('Remplacer toutes les données actuelles par celles du fichier ?');
    expect(app.store.data.pois.map((p) => p.id)).toEqual(['a']);
    confirm.mockReturnValue(true);
    $('#new-path').click();
    setFiles($('#import-file'), [file(JSON.stringify(DATA({ pois: [POI({ id: 'x' }), POI({ id: 'y' })], paths: [PATH({})] })))]);
    await flush();
    expect(app.state.mode).toBe(null);
    expect(app.store.data.pois.map((p) => p.id)).toEqual(['x', 'y']);
    expect(text('#toast')).toBe('2 lieu(x) et 1 chemin(s) importés.');
    expect($('#import-file').value).toBe('');
    setFiles($('#import-file'), [file('{oups')]);
    await flush();
    expect(alert.mock.calls[0][0]).toMatch(/^Fichier invalide : /);
    setFiles($('#import-file'), []);
    await flush();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  test('tout effacer : graine gardée, avertissement cloud', async () => {
    const app = await withData({ seed: 'graine', pois: [POI({ id: 'a' })] });
    vi.stubGlobal('confirm', vi.fn(() => false));
    $('#reset').click();
    expect(confirm).toHaveBeenCalledWith('Effacer tous les lieux et chemins ? Ils restent récupérables avec Annuler ou l\'historique local.');
    expect(app.store.data.pois).toHaveLength(1);
    confirm.mockReturnValue(true);
    $('#new-path').click();
    $('#reset').click();
    expect(app.state.mode).toBe(null);
    expect(app.store.data).toEqual({ version: 1, seed: 'graine', pois: [], paths: [] });
    app.cloud.state = { code: 'ABCDEFGH', version: 0, base: null };
    $('#reset').click();
    expect(confirm.mock.calls.at(-1)[0]).toContain(' Les données seront aussi effacées du cloud et des appareils reliés.');
  });
});

describe('historique local', () => {
  const T = new Date(2026, 8, 29, 20, 15).getTime();
  const MIN = 60 * 1000;
  const entries = () => $$('#backup-list .item').map((li) => [li.querySelector('.item-name').textContent, li.querySelector('.item-sub').textContent]);
  const clock = (t) => vi.useFakeTimers({ toFake: ['Date'], now: t });

  test('copie à l’ouverture ; liste vide sans données', async () => {
    clock(T);
    await boot();
    expect(text('#backup-list')).toBe('Aucune copie pour l\'instant.');
    teardown();
    await withData({ pois: [POI({ id: 'a' })] });
    expect(entries()).toEqual([['29/09/2026 20:15', '1 lieu · 0 chemin']]);
    expect(JSON.parse(localStorage.getItem('minecarte:backups'))[0].data.pois.map((p) => p.id)).toEqual(['a']);
  });

  test('une copie au plus toutes les 10 minutes', async () => {
    clock(T);
    const app = await withData({ pois: [POI({ id: 'a' })] });
    app.store.savePoi(POI({ id: 'b' }));
    vi.setSystemTime(T + 10 * MIN - 1);
    app.store.savePoi(POI({ id: 'c' }));
    expect(entries()).toEqual([['29/09/2026 20:15', '1 lieu · 0 chemin']]);
    vi.setSystemTime(T + 10 * MIN);
    app.store.savePoi(POI({ id: 'd' }));
    expect(entries()).toEqual([['29/09/2026 20:25', '4 lieux · 0 chemin'], ['29/09/2026 20:15', '1 lieu · 0 chemin']]);
  });

  test('restaurer : confirmation, état actuel copié, annulable', async () => {
    clock(T);
    const old = { time: T - 60 * MIN, data: DATA({ pois: [POI({ id: 'old', name: 'Ancien' })], paths: [PATH({ id: 'r' })] }) };
    const app = await withData({ pois: [POI({ id: 'a' })] }, { storage: { 'minecarte:backups': [old] } });
    expect(entries()).toEqual([['29/09/2026 20:15', '1 lieu · 0 chemin'], ['29/09/2026 19:15', '1 lieu · 1 chemin']]);
    app.store.savePoi(POI({ id: 'b' }));
    vi.stubGlobal('confirm', vi.fn(() => false));
    button('Restaurer', $$('#backup-list .item')[1]).click();
    expect(confirm).toHaveBeenCalledWith('Revenir à l\'état du 29/09/2026 19:15 ? L\'état actuel est d\'abord copié dans l\'historique.');
    expect(app.store.data.pois).toHaveLength(2);
    confirm.mockReturnValue(true);
    $('#new-path').click();
    button('Restaurer', $$('#backup-list .item')[1]).click();
    expect(app.state.mode).toBe(null);
    expect(app.store.data.pois.map((p) => p.id)).toEqual(['old']);
    expect(app.store.data.paths.map((p) => p.id)).toEqual(['r']);
    expect(text('#toast')).toBe('État du 29/09/2026 19:15 restauré.');
    expect(entries().map((e) => e[1])).toEqual(['2 lieux · 0 chemin', '1 lieu · 0 chemin', '1 lieu · 1 chemin']);
    $('#undo-btn').click();
    expect(app.store.data.pois).toHaveLength(2);
  });

  test('import et effacement copient d’abord l’état actuel', async () => {
    clock(T);
    const app = await withData({ pois: [POI({ id: 'a' })] });
    app.store.savePoi(POI({ id: 'b' }));
    vi.stubGlobal('confirm', vi.fn(() => true));
    setFiles($('#import-file'), [{ text: async () => JSON.stringify(DATA({ pois: [POI({ id: 'x' })], paths: [PATH({})] })) }]);
    await flush();
    expect(entries().map((e) => e[1])).toEqual(['2 lieux · 0 chemin', '1 lieu · 0 chemin']);
    $('#reset').click();
    expect(app.store.data.pois).toEqual([]);
    expect(entries().map((e) => e[1])).toEqual(['1 lieu · 1 chemin', '2 lieux · 0 chemin', '1 lieu · 0 chemin']);
  });
});

describe('anciens fonds importés (fonctionnalité retirée)', () => {
  test('images supprimées du navigateur au démarrage', async () => {
    const idb = new IDBFactory();
    await new Promise((resolve) => {
      const req = idb.open('minecarte', 2);
      req.onupgradeneeded = () => req.result.createObjectStore('blobs', { keyPath: 'hash' });
      req.onsuccess = () => { req.result.close(); resolve(); };
    });
    expect((await idb.databases()).map((d) => d.name)).toEqual(['minecarte']);
    await boot({ idb });
    await until(async () => (await idb.databases()).length === 0);
  });

  test('sans IndexedDB : démarrage normal', async () => {
    const app = await boot({ before: () => vi.stubGlobal('indexedDB', undefined) });
    expect(app.state.dim).toBe('overworld');
  });

  test('fonds ignorés dans les données locales', async () => {
    const app = await withData({ backgrounds: [{ id: 'g', hash: 'a'.repeat(64) }] });
    expect(app.store.data).not.toHaveProperty('backgrounds');
  });
});

describe('synchronisation cloud', () => {
  const URL_ = 'https://sync.test';
  const start = async (extra = {}) => {
    const server = createServer();
    const app = await boot({ syncUrl: URL_, fetch: server.fetch, ...extra });
    return { app, server };
  };

  test('section visible, création d’un code', async () => {
    const { app } = await start();
    expect($('#sync-section').hidden).toBe(false);
    expect($('#sync-off').hidden).toBe(false);
    expect($('#sync-on').hidden).toBe(true);
    expect($('#sync-badge').hidden).toBe(true);
    expect(text('#sync-status')).toBe('');
    expect($('#sync-status').dataset.kind).toBe('off');
    $('#sync-create').click();
    await until(() => app.cloud.status.kind === 'idle');
    const code = CloudSync.formatCode(app.cloud.code);
    expect(text('#toast')).toBe(`Code créé : ${code}`);
    expect($('#sync-on').hidden).toBe(false);
    expect($('#sync-off').hidden).toBe(true);
    expect(text('#sync-code')).toBe(code);
    expect(text('#sync-status')).toMatch(/^✓ Synchronisé à \d\d:\d\d\.$/);
    expect($('#sync-badge').hidden).toBe(false);
    expect($('#sync-badge').dataset.kind).toBe('idle');
    expect($('#sync-badge').title).toBe(`Synchronisation cloud (${code}) : ${text('#sync-status')}`);
  });

  test('libellés des états', async () => {
    const { app } = await start();
    const show = (status) => { app.cloud.onStatus(status); return text('#sync-status'); };
    expect(show({ kind: 'idle', at: null })).toBe('✓ Synchronisé.');
    expect(show({ kind: 'pending', at: null })).toBe('Modifications en attente d’envoi…');
    expect(show({ kind: 'syncing', at: null })).toBe('Synchronisation…');
    expect(show({ kind: 'error', message: 'Oups', at: null })).toBe('⚠ Oups');
    expect($('#sync-status').dataset.kind).toBe('error');
  });

  test('création impossible', async () => {
    await start({ fetch: async () => new Response('', { status: 500 }) });
    $('#sync-create').click();
    await until(() => text('#toast') === 'Impossible de créer un code (connexion ?).');
  });

  test('rejoindre un code : valide, invalide, erreur sans message', async () => {
    const { app, server } = await start();
    const res = await server.fetch(`${URL_}/api/sync`, { method: 'POST' });
    const { code } = await res.json();
    const form = $('#sync-join');
    form.elements.code.value = 'nope';
    submit(form);
    await until(() => text('#toast') === 'Code invalide : 8 caractères attendus.');
    expect(form.elements.code.value).toBe('nope');
    form.elements.code.value = code.toLowerCase();
    submit(form);
    await until(() => text('#toast') === `Appareil relié au code ${CloudSync.formatCode(code)}.`);
    expect(form.elements.code.value).toBe('');
    expect(app.cloud.code).toBe(code);
    vi.spyOn(app.cloud, 'join').mockRejectedValue({});
    submit(form);
    await until(() => text('#toast') === 'Impossible de rejoindre ce code.');
  });

  test('copier, synchroniser, se déconnecter, badge', async () => {
    const { app } = await start();
    $('#sync-create').click();
    await until(() => app.cloud.status.kind === 'idle');
    vi.stubGlobal('prompt', vi.fn());
    $('#sync-copy').click();
    expect(prompt).toHaveBeenCalledWith('Copier :', CloudSync.formatCode(app.cloud.code));
    const pull = vi.spyOn(app.cloud, 'pull');
    $('#sync-now').click();
    expect(pull).toHaveBeenCalled();
    document.body.classList.add('sidebar-hidden');
    const scroll = vi.spyOn($('#sync-section'), 'scrollIntoView');
    $('#sync-badge').click();
    expect(document.body.classList.contains('sidebar-hidden')).toBe(false);
    expect($('.tab[data-tab="settings"]').classList.contains('active')).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    vi.stubGlobal('confirm', vi.fn(() => false));
    $('#sync-leave').click();
    expect(confirm).toHaveBeenCalledWith('Déconnecter cet appareil du code ? Les données restent sur cet appareil et dans le cloud.');
    expect(app.cloud.code).toBeTruthy();
    confirm.mockReturnValue(true);
    $('#sync-leave').click();
    expect(app.cloud.code).toBe(null);
    expect($('#sync-off').hidden).toBe(false);
    expect($('#sync-badge').hidden).toBe(true);
  });

  test('lien de lecture seule : créer, copier, révoquer, masqué à la déconnexion', async () => {
    const { app, server } = await start();
    $('#sync-create').click();
    await until(() => app.cloud.status.kind === 'idle');
    expect($('#share-on').hidden).toBe(true);
    $('#share-create').click();
    await until(() => !$('#share-on').hidden);
    const view = server.env.SYNC_KV.map.get(`share:${app.cloud.code}`);
    expect($('#share-url').value).toBe(`${location.origin}/?vue=${view}`);
    vi.stubGlobal('prompt', vi.fn());
    $('#share-copy').click();
    expect(prompt).toHaveBeenCalledWith('Copier :', `${location.origin}/?vue=${view}`);
    vi.stubGlobal('confirm', vi.fn(() => false));
    $('#share-revoke').click();
    expect(confirm).toHaveBeenCalledWith('Révoquer le lien en lecture seule ? Il ne fonctionnera plus pour personne.');
    expect($('#share-on').hidden).toBe(false);
    confirm.mockReturnValue(true);
    $('#share-revoke').click();
    await until(() => $('#share-on').hidden);
    expect(text('#toast')).toBe('Lien révoqué.');
    expect($('#share-url').value).toBe('');
    expect(server.env.SYNC_KV.map.has(`view:${view}`)).toBe(false);

    $('#share-create').click();
    await until(() => !$('#share-on').hidden);
    $('#sync-leave').click();
    expect($('#share-on').hidden).toBe(true);
  });

  test('lien de lecture seule : erreurs affichées', async () => {
    const { app } = await start();
    vi.spyOn(app.cloud, 'share').mockRejectedValue(new Error('Pas de lien'));
    vi.spyOn(app.cloud, 'unshare').mockRejectedValue(new Error('Pas de révocation'));
    $('#share-create').click();
    await until(() => text('#toast') === 'Pas de lien');
    vi.stubGlobal('confirm', vi.fn(() => true));
    $('#share-revoke').click();
    await until(() => text('#toast') === 'Pas de révocation');
  });
});

describe('carte partagée en lecture seule (?vue=…)', () => {
  const URL_ = 'https://sync.test';

  async function shared() {
    const server = createServer();
    const { code } = await (await server.fetch(`${URL_}/api/sync`, { method: 'POST' })).json();
    await server.fetch(`${URL_}/api/sync/${code}`, { method: 'PUT', body: JSON.stringify({ baseVersion: 0, data: DATA({ pois: [POI({ id: 's', name: 'Partagé' })] }) }) });
    const { view } = await (await server.fetch(`${URL_}/api/sync/${code}/share`, { method: 'POST' })).json();
    return { server, view };
  }

  test('données du lien affichées, rien n’est écrit dans le navigateur', async () => {
    const { server, view } = await shared();
    const own = DATA({ pois: [POI({ id: 'mine', name: 'À moi' })] });
    const app = await boot({ syncUrl: URL_, fetch: server.fetch, search: `?vue=${view}`, storage: { 'minecarte:data': own } });
    await until(() => app.store.data.pois.length === 1);
    expect(app.store.data.pois.map((p) => p.name)).toEqual(['Partagé']);
    expect([...$$('#poi-list .item-name')].map((el) => el.textContent)).toEqual(['Partagé']);
    expect(document.body.classList.contains('readonly')).toBe(true);
    expect($('#readonly').hidden).toBe(false);
    expect($('#readonly').classList.contains('error')).toBe(false);
    expect(text('#readonly-text')).toBe('👁 Lecture seule');
    expect($('#readonly-exit').getAttribute('href')).toBe('/');
    expect($('#sync-section').hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem('minecarte:data'))).toEqual(own);
    expect(localStorage.getItem('minecarte:backups')).toBeNull();
    expect(server.requests.at(-1)).toMatchObject({ method: 'GET', url: `${URL_}/api/view/${view}` });
  });

  test('lien révoqué ou inconnu : message d’erreur', async () => {
    const { server } = await shared();
    await boot({ syncUrl: URL_, fetch: server.fetch, search: '?vue=AAAAAAAA' });
    await until(() => $('#readonly').classList.contains('error'));
    expect(text('#readonly-text')).toBe('⚠ Lien inconnu ou révoqué.');
  });

  test('sans paramètre : carte normale, pas de mode lecture', async () => {
    await boot();
    expect(document.body.classList.contains('readonly')).toBe(false);
    expect($('#readonly').hidden).toBe(true);
  });
});
