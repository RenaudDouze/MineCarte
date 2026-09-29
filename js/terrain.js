/*
 * Fond de carte des trois dimensions et grille (blocs / chunks / régions),
 * sous forme de GridLayer Leaflet.
 *
 * Le fond est un aplat légèrement texturé, identique pour les trois dimensions
 * à la couleur près (herbe pour l'Overworld, netherrack pour le Nether, violet
 * pour l'End) : il ne peut pas être pris pour le vrai terrain.
 *
 * Convention de coordonnées (identique à Minecraft) :
 *   X croît vers l'est, Z croît vers le sud.
 * Avec L.CRS.Simple : lng = X, lat = -Z. Au zoom 0, 1 pixel = 1 bloc.
 */
(function (global) {
  'use strict';

  const { hash2 } = global.Noise;

  // Graine fixe de la texture (hachage de « minecarte », gardé pour que la
  // texture reste la même qu'avant).
  const SEED = 694583506;

  const COLORS = {
    overworld: '#6f9a53',
    nether: '#7d2f2b',
    end: '#6e5488',
  };

  function hex(color) {
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

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

      const c = hex(COLORS[this.options.dimension]);
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
