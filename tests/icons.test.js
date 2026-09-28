import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const BASE = 'https://cdn.jsdelivr.net/npm/minecraft-textures@26.3.0/dist/textures';
const ITEMS = [
  { id: 'minecraft:diamond_sword', readable: 'Diamond Sword', texture: 'aa.png' },
  { id: 'minecraft:diamond', readable: 'Diamond', texture: 'bb.png' },
  { id: 'minecraft:red_bed', readable: 'Red Bed', texture: 'cc.png' },
  { id: 'minecraft:totem_of_undying', readable: 'Totem of Undying', texture: 'dd.png' },
];

let I;
// Module neuf à chaque test (état de chargement remis à zéro).
async function fresh() {
  vi.resetModules();
  delete window.Icons;
  await import('../js/icons.js');
  I = window.Icons;
}

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

beforeEach(fresh);
afterEach(() => vi.unstubAllGlobals());

describe('avant chargement', () => {
  test('rien de chargé', () => {
    expect(I.isLoaded()).toBe(false);
    expect(I.search('diamond', 10)).toEqual([]);
    expect(I.url('minecraft:diamond')).toBeNull();
  });

  test('nom lisible déduit de l’identifiant', () => {
    expect(I.name('minecraft:totem_of_undying')).toBe('totem of undying');
    expect(I.name('xminecraft:a_b')).toBe('xminecraft:a b');
    expect(I.name(undefined)).toBe('');
    expect(I.name('')).toBe('');
  });
});

describe('chargement', () => {
  test('manifeste chargé une seule fois', async () => {
    const fetch = vi.fn(() => ok({ items: ITEMS }));
    vi.stubGlobal('fetch', fetch);
    const p1 = I.load();
    const p2 = I.load();
    expect(p1).toBe(p2);
    expect(await p1).toEqual(ITEMS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${BASE}/manifest/26.3.json`);
    expect(I.isLoaded()).toBe(true);
    expect(await I.load()).toEqual(ITEMS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('échec HTTP : rejet, puis nouvel essai possible', async () => {
    const fetch = vi.fn()
      .mockReturnValueOnce(Promise.resolve({ ok: false, status: 503 }))
      .mockReturnValueOnce(ok({ items: ITEMS }));
    vi.stubGlobal('fetch', fetch);
    await expect(I.load()).rejects.toThrow('HTTP 503');
    expect(I.isLoaded()).toBe(false);
    expect(await I.load()).toEqual(ITEMS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('erreur réseau : rejet, puis nouvel essai possible', async () => {
    const fetch = vi.fn()
      .mockReturnValueOnce(Promise.reject(new Error('hors ligne')))
      .mockReturnValueOnce(ok({ items: ITEMS }));
    vi.stubGlobal('fetch', fetch);
    await expect(I.load()).rejects.toThrow('hors ligne');
    await expect(I.load()).resolves.toEqual(ITEMS);
  });
});

describe('après chargement', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', () => ok({ items: ITEMS }));
    await I.load();
  });

  test('URL de texture et nom anglais', () => {
    expect(I.url('minecraft:red_bed')).toBe(`${BASE}/assets/cc.png`);
    expect(I.url('minecraft:inconnu')).toBeNull();
    expect(I.name('minecraft:red_bed')).toBe('Red Bed');
    expect(I.name('minecraft:inconnu_ici')).toBe('inconnu ici');
  });

  test('recherche : tous les mots, sans casse, sur le nom et l’identifiant', () => {
    expect(I.search('diamond', 10).map((i) => i.readable)).toEqual(['Diamond Sword', 'Diamond']);
    expect(I.search('  SWORD   diamond ', 10).map((i) => i.readable)).toEqual(['Diamond Sword']);
    expect(I.search('red_bed', 10).map((i) => i.readable)).toEqual(['Red Bed']);
    expect(I.search('of undying', 10).map((i) => i.readable)).toEqual(['Totem of Undying']);
    expect(I.search('diamond bed', 10)).toEqual([]);
  });

  test('recherche : limite respectée, requête vide = tout', () => {
    expect(I.search('', 10)).toHaveLength(4);
    expect(I.search('   ', 2).map((i) => i.readable)).toEqual(['Diamond Sword', 'Diamond']);
    expect(I.search('minecraft', 3)).toHaveLength(3);
    expect(I.search('diamond', 1).map((i) => i.readable)).toEqual(['Diamond Sword']);
  });
});
