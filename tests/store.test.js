import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

let Store;
beforeAll(async () => {
  await import('../js/store.js');
  Store = window.Store;
});

const KEY = 'minecarte:data';
const HASH = 'a'.repeat(64);
let warn;

beforeEach(() => {
  localStorage.clear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const load = (raw) => {
  localStorage.setItem(KEY, JSON.stringify(raw));
  return new Store().data;
};

test('DIMENSIONS exposé', () => {
  expect(window.DIMENSIONS).toEqual(['overworld', 'nether', 'end']);
});

describe('chargement', () => {
  test('rien de sauvegardé : données vides', () => {
    expect(new Store().data).toEqual({ version: 1, seed: 'minecarte', pois: [], paths: [], backgrounds: [] });
    expect(warn).not.toHaveBeenCalled();
  });

  test('JSON illisible : données vides et avertissement', () => {
    localStorage.setItem(KEY, '{pas du json');
    expect(new Store().data.pois).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Impossible de lire les données sauvegardées', expect.any(SyntaxError));
  });

  test('valeur non objet : données vides', () => {
    expect(load(42)).toEqual({ version: 1, seed: 'minecarte', pois: [], paths: [], backgrounds: [] });
    expect(load(null).paths).toEqual([]);
    expect(load('texte').pois).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('graine conservée en texte', () => {
    expect(load({ seed: 123 }).seed).toBe('123');
    expect(load({ seed: null }).seed).toBe('minecarte');
    expect(load({ seed: 0 }).seed).toBe('0');
  });
});

describe('nettoyage des POI', () => {
  test('valeurs par défaut et conversions', () => {
    const [p] = load({ pois: [{ id: 'a' }] }).pois;
    expect(p).toEqual({ id: 'a', name: 'POI', color: '#e53935', dim: 'overworld', x: 0, y: 64, z: 0, icon: '', links: [] });
  });

  test('champs valides conservés, nombres arrondis, couleur en minuscules', () => {
    const [p] = load({ pois: [{ id: 'a', name: 'Base', color: '#ABCDEF', dim: 'nether', x: '12.6', y: -3.4, z: 7, icon: 'minecraft:diamond_sword' }] }).pois;
    expect(p).toEqual({ id: 'a', name: 'Base', color: '#abcdef', dim: 'nether', x: 13, y: -3, z: 7, icon: 'minecraft:diamond_sword', links: [] });
  });

  test('valeurs invalides remplacées', () => {
    const [p] = load({ pois: [{ id: 'a', name: '', color: 'red', dim: 'mars', x: 'abc', y: 'Infinity', z: null, icon: 'Minecraft:X' }] }).pois;
    expect(p).toMatchObject({ name: 'POI', color: '#e53935', dim: 'overworld', x: 0, y: 64, z: 0, icon: '' });
    expect(load({ pois: [{ id: 'a', color: '#abcdefff', icon: 'minecraft:ab cd' }] }).pois[0]).toMatchObject({ color: '#e53935', icon: '' });
    expect(load({ pois: [{ id: 'a', color: 'x#abcdef', icon: 'xminecraft:ab' }] }).pois[0]).toMatchObject({ color: '#e53935', icon: '' });
    expect(load({ pois: [{ id: 'a', icon: 42 }] }).pois[0].icon).toBe('');
    // Un objet qui se convertit en identifiant valide n'est pas une chaîne.
    const store = new Store();
    const poi = store.savePoi({ icon: { toString: () => 'minecraft:bed' } });
    expect(poi.icon).toBe('');
    expect(load({ pois: [{ id: 'a', dim: 'end' }] }).pois[0].dim).toBe('end');
  });

  test('nom limité à 100 caractères', () => {
    expect(load({ pois: [{ id: 'a', name: 'x'.repeat(150) }] }).pois[0].name).toHaveLength(100);
    expect(load({ pois: [{ id: 'a', name: 123 }] }).pois[0].name).toBe('123');
  });

  test('entrées non objet ignorées, liste absente acceptée', () => {
    expect(load({ pois: [null, 3, 'x', { id: 'ok' }] }).pois.map((p) => p.id)).toEqual(['ok']);
    expect(load({ pois: 'nope' }).pois).toEqual([]);
  });

  test('identifiants manquants ou en double : nouvel identifiant', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    const ids = load({ pois: [{ id: 'a' }, { id: 'a' }, { id: '' }, { id: 7 }, {}] }).pois.map((p) => p.id);
    const generated = (1700000000000).toString(36) + (0.123456789).toString(36).slice(2, 8);
    expect(generated).toBe('loyw3v284fzzzx');
    expect(ids).toEqual(['a', generated, generated, generated, generated]);
  });

  test('liens : dédoublonnés, symétriques, sans auto-lien ni POI inconnu', () => {
    const pois = load({
      pois: [
        { id: 'a', links: ['b', 'b', 'a', 'zzz', 5] },
        { id: 'b' },
        { id: 'c', links: ['a'] },
        { id: 'd', links: 'x' },
      ],
    }).pois;
    const links = Object.fromEntries(pois.map((p) => [p.id, p.links]));
    expect(links).toEqual({ a: ['b', 'c'], b: ['a'], c: ['a'], d: [] });
  });
});

describe('nettoyage des chemins', () => {
  test('valeurs par défaut', () => {
    const [p] = load({ paths: [{ id: 'r', points: [[0, 0], [1, 2]] }, { id: 5, points: [[0, 0], [1, 1]] }] }).paths;
    expect(load({ paths: [{ id: 5, points: [[0, 0], [1, 1]] }] }).paths[0].id).toMatch(/^[0-9a-z]{9,}$/);
    expect(p).toEqual({ id: 'r', name: 'Chemin', color: '#ffeb3b', dim: 'overworld', weight: 4, points: [[0, 0], [1, 2]] });
  });

  test('champs conservés et points nettoyés', () => {
    const [p] = load({ paths: [{ id: 'r', name: 'Route', color: '#00FF00', dim: 'end', weight: 9, points: [[1.6, '2'], [3], 'x', [4, 5, 6], ['a', null]] }] }).paths;
    expect(p).toEqual({ id: 'r', name: 'Route', color: '#00ff00', dim: 'end', weight: 9, points: [[2, 2], [4, 5], [0, 0]] });
  });

  test('épaisseur entre 1 et 16, 4 par défaut', () => {
    const w = (weight) => load({ paths: [{ id: 'r', weight, points: [[0, 0], [1, 1]] }] }).paths[0].weight;
    expect(w(0)).toBe(1);
    expect(w(1)).toBe(1);
    expect(w(16)).toBe(16);
    expect(w(17)).toBe(16);
    expect(w('x')).toBe(4);
    expect(w(7.4)).toBe(7);
  });

  test('chemins invalides ignorés', () => {
    const paths = load({
      paths: [null, { id: 'a' }, { id: 'b', points: 'x' }, { id: 'c', points: [[0, 0]] }, { id: 'd', points: [[0, 0], [1]] }, { points: [[0, 0], [1, 1]] }, { id: '', name: 'x'.repeat(120), points: [[0, 0], [1, 1]] }],
    }).paths;
    expect(paths).toHaveLength(2);
    expect(paths[0].id).toMatch(/^[0-9a-z]{9,}$/);
    expect(paths[1].id).not.toBe('');
    expect(paths[1].name).toHaveLength(100);
    expect(load({ paths: {} }).paths).toEqual([]);
  });
});

describe('nettoyage des fonds', () => {
  const bg = (extra) => load({ backgrounds: [{ id: 'f', hash: HASH, ...extra }] }).backgrounds[0];

  test('valeurs par défaut', () => {
    expect(bg({})).toEqual({
      id: 'f', name: 'Fond', dim: 'overworld', x: 0, z: 0, scale: 1, opacity: 1,
      width: 1, height: 1, visible: true, hash: HASH, type: 'image/png',
    });
  });

  test('champs valides conservés', () => {
    expect(bg({ name: 'Spawn', dim: 'nether', x: -512.4, z: 30, scale: '0.25', opacity: 0.5, width: 1024, height: 512, visible: false, type: 'image/webp' }))
      .toEqual({ id: 'f', name: 'Spawn', dim: 'nether', x: -512, z: 30, scale: 0.25, opacity: 0.5, width: 1024, height: 512, visible: false, hash: HASH, type: 'image/webp' });
    expect(bg({ type: 'image/jpeg', scale: 8 })).toMatchObject({ type: 'image/jpeg', scale: 8 });
  });

  test('échelle, opacité, taille et type bornés', () => {
    expect(bg({ scale: 3 }).scale).toBe(1);
    expect(bg({ opacity: 0.05 }).opacity).toBe(0.1);
    expect(bg({ opacity: 2 }).opacity).toBe(1);
    expect(bg({ opacity: 0 }).opacity).toBe(1);
    expect(bg({ opacity: 'x' }).opacity).toBe(1);
    expect(bg({ width: 0, height: -3 })).toMatchObject({ width: 1, height: 1 });
    expect(bg({ width: 'x' }).width).toBe(1);
    expect(bg({ type: 'image/gif' }).type).toBe('image/png');
    expect(bg({ type: '' }).type).toBe('image/png');
    expect(bg({ type: 'image/png' }).type).toBe('image/png');
    expect(bg({ visible: 0 }).visible).toBe(true);
    expect(bg({ name: 'x'.repeat(101) }).name).toHaveLength(100);
  });

  test('fonds invalides ignorés (empreinte SHA-256 obligatoire)', () => {
    const list = load({ backgrounds: [null, { hash: 'abc' }, { hash: HASH.toUpperCase() }, { hash: `x${HASH}` }, { hash: `${HASH}0` }, { hash: HASH }] }).backgrounds;
    expect(list).toHaveLength(1);
    expect(list[0].id).not.toBe('');
    expect(load({ backgrounds: 'x' }).backgrounds).toEqual([]);
    expect(load({ backgrounds: [{ id: 3, hash: HASH }] }).backgrounds[0].id).not.toBe(3);
    expect(load({ backgrounds: [{ id: '', hash: HASH }] }).backgrounds[0].id).not.toBe('');
  });
});

describe('Store', () => {
  let store;
  let calls;
  beforeEach(() => {
    store = new Store();
    calls = [];
    store.onChange((data, source) => calls.push([data, source]));
  });

  test('sauvegarde et notifie avec la source', () => {
    store.replaceAll({ pois: [{ id: 'a' }] }, 'remote');
    expect(JSON.parse(localStorage.getItem(KEY)).pois[0].id).toBe('a');
    expect(calls).toEqual([[store.data, 'remote']]);
    store.deletePoi('a');
    expect(calls[1]).toEqual([store.data, undefined]);
  });

  test('stockage indisponible : avertissement, les écouteurs sont quand même notifiés', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('plein'); });
    store.replaceAll({});
    expect(warn).toHaveBeenCalledWith('Impossible de sauvegarder les données', expect.any(Error));
    expect(calls).toHaveLength(1);
  });

  test('lecture indisponible : données vides', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('refusé'); });
    expect(new Store().data.pois).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Impossible de lire les données sauvegardées', expect.any(Error));
  });

  test('POI : création, nettoyage des champs, liens symétriques', () => {
    const a = store.savePoi({ name: '  Base  ', color: '#FFFFFF', dim: 'nether', x: '1.4', y: 'x', z: -2.6, icon: 'minecraft:bed' });
    expect(a).toEqual({ id: a.id, name: 'Base', color: '#ffffff', dim: 'nether', x: 1, y: 64, z: -3, icon: 'minecraft:bed', links: [] });
    expect(a.id).toMatch(/^[0-9a-z]{9,}$/);
    expect(store.getPoi(a.id)).toBe(a);
    const b = store.savePoi({ name: '   ', links: [a.id, 'inconnu'] });
    expect(b.name).toBe('POI');
    expect(b).toMatchObject({ color: '#e53935', dim: 'overworld', x: 0, y: 64, z: 0, icon: '' });
    expect(b.links).toEqual([a.id]);
    expect(a.links).toEqual([b.id]);
    expect(store.savePoi({}).name).toBe('POI');
    expect(store.savePoi({ name: 0 }).name).toBe('0');
    expect(store.savePoi({ name: 'X', links: 'pas un tableau' }).links).toEqual([]);
    expect(store.savePoi({ name: 'y'.repeat(120) }).name).toHaveLength(100);
    expect(calls).toHaveLength(6);
  });

  test('POI : modification des liens (ajout, retrait, pas d’auto-lien)', () => {
    const a = store.savePoi({ name: 'A' });
    const b = store.savePoi({ name: 'B' });
    const c = store.savePoi({ name: 'C', links: [a.id] });
    store.savePoi({ id: a.id, name: 'A2', links: [b.id, a.id] });
    expect(store.getPoi(a.id).name).toBe('A2');
    expect(store.getPoi(a.id).links).toEqual([b.id]);
    expect(b.links).toEqual([a.id]);
    expect(c.links).toEqual([]);
    // Retirer un lien ne touche pas aux autres liens du POI d'en face.
    const d = store.savePoi({ name: 'D', links: [b.id] });
    store.savePoi({ id: a.id, name: 'A2', links: [] });
    expect(store.getPoi(b.id).links).toEqual([d.id]);
    store.savePoi({ id: a.id, name: 'A2', links: [b.id] });
    // Un lien déjà présent n'est pas dupliqué.
    store.savePoi({ id: b.id, name: 'B', links: [a.id] });
    expect(store.getPoi(a.id).links).toEqual([b.id]);
    expect(store.data.pois).toHaveLength(4);
  });

  test('POI : suppression et nettoyage des liens', () => {
    const a = store.savePoi({ name: 'A' });
    const b = store.savePoi({ name: 'B', links: [a.id] });
    const c = store.savePoi({ name: 'C', links: [a.id, b.id] });
    store.deletePoi(a.id);
    expect(store.getPoi(a.id)).toBeUndefined();
    expect(store.getPoi(b.id).links).toEqual([c.id]);
    expect(store.getPoi(c.id).links).toEqual([b.id]);
  });

  test('chemins : création, modification, suppression', () => {
    const p = store.savePath({ name: ' Route ', color: '#123ABC', dim: 'end', weight: 30, points: [[1.2, 2.8], ['3', 'x']] });
    expect(p).toEqual({ id: p.id, name: 'Route', color: '#123abc', dim: 'end', weight: 16, points: [[1, 3], [3, 0]] });
    expect(store.getPath(p.id)).toBe(p);
    store.savePath({ id: p.id, name: '', color: 'bad' });
    expect(store.getPath(p.id)).toEqual({ id: p.id, name: 'Chemin', color: '#ffeb3b', dim: 'overworld', weight: 4, points: [[1, 3], [3, 0]] });
    expect(store.savePath({ name: 'z'.repeat(120), points: [[0, 0], [1, 1]] }).name).toHaveLength(100);
    expect(store.savePath({}).points).toBeUndefined();
    expect(store.savePath({}).name).toBe('Chemin');
    expect(store.savePath({ name: 0 }).name).toBe('0');
    store.deletePath(p.id);
    expect(store.getPath(p.id)).toBeUndefined();
    expect(store.data.paths).toHaveLength(4);
  });

  test('fonds : ajout nettoyé, remplacement par identifiant, refus sans empreinte, suppression', () => {
    const f = store.saveBackground({ id: 'f', hash: HASH, name: 'Spawn', opacity: 0.01 });
    expect(f).toMatchObject({ id: 'f', name: 'Spawn', opacity: 0.1 });
    expect(store.getBackground('f')).toEqual(f);
    store.saveBackground({ id: 'g', hash: HASH });
    store.saveBackground({ id: 'f', hash: HASH, name: 'Renommé' });
    expect(store.data.backgrounds.map((b) => [b.id, b.name])).toEqual([['g', 'Fond'], ['f', 'Renommé']]);
    const before = calls.length;
    expect(store.saveBackground({ id: 'h', hash: 'nope' })).toBeNull();
    expect(calls).toHaveLength(before);
    store.deleteBackground('f');
    expect(store.data.backgrounds.map((b) => b.id)).toEqual(['g']);
  });

  test('chaque modification est sauvegardée et notifiée', () => {
    const saved = () => JSON.parse(localStorage.getItem(KEY));
    const p = store.savePath({ name: 'R', points: [[0, 0], [1, 1]] });
    expect(calls).toHaveLength(1);
    expect(saved().paths.map((x) => x.name)).toEqual(['R']);
    store.deletePath(p.id);
    expect(calls).toHaveLength(2);
    expect(saved().paths).toEqual([]);
    store.saveBackground({ id: 'f', hash: HASH });
    expect(calls).toHaveLength(3);
    expect(saved().backgrounds.map((b) => b.id)).toEqual(['f']);
    store.saveBackground({ id: 'g', hash: HASH, name: 'G' });
    expect(store.getBackground('g').name).toBe('G');
    expect(store.getBackground('zzz')).toBeUndefined();
    store.deleteBackground('f');
    expect(calls).toHaveLength(5);
    expect(saved().backgrounds.map((b) => b.id)).toEqual(['g']);
  });

  test('export JSON indenté', () => {
    store.replaceAll({ seed: 's' });
    expect(store.exportJson()).toBe(JSON.stringify({ version: 1, seed: 's', pois: [], paths: [], backgrounds: [] }, null, 2));
  });
});
