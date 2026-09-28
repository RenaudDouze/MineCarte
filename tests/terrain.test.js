import { describe, test, expect, beforeAll } from 'vitest';
import { installCanvasMock } from './helpers/canvas.js';

let T;
let N;
let SEED;
beforeAll(async () => {
  installCanvasMock();
  await import('../vendor/leaflet/leaflet.js');
  await import('../js/noise.js');
  await import('../js/terrain.js');
  T = window.Terrain;
  N = window.Noise;
  SEED = N.seedFrom('minecarte');
});

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const COLORS = { overworld: '#8e9985', nether: '#5a2b2b', void: '#0c0918', stone: '#dcdca2', obsidian: '#1b1128', bedrock: '#3c3c3c' };

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
  return [...img.data.slice(0, 3)];
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
    expect([...img.data.slice(0, 3)]).toEqual(shaded(COLORS.nether, -2048, -2048));
    const last = (128 * 128 - 1) * 4;
    expect([...img.data.slice(last, last + 3)]).toEqual(shaded(COLORS.nether, -16, -16));
    expect(img.data[last + 3]).toBe(255);
  });

  test('Overworld et Nether : aplat texturé', () => {
    expect(blockPixel('overworld', 5, -9)).toEqual(shaded(COLORS.overworld, 5, -9));
    expect(blockPixel('nether', -300, 41)).toEqual(shaded(COLORS.nether, -300, 41));
    // La texture varie par carré de 4 blocs.
    expect(blockPixel('overworld', 4, 4)).toEqual(blockPixel('overworld', 7, 7));
  });
});

describe('End', () => {
  const at = (x, z) => blockPixel('end', x, z);

  test('bedrock du portail de sortie au centre (rayon < 4)', () => {
    expect(at(0, 0)).toEqual(shaded(COLORS.bedrock, 0, 0));
    expect(at(3, 0)).toEqual(shaded(COLORS.bedrock, 3, 0));
    expect(at(-2, 2)).toEqual(shaded(COLORS.bedrock, -2, 2));
    expect(at(0, -3)).toEqual(shaded(COLORS.bedrock, 0, -3));
    expect(at(4, 0)).toEqual(shaded(COLORS.stone, 4, 0));
    expect(at(3, 3)).toEqual(shaded(COLORS.stone, 3, 3));
  });

  test('dix piliers d’obsidienne à 42 blocs, rayons 3, 4 et 5', () => {
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI / 5) * i;
      const px = Math.round(42 * Math.cos(angle));
      const pz = Math.round(42 * Math.sin(angle));
      const r = 3 + (i % 3);
      expect(at(px, pz)).toEqual(shaded(COLORS.obsidian, px, pz));
      // Bord inclus (distance = rayon), juste au-delà : pierre de l'End.
      expect(at(px + r, pz)).toEqual(shaded(COLORS.obsidian, px + r, pz));
      expect(at(px, pz - r)).toEqual(shaded(COLORS.obsidian, px, pz - r));
      expect(at(px - r - 1, pz)).toEqual(shaded(COLORS.stone, px - r - 1, pz));
      expect(at(px, pz + r + 1)).toEqual(shaded(COLORS.stone, px, pz + r + 1));
    }
  });

  test('positions des piliers', () => {
    const obsidian = (x, z) => JSON.stringify(at(x, z)) === JSON.stringify(shaded(COLORS.obsidian, x, z));
    expect(obsidian(42, 0)).toBe(true);
    expect(obsidian(-42, 0)).toBe(true);
    expect(obsidian(13, 40)).toBe(true);
    expect(obsidian(-34, -25)).toBe(true);
    expect(obsidian(0, 42)).toBe(false);
  });

  const radius = (angle) => Math.round(115 + (N.fbm(Math.cos(angle) * 3 + 10, Math.sin(angle) * 3 + 10, SEED + 211, 3) - 0.5) * 90);

  test('bord exact : un bloc pile sur le rayon est dans le vide', () => {
    // Blocs dont la distance au centre est exactement le rayon de l'île à leur angle.
    for (const [x, z, r] of [[-90, -56, 106], [-84, 0, 84], [0, -127, 127], [28, -96, 100]]) {
      expect(radius(Math.atan2(z, x))).toBe(r);
      expect(x * x + z * z).toBe(r * r);
      expect(at(x, z)).toEqual(shaded(COLORS.void, x, z));
    }
    // Un bloc plus près du centre, sur le même rayon (-84, 0) → (-83, 0).
    expect(at(-83, 0)).toEqual(shaded(COLORS.stone, -83, 0));
  });

  test('contour de l’île : 115 blocs ± 45 selon l’angle', () => {
    for (const deg of [0, 37, 90, 145, 200, 271, 333]) {
      const angle = (deg * Math.PI) / 180;
      const edge = radius(angle);
      expect(edge).toBeGreaterThan(70);
      expect(edge).toBeLessThan(160);
      // Point juste à l'intérieur et juste à l'extérieur du contour, à cet angle.
      const inside = [Math.round(Math.cos(angle) * (edge - 2)), Math.round(Math.sin(angle) * (edge - 2))];
      const outside = [Math.round(Math.cos(angle) * (edge + 2)), Math.round(Math.sin(angle) * (edge + 2))];
      expect(at(...inside)).toEqual(shaded(COLORS.stone, ...inside));
      expect(at(...outside)).toEqual(shaded(COLORS.void, ...outside));
    }
  });

  test('vide partout ailleurs, pas d’îles extérieures', () => {
    for (const [x, z] of [[300, 0], [0, -1500], [2000, 2000], [-5000, 123]]) {
      expect(at(x, z)).toEqual(shaded(COLORS.void, x, z));
    }
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
  expect(T.background).toEqual({ overworld: '#8e9985', nether: '#5a2b2b', end: '#0c0918' });
});
