import { describe, test, expect, beforeAll } from 'vitest';
import { loadLeaflet } from './helpers/leaflet.js';

beforeAll(async () => {
  loadLeaflet();
  await import('../js/utils.js');
});

const U = () => window.Utils;

describe('coordonnées', () => {
  test('toLatLng vise le centre du bloc (lng = X, lat = -Z)', () => {
    const ll = U().toLatLng(10, -3);
    expect(ll.lng).toBe(10.5);
    expect(ll.lat).toBe(2.5);
  });

  test('fromLatLng renvoie le bloc contenant le point', () => {
    expect(U().fromLatLng({ lng: 10.9, lat: 2.1 })).toEqual({ x: 10, z: -3 });
    expect(U().fromLatLng({ lng: -0.1, lat: 0.1 })).toEqual({ x: -1, z: -1 });
    expect(U().fromLatLng(U().toLatLng(-7, 42))).toEqual({ x: -7, z: 42 });
  });

  test('convert : Overworld ↔ Nether, rien pour l’End', () => {
    expect(U().convert('overworld', 100, -100)).toEqual({ dim: 'nether', x: 12, z: -13 });
    expect(U().convert('overworld', 7, 8)).toEqual({ dim: 'nether', x: 0, z: 1 });
    expect(U().convert('nether', 12, -13)).toEqual({ dim: 'overworld', x: 96, z: -104 });
    expect(U().convert('end', 1, 2)).toBeNull();
  });
});

describe('texte', () => {
  test('esc échappe les caractères HTML', () => {
    expect(U().esc(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
    expect(U().esc(42)).toBe('42');
  });

  test('fmt formate à la française', () => {
    expect(U().fmt(1234567)).toBe((1234567).toLocaleString('fr-FR'));
    expect(U().fmt(3)).toBe('3');
  });

  test('constantes', () => {
    expect(U().DIM_LABELS).toEqual({ overworld: 'Overworld', nether: 'Nether', end: 'End' });
    expect(U().SWATCHES).toHaveLength(11);
    expect(U().SWATCHES[0]).toBe('#e53935');
    expect(U().SWATCHES.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });
});

describe('h (constructeur DOM)', () => {
  test('attributs, style, booléens, événements et enfants', () => {
    let clicked = 0;
    const child = document.createElement('i');
    const el = U().h('button', {
      type: 'button',
      class: 'x',
      style: 'color: red',
      'data-flag': true,
      hidden: false,
      title: null,
      'data-n': 0,
      onclick: () => { clicked++; },
    }, 'a', [1, child], null, false, 0);
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.getAttribute('class')).toBe('x');
    expect(el.style.color).toBe('red');
    expect(el.getAttribute('data-flag')).toBe('');
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.getAttribute('data-n')).toBe('0');
    expect(el.hasAttribute('onclick')).toBe(false);
    expect(el.textContent).toBe('a10');
    expect(el.contains(child)).toBe(true);
    el.click();
    expect(clicked).toBe(1);
  });

  test('sans attributs', () => {
    const el = U().h('span', null, 'texte');
    expect(el.outerHTML).toBe('<span>texte</span>');
  });
});

describe('géométrie', () => {
  test('pathLength additionne et arrondit', () => {
    expect(U().pathLength([])).toBe(0);
    expect(U().pathLength([[0, 0]])).toBe(0);
    expect(U().pathLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
    expect(U().pathLength([[0, 0], [1, 1]])).toBe(1);
    expect(U().pathLength([[0, 0], [1, 2]])).toBe(2);
  });

  test('segmentDistance : projection, extrémités et segment dégénéré', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(U().segmentDistance({ x: 5, y: 3 }, a, b)).toBe(3);
    expect(U().segmentDistance({ x: -3, y: 4 }, a, b)).toBe(5);
    expect(U().segmentDistance({ x: 13, y: 4 }, a, b)).toBe(5);
    expect(U().segmentDistance({ x: 3, y: 4 }, a, a)).toBe(5);
    expect(U().segmentDistance({ x: 2, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 10 })).toBe(2);
    // Segment décalé de l'origine (a ≠ 0) : dx = b.x - a.x, dy = b.y - a.y.
    expect(U().segmentDistance({ x: 25, y: 23 }, { x: 20, y: 20 }, { x: 30, y: 20 })).toBe(3);
    expect(U().segmentDistance({ x: 22, y: 25 }, { x: 20, y: 20 }, { x: 20, y: 30 })).toBe(2);
    expect(U().segmentDistance({ x: 7, y: 11 }, { x: 4, y: 7 }, { x: 10, y: 15 })).toBe(0);
  });

  test('nearestSegment choisit le segment le plus proche (premier en cas d’égalité)', () => {
    const v = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(U().nearestSegment({ x: 5, y: 1 }, v)).toBe(0);
    expect(U().nearestSegment({ x: 9, y: 5 }, v)).toBe(1);
    expect(U().nearestSegment({ x: 5, y: 9 }, v)).toBe(2);
    expect(U().nearestSegment({ x: 10, y: 0 }, v)).toBe(0);
    expect(U().nearestSegment({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(0);
  });
});

describe('extent', () => {
  const poi = (x, z, dim = 'overworld') => ({ x, z, dim });
  const path = (points, dim = 'overworld') => ({ points, dim });

  test('lieux et points de chemins de la dimension seulement', () => {
    const pois = [poi(10, -5), poi(-3, 40), poi(9999, 9999, 'nether')];
    const paths = [path([[0, 0], [25, -60], [7, 7]]), path([[-9999, 0], [0, -9999]], 'end')];
    expect(U().extent(pois, paths, 'overworld')).toEqual({ minX: -3, minZ: -60, maxX: 25, maxZ: 40 });
  });

  test('un seul lieu, ou seulement des chemins', () => {
    expect(U().extent([poi(4, -2, 'end')], [], 'end')).toEqual({ minX: 4, minZ: -2, maxX: 4, maxZ: -2 });
    expect(U().extent([], [path([[5, 1], [-5, 2]], 'nether')], 'nether')).toEqual({ minX: -5, minZ: 1, maxX: 5, maxZ: 2 });
  });

  test('dimension vide : null', () => {
    expect(U().extent([], [], 'overworld')).toBeNull();
    expect(U().extent([poi(1, 1, 'nether')], [path([[0, 0], [1, 1]], 'end')], 'overworld')).toBeNull();
  });
});

describe('recherche', () => {
  test('normalize : minuscules, sans accents ni espaces autour', () => {
    expect(U().normalize('  Éléphant ÇA Où ')).toBe('elephant ca ou');
    expect(U().normalize(42)).toBe('42');
  });

  test('parseCoords : X Z et X Y Z, séparateurs variés', () => {
    const p = (t) => U().parseCoords(t);
    expect(p('120 -40')).toEqual({ x: 120, y: null, z: -40 });
    expect(p('120 64 -40')).toEqual({ x: 120, y: 64, z: -40 });
    expect(p('-7 0 3')).toEqual({ x: -7, y: 0, z: 3 });
    expect(p('120 ~ -40')).toEqual({ x: 120, y: null, z: -40 });
    expect(p('1,2')).toEqual({ x: 1, y: null, z: 2 });
    expect(p('1;2;3')).toEqual({ x: 1, y: 2, z: 3 });
    expect(p('  5 ,\t6  ')).toEqual({ x: 5, y: null, z: 6 });
    expect(p('10  20   30')).toEqual({ x: 10, y: 20, z: 30 });
  });

  test('parseCoords : décimales ramenées au bloc qui les contient', () => {
    expect(U().parseCoords('1.7 64.99 -3.2')).toEqual({ x: 1, y: 64, z: -4 });
    expect(U().parseCoords('-0.5 -0.5')).toEqual({ x: -1, y: null, z: -1 });
    expect(U().parseCoords('12.25 7')).toEqual({ x: 12, y: null, z: 7 });
    expect(U().parseCoords('7 -12.25')).toEqual({ x: 7, y: null, z: -13 });
  });

  test('parseCoords : tout le reste est refusé', () => {
    for (const t of ['', '1', '1 2 3 4', 'a 1', '1 a', 'x1 2', '1 2x', '1 ~', '~ 1 2', '1 2 ~', '1. 2', '1 .5', '--1 2', '1-2', '1 - 2', 'Base 12', '1 2 3 a', '12']) {
      expect([t, U().parseCoords(t)]).toEqual([t, null]);
    }
  });

  const pois = [
    { name: 'Village des plaines' }, { name: 'Élevage' }, { name: 'Base' }, { name: 'Grande base' }, { name: 'Mine' },
  ];
  const paths = [{ name: 'Route du village' }, { name: 'Tunnel' }, { name: 'Autoroute' }];

  test('searchItems : lieux et chemins, accents et casse ignorés', () => {
    const r = U().searchItems('VILL', pois, paths, 10);
    expect(r).toEqual([
      { type: 'poi', item: pois[0] },
      { type: 'path', item: paths[0] },
    ]);
    expect(U().searchItems('elev', pois, paths, 10)).toEqual([{ type: 'poi', item: pois[1] }]);
  });

  test('searchItems : commence par la recherche d’abord, puis ordre alphabétique', () => {
    expect(U().searchItems('base', pois, paths, 10).map((r) => r.item.name)).toEqual(['Base', 'Grande base']);
    expect(U().searchItems('route', pois, paths, 10).map((r) => r.item.name)).toEqual(['Route du village', 'Autoroute']);
    expect(U().searchItems('e', pois, paths, 10).map((r) => r.item.name))
      .toEqual(['Élevage', 'Autoroute', 'Base', 'Grande base', 'Mine', 'Route du village', 'Tunnel', 'Village des plaines']);
  });

  test('searchItems : limite, recherche vide', () => {
    expect(U().searchItems('e', pois, paths, 3).map((r) => r.item.name)).toEqual(['Élevage', 'Autoroute', 'Base']);
    expect(U().searchItems('   ', pois, paths, 10)).toEqual([]);
    expect(U().searchItems('zzz', pois, paths, 10)).toEqual([]);
  });
});
