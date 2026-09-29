/*
 * Fond de carte des trois dimensions et grille (blocs / chunks / régions),
 * sous forme de GridLayer Leaflet.
 *
 * Le fond ressemble à une carte Minecraft (océans, rivières, biomes, lave du
 * Nether, îles de l'End) mais il est inventé : il est généré à partir d'une
 * graine fixe et ne correspond à aucun monde. La carte l'indique en
 * permanence (« Fond fictif »). Seule l'île centrale de l'End, ses piliers et
 * le portail de sortie sont à leur vraie place.
 *
 * Convention de coordonnées (identique à Minecraft) :
 *   X croît vers l'est, Z croît vers le sud.
 * Avec L.CRS.Simple : lng = X, lat = -Z. Au zoom 0, 1 pixel = 1 bloc.
 */
(function (global) {
  'use strict';

  const { fbm, hash2 } = global.Noise;

  const SEED = global.Noise.seedFrom('minecarte');

  function hex(color) {
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Bruit fBm ramené à un entier de 0 à 999 : les seuils des biomes sont des
  // entiers, comparés exactement.
  function level(x, z, scale, salt, octaves) {
    return Math.floor(fbm(x / scale, z / scale, SEED + salt, octaves) * 1000);
  }

  const OVERWORLD = {
    deepOcean: hex('#1f3478'),
    ocean: hex('#2f52b0'),
    coldOcean: hex('#3d5aa8'),
    river: hex('#3f6fd6'),
    beach: hex('#e3d79b'),
    snowyBeach: hex('#e8e6d8'),
    plains: hex('#8db360'),
    sunflower: hex('#a3c060'),
    forest: hex('#3f8a36'),
    birch: hex('#5c9c4a'),
    darkForest: hex('#2f4d1e'),
    swamp: hex('#4d6b45'),
    taiga: hex('#3f6b57'),
    snowyTaiga: hex('#9fb8ae'),
    snowy: hex('#eef4f8'),
    desert: hex('#e8c56d'),
    badlands: hex('#c46a36'),
    savanna: hex('#bdb25f'),
    jungle: hex('#4f8a14'),
    mountains: hex('#8a8a8a'),
    peaks: hex('#dde6ee'),
  };

  const NETHER = {
    wastes: hex('#8a3030'),
    crimson: hex('#a71d2a'),
    warped: hex('#1e8078'),
    soul: hex('#5b4636'),
    basalt: hex('#4a4546'),
    lava: hex('#e0661c'),
  };

  const END = {
    void: hex('#0c0918'),
    stone: hex('#dcdca2'),
    obsidian: hex('#1b1128'),
    bedrock: hex('#3c3c3c'),
    chorus: hex('#8c6a9c'),
  };

  // Élévation, température et humidité décident du biome.
  function overworld(x, z) {
    const e = level(x, z, 1100, 0, 5);
    const t = level(x, z, 2200, 11, 3);
    const m = level(x, z, 1400, 23, 3);

    if (e < 360) return OVERWORLD.deepOcean;
    if (e < 440) return t < 360 ? OVERWORLD.coldOcean : OVERWORLD.ocean;
    if (e < 452) return t < 360 ? OVERWORLD.snowyBeach : OVERWORLD.beach;

    // Rivières : une fine bande autour de la ligne médiane d'un autre bruit.
    if (e < 660 && Math.abs(level(x, z, 800, 37, 3) - 500) < 9) return OVERWORLD.river;

    if (e >= 730) return OVERWORLD.peaks;
    if (e >= 665) return t < 380 ? OVERWORLD.peaks : OVERWORLD.mountains;

    if (t < 330) return m >= 500 ? OVERWORLD.snowyTaiga : OVERWORLD.snowy;
    if (t < 410) return m >= 470 ? OVERWORLD.taiga : OVERWORLD.plains;
    if (t >= 580) {
      if (m < 440) return e >= 560 ? OVERWORLD.badlands : OVERWORLD.desert;
      return m >= 560 ? OVERWORLD.jungle : OVERWORLD.savanna;
    }
    if (t >= 530) {
      if (m < 460) return OVERWORLD.savanna;
      return m >= 570 ? OVERWORLD.swamp : OVERWORLD.plains;
    }
    if (m >= 580) return OVERWORLD.darkForest;
    if (m >= 520) return OVERWORLD.forest;
    if (m >= 470) return OVERWORLD.birch;
    return m < 410 ? OVERWORLD.sunflower : OVERWORLD.plains;
  }

  function nether(x, z) {
    if (level(x, z, 180, 301, 3) < 330) return NETHER.lava;
    const a = level(x, z, 420, 101, 4);
    if (a >= 580) return NETHER.crimson;
    if (a < 410) return NETHER.warped;
    const b = level(x, z, 420, 131, 4);
    if (b >= 590) return NETHER.soul;
    return b < 410 ? NETHER.basalt : NETHER.wastes;
  }

  // Dix piliers d'obsidienne répartis sur un cercle de 42 blocs.
  const PILLARS = Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i;
    return [Math.round(42 * Math.cos(angle)), Math.round(42 * Math.sin(angle)), 3 + (i % 3)];
  });

  // Rayon de l'île centrale selon l'angle : 115 blocs ± 45, en blocs entiers.
  function islandRadius(angle) {
    return Math.round(115 + (fbm(Math.cos(angle) * 3 + 10, Math.sin(angle) * 3 + 10, SEED + 211, 3) - 0.5) * 90);
  }

  // Île centrale (vraie), puis îles extérieures (inventées) au-delà de
  // 1 056 blocs environ (distance comptée par anneaux de 64 blocs).
  function end(x, z) {
    const d2 = x * x + z * z;
    if (d2 < 16) return END.bedrock;
    for (const [px, pz, r] of PILLARS) {
      if ((x - px) * (x - px) + (z - pz) * (z - pz) <= r * r) return END.obsidian;
    }
    const radius = islandRadius(Math.atan2(z, x));
    if (d2 < radius * radius) return END.stone;
    if (Math.round(Math.sqrt(d2) / 64) > 16 && level(x, z, 140, 223, 4) >= 700) {
      return level(x, z, 18, 227, 2) >= 660 ? END.chorus : END.stone;
    }
    return END.void;
  }

  const GENERATORS = { overworld, nether, end };

  const TerrainLayer = L.GridLayer.extend({
    options: {
      dimension: 'overworld',
      samples: 128,
      minZoom: -8,
      maxZoom: 8,
    },

    createTile(coords) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x;
      tile.height = size.y;

      const scale = Math.pow(2, coords.z);
      const blocksPerTile = size.x / scale;
      const step = Math.max(1, blocksPerTile / this.options.samples);
      const n = Math.max(1, Math.round(blocksPerTile / step));
      const x0 = coords.x * blocksPerTile;
      const z0 = coords.y * blocksPerTile;

      const generate = GENERATORS[this.options.dimension];
      const buf = document.createElement('canvas');
      buf.width = n;
      buf.height = n;
      const bctx = buf.getContext('2d');
      const img = bctx.createImageData(n, n);
      const data = img.data;

      for (let j = 0; j < n; j++) {
        const z = Math.floor(z0 + j * step);
        for (let i = 0; i < n; i++) {
          const x = Math.floor(x0 + i * step);
          const c = generate(x, z);
          // Légère variation de teinte par carré de 4 blocs, pour le relief.
          const shade = 0.93 + 0.1 * hash2(x >> 2, z >> 2, SEED + 7);
          data.set([c[0] * shade, c[1] * shade, c[2] * shade, 255], (j * n + i) * 4);
        }
      }
      bctx.putImageData(img, 0, 0);

      const ctx = tile.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buf, 0, 0, size.x, size.y);
      return tile;
    },
  });

  const GridOverlay = L.GridLayer.extend({
    options: {
      minZoom: -8,
      maxZoom: 8,
      pane: 'gridPane',
      color: 'rgba(0,0,0,0.25)',
      strongColor: 'rgba(0,0,0,0.55)',
      axisColor: 'rgba(255,255,255,0.8)',
    },

    createTile(coords) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x;
      tile.height = size.y;
      const ctx = tile.getContext('2d');

      const scale = Math.pow(2, coords.z);
      const blocksPerTile = size.x / scale;
      const x0 = coords.x * blocksPerTile;
      const z0 = coords.y * blocksPerTile;

      // Une famille de lignes n'est tracée que si elles sont espacées d'au
      // moins 8 px (les espacements sont des puissances de deux).
      const drawLines = (spacing, style, width) => {
        if (spacing * scale < 8) return;
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let x = Math.ceil(x0 / spacing) * spacing; x <= x0 + blocksPerTile; x += spacing) {
          const px = Math.round((x - x0) * scale) + 0.5;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, size.y);
        }
        for (let z = Math.ceil(z0 / spacing) * spacing; z <= z0 + blocksPerTile; z += spacing) {
          const pz = Math.round((z - z0) * scale) + 0.5;
          ctx.moveTo(0, pz);
          ctx.lineTo(size.x, pz);
        }
        ctx.stroke();
      };

      drawLines(1, 'rgba(0,0,0,0.12)', 1);
      drawLines(16, this.options.color, 1);
      drawLines(512, this.options.strongColor, 1.5);

      // Axes X=0 et Z=0.
      ctx.strokeStyle = this.options.axisColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (x0 <= 0 && x0 + blocksPerTile >= 0) {
        const px = Math.round(-x0 * scale) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, size.y);
      }
      if (z0 <= 0 && z0 + blocksPerTile >= 0) {
        const pz = Math.round(-z0 * scale) + 0.5;
        ctx.moveTo(0, pz);
        ctx.lineTo(size.x, pz);
      }
      ctx.stroke();
      return tile;
    },
  });

  global.Terrain = {
    TerrainLayer,
    GridOverlay,
    generators: GENERATORS,
    // Couleur du conteneur pendant le chargement des tuiles.
    background: { overworld: '#2f52b0', nether: '#8a3030', end: '#0c0918' },
  };
})(window);
