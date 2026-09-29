import { describe, test, expect, beforeAll } from 'vitest';
import { installCanvasMock } from './helpers/canvas.js';
import { loadLeaflet } from './helpers/leaflet.js';

let T;
let N;
// Graine de la texture (hachage de « minecarte »).
const SEED = 694583506;
beforeAll(async () => {
  installCanvasMock();
  loadLeaflet();
  await import('../js/noise.js');
  await import('../js/terrain.js');
  T = window.Terrain;
  N = window.Noise;
});

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const COLORS = { overworld: '#6f9a53', nether: '#7d2f2b', end: '#6e5488' };

// Pixel attendu : couleur × texture (variation par carré de 4 blocs).
function shaded(color, x, z) {
  const shade = 0.97 + 0.05 * N.hash2(x >> 2, z >> 2, SEED + 7);
  return [...new Uint8ClampedArray(hex(color).map((c) => c * shade))];
}

// Tuile au zoom 8 : un bloc par tuile, un seul pixel dans le tampon.
function blockPixel(dimension, x, z) {
  const layer = new T.TerrainLayer({ dimension });
  const tile = layer.createTile({ x, y: z, z: 8 });
  const ctx = tile.getContext('2d');
  const buf = ctx.log.find((op) => op[0] === 'drawImage')[1];
  const img = buf.getContext('2d').image;
  expect(img.width).toBe(1);
  return Array.from(img.data.slice(0, 3));
}

describe('TerrainLayer', () => {
  test('options par défaut', () => {
    const layer = new T.TerrainLayer();
    expect(layer.options.dimension).toBe('overworld');
    expect(layer.options.samples).toBe(128);
    expect(layer.options.minZoom).toBe(-8);
    expect(layer.options.maxZoom).toBe(8);
  });

  test('tuile au zoom 0 : 128 échantillons de 2 blocs, agrandis sans lissage', () => {
    const layer = new T.TerrainLayer({ dimension: 'overworld' });
    const tile = layer.createTile({ x: 1, y: -2, z: 0 });
    expect(tile.width).toBe(256);
    expect(tile.height).toBe(256);
    const ctx = tile.getContext('2d');
    expect(ctx.log).toEqual([
      ['set', 'imageSmoothingEnabled', false],
      ['drawImage', expect.any(HTMLCanvasElement), 0, 0, 256, 256],
    ]);
    const buf = ctx.log[1][1];
    expect(buf.width).toBe(128);
    expect(buf.height).toBe(128);
    const bctx = buf.getContext('2d');
    expect(bctx.log).toEqual([['putImageData', 0, 0]]);
    const { data } = bctx.image;
    // Tuile (1, -2) au zoom 0 : x0 = 256, z0 = -512, un échantillon tous les 2 blocs.
    const expected = new Uint8ClampedArray(128 * 128 * 4);
    for (let j = 0; j < 128; j++) {
      for (let i = 0; i < 128; i++) {
        const x = 256 + i * 2;
        const z = -512 + j * 2;
        expected.set([...shaded(COLORS.overworld, x, z), 255], (j * 128 + i) * 4);
      }
    }
    expect(data).toEqual(expected);
  });

  test('pas d’échantillonnage : jamais moins d’un bloc, jamais plus de 128 échantillons', () => {
    const size = (z) => {
      const tile = new T.TerrainLayer({ dimension: 'nether' }).createTile({ x: 0, y: 0, z });
      return tile.getContext('2d').log[1][1].width;
    };
    expect(size(-3)).toBe(128); // 2048 blocs, un échantillon tous les 16
    expect(size(1)).toBe(128); // 128 blocs
    expect(size(3)).toBe(32); // 32 blocs, un échantillon par bloc
    expect(size(8)).toBe(1); // 1 bloc
  });

  test('échantillons arrondis au bloc inférieur (coordonnées négatives)', () => {
    const tile = new T.TerrainLayer({ dimension: 'nether' }).createTile({ x: -1, y: -1, z: -3 });
    const img = tile.getContext('2d').log[1][1].getContext('2d').image;
    // Premier échantillon : bloc (-2048, -2048) ; dernier : (-16, -16).
    expect(Array.from(img.data.slice(0, 3))).toEqual(shaded(COLORS.nether, -2048, -2048));
    const last = (128 * 128 - 1) * 4;
    expect(Array.from(img.data.slice(last, last + 3))).toEqual(shaded(COLORS.nether, -16, -16));
    expect(img.data[last + 3]).toBe(255);
  });

  test('trois dimensions : même aplat texturé, seule la couleur change', () => {
    for (const [x, z] of [[5, -9], [-300, 41], [0, 0], [42, 0], [-90, -56], [2000, 2000]]) {
      expect(blockPixel('overworld', x, z)).toEqual(shaded(COLORS.overworld, x, z));
      expect(blockPixel('nether', x, z)).toEqual(shaded(COLORS.nether, x, z));
      expect(blockPixel('end', x, z)).toEqual(shaded(COLORS.end, x, z));
    }
    // La texture varie par carré de 4 blocs.
    expect(blockPixel('end', 4, 4)).toEqual(blockPixel('end', 7, 7));
    expect(blockPixel('end', 4, 4)).not.toEqual(blockPixel('end', 8, 4));
  });
});

describe('GridOverlay', () => {
  const ops = (coords) => new T.GridOverlay().createTile(coords).getContext('2d').log;
  const lines = (log) => {
    const out = [];
    for (let i = 0; i < log.length; i++) {
      if (log[i][0] === 'moveTo') out.push([...log[i].slice(1), ...log[i + 1].slice(1)]);
    }
    return out;
  };

  test('options', () => {
    const grid = new T.GridOverlay();
    expect(grid.options).toMatchObject({
      minZoom: -8, maxZoom: 8, pane: 'gridPane',
      color: 'rgba(0,0,0,0.25)', strongColor: 'rgba(0,0,0,0.55)', axisColor: 'rgba(255,255,255,0.8)',
    });
  });

  test('zoom 0, tuile (0, 0) : chunks, région et axes', () => {
    const log = ops({ x: 0, y: 0, z: 0 });
    const tile = new T.GridOverlay().createTile({ x: 0, y: 0, z: 0 });
    expect(tile.width).toBe(256);
    expect(tile.height).toBe(256);
    const chunk = [];
    for (let x = 0; x <= 256; x += 16) chunk.push([x + 0.5, 0, x + 0.5, 256]);
    for (let z = 0; z <= 256; z += 16) chunk.push([0, z + 0.5, 256, z + 0.5]);
    expect(log.slice(0, 3)).toEqual([['set', 'strokeStyle', 'rgba(0,0,0,0.25)'], ['set', 'lineWidth', 1], ['beginPath']]);
    const strokes = log.map((op, i) => (op[0] === 'stroke' ? i : -1)).filter((i) => i >= 0);
    expect(strokes).toHaveLength(3); // pas de lignes de blocs à ce zoom
    expect(lines(log.slice(0, strokes[0]))).toEqual(chunk);
    expect(log.slice(strokes[0] + 1, strokes[0] + 4)).toEqual([['set', 'strokeStyle', 'rgba(0,0,0,0.55)'], ['set', 'lineWidth', 1.5], ['beginPath']]);
    expect(lines(log.slice(strokes[0], strokes[1]))).toEqual([[0.5, 0, 0.5, 256], [0, 0.5, 256, 0.5]]);
    expect(log.slice(strokes[1] + 1, strokes[1] + 4)).toEqual([['set', 'strokeStyle', 'rgba(255,255,255,0.8)'], ['set', 'lineWidth', 1.5], ['beginPath']]);
    expect(lines(log.slice(strokes[1], strokes[2]))).toEqual([[0.5, 0, 0.5, 256], [0, 0.5, 256, 0.5]]);
  });

  test('zoom 0, tuile (1, 1) : région au bord droit/bas, pas d’axe', () => {
    const log = ops({ x: 1, y: 1, z: 0 });
    const strokes = log.map((op, i) => (op[0] === 'stroke' ? i : -1)).filter((i) => i >= 0);
    expect(lines(log.slice(strokes[0], strokes[1]))).toEqual([[256.5, 0, 256.5, 256], [0, 256.5, 256, 256.5]]);
    expect(lines(log.slice(strokes[1], strokes[2]))).toEqual([]);
  });

  test('axes sur le bord : tuile (-1, -1) les dessine à droite et en bas', () => {
    const log = ops({ x: -1, y: -1, z: 0 });
    const strokes = log.map((op, i) => (op[0] === 'stroke' ? i : -1)).filter((i) => i >= 0);
    expect(lines(log.slice(strokes[1], strokes[2]))).toEqual([[256.5, 0, 256.5, 256], [0, 256.5, 256, 256.5]]);
  });

  test('axes absents d’une tuile qui ne les contient pas', () => {
    const log = ops({ x: -2, y: 3, z: 0 });
    const strokes = log.map((op, i) => (op[0] === 'stroke' ? i : -1)).filter((i) => i >= 0);
    expect(lines(log.slice(strokes[1], strokes[2]))).toEqual([]);
  });

  test('axes à un zoom ≠ 0 : position × échelle', () => {
    const log = ops({ x: -1, y: -1, z: 1 });
    const strokes = log.map((op, i) => (op[0] === 'stroke' ? i : -1)).filter((i) => i >= 0);
    expect(lines(log.slice(strokes.at(-2), strokes.at(-1)))).toEqual([[256.5, 0, 256.5, 256], [0, 256.5, 256, 256.5]]);
  });

  test('axe horizontal absent quand la tuile est entièrement au nord', () => {
    const log = ops({ x: 0, y: -2, z: 0 });
    const strokes = log.map((op, i) => (op[0] === 'stroke' ? i : -1)).filter((i) => i >= 0);
    expect(lines(log.slice(strokes[1], strokes[2]))).toEqual([[0.5, 0, 0.5, 256]]);
  });

  test('zoom 3 : lignes de blocs visibles (8 px)', () => {
    const log = ops({ x: 0, y: 0, z: 3 });
    expect(log.slice(0, 3)).toEqual([['set', 'strokeStyle', 'rgba(0,0,0,0.12)'], ['set', 'lineWidth', 1], ['beginPath']]);
    const first = log.findIndex((op) => op[0] === 'stroke');
    const block = lines(log.slice(0, first));
    expect(block).toHaveLength(66); // 33 verticales (0 à 32 inclus) + 33 horizontales
    expect(block[1]).toEqual([8.5, 0, 8.5, 256]);
    expect(block[32]).toEqual([256.5, 0, 256.5, 256]);
    expect(block[34]).toEqual([0, 8.5, 256, 8.5]);
  });

  test('seuil de 8 px : chunks tracés au zoom -1, masqués au zoom -2', () => {
    const count = (z) => ops({ x: 0, y: 0, z }).filter((op) => op[0] === 'stroke').length;
    expect(count(-1)).toBe(3); // chunks (8 px) + régions + axes
    expect(count(-2)).toBe(2); // régions (128 px) + axes
    expect(count(-6)).toBe(2); // régions à 8 px
    expect(count(-7)).toBe(1); // axes seulement
  });

  test('zoom -3 : échelle 1/8', () => {
    const log = ops({ x: 0, y: 0, z: -3 });
    const first = log.findIndex((op) => op[0] === 'stroke');
    const regions = lines(log.slice(0, first));
    expect(regions[0]).toEqual([0.5, 0, 0.5, 256]);
    expect(regions[1]).toEqual([64.5, 0, 64.5, 256]);
    expect(regions).toHaveLength(10);
  });
});

test('couleurs de fond des conteneurs', () => {
  expect(T.background).toEqual({ overworld: '#6f9a53', nether: '#7d2f2b', end: '#6e5488' });
});
