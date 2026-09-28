/*
 * Fond de carte des trois dimensions et grille (blocs / chunks / régions),
 * sous forme de GridLayer Leaflet.
 *
 * Le fond est volontairement neutre, pour ne pas être pris pour le vrai terrain :
 * un aplat légèrement texturé par dimension. Seule l'île centrale de l'End
 * (avec ses piliers et le portail de sortie) est dessinée, car elle est la même
 * dans tous les mondes.
 *
 * Convention de coordonnées (identique à Minecraft) :
 *   X croît vers l'est, Z croît vers le sud.
 * Avec L.CRS.Simple : lng = X, lat = -Z. Au zoom 0, 1 pixel = 1 bloc.
 */
(function (global) {
  'use strict';

  const { fbm, hash2 } = global.Noise;

  // Graine fixe : elle ne sert qu'à la texture et au contour de l'île de l'End.
  const SEED = global.Noise.seedFrom('minecarte');

  function hex(color) {
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const COLORS = {
    overworld: '#8e9985',
    nether: '#5a2b2b',
    end: '#0c0918',
  };

  const END = {
    void: hex(COLORS.end),
    stone: hex('#dcdca2'),
    obsidian: hex('#1b1128'),
    bedrock: hex('#3c3c3c'),
  };

  // Dix piliers d'obsidienne répartis sur un cercle de 42 blocs.
  const PILLARS = Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i;
    return [Math.round(42 * Math.cos(angle)), Math.round(42 * Math.sin(angle)), 3 + (i % 3)];
  });

  // Rayon de l'île centrale selon l'angle : 115 blocs ± 45, en blocs entiers.
  function islandRadius(angle) {
    return Math.round(115 + (fbm(Math.cos(angle) * 3 + 10, Math.sin(angle) * 3 + 10, SEED + 211, 3) - 0.5) * 90);
  }

  // Distances comparées au carré, en entiers : le bord est exact.
  function end(x, z) {
    const d2 = x * x + z * z;
    if (d2 < 16) return END.bedrock;
    for (const [px, pz, r] of PILLARS) {
      if ((x - px) * (x - px) + (z - pz) * (z - pz) <= r * r) return END.obsidian;
    }
    const radius = islandRadius(Math.atan2(z, x));
    return d2 < radius * radius ? END.stone : END.void;
  }

  const GENERATORS = {
    overworld: ((c) => () => c)(hex(COLORS.overworld)),
    nether: ((c) => () => c)(hex(COLORS.nether)),
    end,
  };

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
          // Texture discrète : légère variation de teinte par carré de 4 blocs.
          const shade = 0.97 + 0.05 * hash2(x >> 2, z >> 2, SEED + 7);
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
    // Couleur du conteneur pendant le chargement des tuiles.
    background: COLORS,
  };
})(window);
