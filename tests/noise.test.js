import { describe, test, expect, beforeAll } from 'vitest';

let N;
beforeAll(async () => {
  await import('../js/noise.js');
  N = window.Noise;
});

// Valeurs de référence : le bruit doit rester strictement identique d'une
// version à l'autre (texture du fond, contour de l'île de l'End).
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

describe('value', () => {
  test('valeurs de référence', () => {
    expect(N.value(0, 0, 5)).toBe(0.9270416311919689);
    expect(N.value(0.5, 0.5, 5)).toBe(0.7195837167673744);
    expect(N.value(1.25, -2.75, 9)).toBe(0.626796665443635);
    expect(N.value(3, 4, 1)).toBe(0.3429651875048876);
  });

  test('aux sommets entiers, égale au hash', () => {
    expect(N.value(3, 4, 1)).toBe(N.hash2(3, 4, 1));
    expect(N.value(-2, 9, 7)).toBe(N.hash2(-2, 9, 7));
  });

  test('interpolation lissée entre les sommets', () => {
    const a = N.hash2(0, 0, 3);
    const b = N.hash2(1, 0, 3);
    const c = N.hash2(0, 1, 3);
    const d = N.hash2(1, 1, 3);
    // Au milieu d'une arête, le lissage vaut 0.5.
    expect(N.value(0.5, 0, 3)).toBeCloseTo((a + b) / 2, 12);
    expect(N.value(0, 0.5, 3)).toBeCloseTo((a + c) / 2, 12);
    expect(N.value(0.5, 0.5, 3)).toBeCloseTo((a + b + c + d) / 4, 12);
    // Lissage smoothstep : t = 0.25 → 0.15625.
    expect(N.value(0.25, 0, 3)).toBeCloseTo(a + (b - a) * 0.15625, 12);
    expect(N.value(1, 0.25, 3)).toBeCloseTo(b + (d - b) * 0.15625, 12);
  });
});

describe('fbm', () => {
  test('valeurs de référence', () => {
    expect(N.fbm(0.3, 0.7, 11, 1)).toBe(0.4987858002486527);
    expect(N.fbm(0.3, 0.7, 11, 3)).toBe(0.48307126307549375);
    expect(N.fbm(-2.2, 5.9, 99, 4)).toBe(0.2859992787396867);
  });

  test('une octave égale le bruit de valeur', () => {
    expect(N.fbm(1.3, -0.4, 17, 1)).toBe(N.value(1.3, -0.4, 17));
  });

  test('deux octaves : amplitude 1/2, fréquence ×2.03, graine +1013', () => {
    const expected = (N.value(1.3, -0.4, 17) + 0.5 * N.value(1.3 * 2.03, -0.4 * 2.03, 17 + 1013)) / 1.5;
    expect(N.fbm(1.3, -0.4, 17, 2)).toBe(expected);
  });
});

describe('seedFrom', () => {
  test('nombre entier en texte : conversion 32 bits signée', () => {
    expect(N.seedFrom('42')).toBe(42);
    expect(N.seedFrom('-7')).toBe(-7);
    expect(N.seedFrom('4294967297')).toBe(1);
    expect(N.seedFrom('-4482540906154857337')).toBe(-1652855673);
    expect(N.seedFrom(7)).toBe(7);
  });

  test('texte : hachage façon Java', () => {
    expect(N.seedFrom('minecarte')).toBe(694583506);
    expect(N.seedFrom('a')).toBe(97);
    expect(N.seedFrom('ab')).toBe(3105);
    expect(N.seedFrom('12a')).toBe(48736);
    expect(N.seedFrom('a12')).toBe(94786);
    expect(N.seedFrom('-')).toBe(45);
    expect(N.seedFrom('1-2')).toBe(48534);
  });

  test('vide ou absent : 0', () => {
    expect(N.seedFrom('')).toBe(0);
    expect(N.seedFrom(null)).toBe(0);
    expect(N.seedFrom(undefined)).toBe(0);
  });
});
