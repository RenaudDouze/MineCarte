import { describe, test, expect, beforeAll } from 'vitest';

let N;
beforeAll(async () => {
  await import('../js/noise.js');
  N = window.Noise;
});

// Valeurs de référence : le hachage doit rester strictement identique d'une
// version à l'autre (texture du fond).
describe('hash2', () => {
  test('valeurs de référence', () => {
    expect(N.hash2(0, 0, 0)).toBe(0);
    expect(N.hash2(1, 2, 3)).toBe(0.6394013063982129);
    expect(N.hash2(-5, 7, -11)).toBe(0.7593287217896432);
    expect(N.hash2(123456, -654321, 42)).toBe(0.4743072313722223);
  });

  test('dans [0, 1[ et déterministe', () => {
    for (let i = -50; i < 50; i++) {
      const v = N.hash2(i, i * 7, i * 13);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(N.hash2(i, i * 7, i * 13)).toBe(v);
    }
  });
});
