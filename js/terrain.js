/*
 * Génération des fonds de carte des trois dimensions et de la grille
 * (blocs / chunks / régions), sous forme de GridLayer Leaflet.
 *
 * Convention de coordonnées (identique à Minecraft) :
 *   X croît vers l'est, Z croît vers le sud.
 * Avec L.CRS.Simple : lng = X, lat = -Z. Au zoom 0, 1 pixel = 1 bloc.
 */
(function (global) {
  'use strict';

  const { fbm, hash2 } = global.Noise;

  function hex(color) {
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

  function overworld(x, z, seed) {
    const e = fbm(x / 1100, z / 1100, seed, 5);
    const t = fbm(x / 2200, z / 2200, seed + 11, 3);
    const m = fbm(x / 1400, z / 1400, seed + 23, 3);

    if (e < 0.36) return OVERWORLD.deepOcean;
    if (e < 0.44) return t < 0.36 ? OVERWORLD.coldOcean : OVERWORLD.ocean;
    if (e < 0.452) return t < 0.36 ? OVERWORLD.snowyBeach : OVERWORLD.beach;

    const r = fbm(x / 800, z / 800, seed + 37, 3);
    if (Math.abs(r - 0.5) < 0.009 && e < 0.66) return OVERWORLD.river;

    if (e > 0.73) return OVERWORLD.peaks;
    if (e > 0.665) return t < 0.38 ? OVERWORLD.peaks : OVERWORLD.mountains;

    if (t < 0.33) return m > 0.5 ? OVERWORLD.snowyTaiga : OVERWORLD.snowy;
    if (t < 0.41) return m > 0.47 ? OVERWORLD.taiga : OVERWORLD.plains;
    if (t > 0.58) {
      if (m < 0.44) return e > 0.56 ? OVERWORLD.badlands : OVERWORLD.desert;
      if (m > 0.56) return OVERWORLD.jungle;
      return OVERWORLD.savanna;
    }
    if (t > 0.53) return m < 0.46 ? OVERWORLD.savanna : m > 0.57 ? OVERWORLD.swamp : OVERWORLD.plains;
    if (m > 0.58) return OVERWORLD.darkForest;
    if (m > 0.52) return OVERWORLD.forest;
    if (m > 0.47) return OVERWORLD.birch;
    return m < 0.41 ? OVERWORLD.sunflower : OVERWORLD.plains;
  }

  function nether(x, z, seed) {
    const l = fbm(x / 180, z / 180, seed + 301, 3);
    if (l < 0.33) return NETHER.lava;
    const a = fbm(x / 420, z / 420, seed + 101, 4);
    const b = fbm(x / 420, z / 420, seed + 131, 4);
    if (a > 0.58) return NETHER.crimson;
    if (a < 0.41) return NETHER.warped;
    if (b > 0.59) return NETHER.soul;
    if (b < 0.41) return NETHER.basalt;
    return NETHER.wastes;
  }

  const PILLARS = Array.from({ length: 10 }, (_, i) => {
    const angle = 2 * (-Math.PI + (Math.PI / 10) * i);
    return [Math.round(42 * Math.cos(angle)), Math.round(42 * Math.sin(angle)), 3 + (i % 3)];
  });

  // outer = false : uniquement ce qui correspond au vrai jeu (île centrale,
  // piliers, portail de sortie, vide), sans les îles extérieures inventées.
  function end(x, z, seed, outer = true) {
    const d = Math.sqrt(x * x + z * z);
    if (d < 4) return END.bedrock;
    for (const [px, pz, r] of PILLARS) {
      if ((x - px) * (x - px) + (z - pz) * (z - pz) <= r * r) return END.obsidian;
    }
    const angle = Math.atan2(z, x);
    const edge = 115 + (fbm(Math.cos(angle) * 3 + 10, Math.sin(angle) * 3 + 10, seed + 211, 3) - 0.5) * 90;
    if (d < edge) return END.stone;
    if (outer && d > 1024) {
      const falloff = Math.min(1, (d - 1024) / 400);
      const n = fbm(x / 140, z / 140, seed + 223, 4);
      if (n > 0.71 - 0.04 * falloff) {
        return fbm(x / 18, z / 18, seed + 227, 2) > 0.66 ? END.chorus : END.stone;
      }
    }
    return END.void;
  }

  const GENERATORS = { overworld, nether, end };

  // Fond neutre (par défaut) : un aplat légèrement texturé par dimension, qui ne
  // peut pas être pris pour un vrai terrain. Seule l'île centrale de l'End est
  // dessinée, car sa forme générale est la même dans tous les mondes.
  const NEUTRAL_COLORS = {
    overworld: hex('#8e9985'),
    nether: hex('#5a2b2b'),
  };
  const NEUTRAL = {
    overworld: () => NEUTRAL_COLORS.overworld,
    nether: () => NEUTRAL_COLORS.nether,
    end: (x, z, seed) => end(x, z, seed, false),
  };

  const TerrainLayer = L.GridLayer.extend({
    options: {
      dimension: 'overworld',
      style: 'neutral', // 'neutral' ou 'generated' (fond décoratif fictif)
      seed: 0,
      samples: 128,
      minZoom: -8,
      maxZoom: 8,
    },

    setSeed(seed) {
      this.options.seed = seed;
      this.redraw();
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

      const neutral = this.options.style !== 'generated';
      const generate = (neutral ? NEUTRAL : GENERATORS)[this.options.dimension];
      // Texture : variation de teinte par carré de 4 blocs, plus discrète en neutre.
      const [shadeBase, shadeAmp] = neutral ? [0.97, 0.05] : [0.93, 0.1];
      const seed = this.options.seed;
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
          const c = generate(x, z, seed);
          // Légère variation pour donner du relief.
          const shade = shadeBase + shadeAmp * hash2(x >> 2, z >> 2, seed + 7);
          const k = (j * n + i) * 4;
          data[k] = c[0] * shade;
          data[k + 1] = c[1] * shade;
          data[k + 2] = c[2] * shade;
          data[k + 3] = 255;
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

      const drawLines = (spacing, style, width) => {
        if (spacing * scale < 6) return;
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
    background: {
      neutral: { overworld: '#8e9985', nether: '#5a2b2b', end: '#0c0918' },
      generated: { overworld: '#2f52b0', nether: '#8a3030', end: '#0c0918' },
    },
  };
})(window);
