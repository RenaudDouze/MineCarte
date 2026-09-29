/*
 * Hachage 2D déterministe (seedé) : sert à la texture du fond.
 */
(function (global) {
  'use strict';

  function hash2(ix, iz, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  global.Noise = { hash2 };
})(window);
