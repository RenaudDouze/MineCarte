/*
 * Bruit de valeur 2D déterministe (seedé) + fBm.
 * Sert à la texture du fond et au contour de l'île centrale de l'End.
 */
(function (global) {
  'use strict';

  function hash2(ix, iz, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function value(x, z, seed) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const u = smooth(x - ix);
    const v = smooth(z - iz);
    const a = hash2(ix, iz, seed);
    const b = hash2(ix + 1, iz, seed);
    const c = hash2(ix, iz + 1, seed);
    const d = hash2(ix + 1, iz + 1, seed);
    const top = a + (b - a) * u;
    const bottom = c + (d - c) * u;
    return top + (bottom - top) * v;
  }

  // Somme de plusieurs octaves, normalisée dans [0, 1].
  function fbm(x, z, seed, octaves) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * value(x * freq, z * freq, seed + i * 1013);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }

  // Transforme une chaîne (ou un nombre) en graine entière 32 bits.
  function seedFrom(input) {
    const str = String(input == null ? '' : input);
    if (/^-?\d+$/.test(str)) return Number(BigInt.asIntN(32, BigInt(str)));
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h;
  }

  global.Noise = { hash2, value, fbm, seedFrom };
})(window);
