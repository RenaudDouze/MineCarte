import { test, expect, beforeAll } from 'vitest';

let Backups;
beforeAll(async () => {
  await import('../js/backups.js');
  Backups = window.Backups;
});

// Stockage en mémoire, avec une taille maximale par valeur pour simuler un stockage plein.
function memory(max = Infinity) {
  const items = new Map();
  return {
    items,
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => {
      if (v.length > max) throw new Error('QuotaExceededError');
      items.set(k, v);
    },
    removeItem: (k) => items.delete(k),
  };
}

const DATA = (n = 1, paths = 0) => ({
  seed: 's',
  pois: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Lieu ${i}` })),
  paths: Array.from({ length: paths }, (_, i) => ({ id: `c${i}`, name: `Chemin ${i}` })),
});

function setup(storage = memory()) {
  const clock = { t: 1000000 };
  const b = new Backups(storage, () => clock.t);
  return { b, clock, storage };
}

test('réglages', () => {
  expect(Backups.KEY).toBe('minecarte:backups');
  expect(Backups.LIMIT).toBe(10);
  expect(Backups.INTERVAL).toBe(10 * 60 * 1000);
  expect(Backups.MAX_CHARS).toBe(1500000);
});

test('liste vide, illisible ou qui n’est pas un tableau', () => {
  const { b, storage } = setup();
  expect(b.list()).toEqual([]);
  storage.setItem(Backups.KEY, '{pas du json');
  expect(b.list()).toEqual([]);
  storage.setItem(Backups.KEY, '{"time":1}');
  expect(b.list()).toEqual([]);
  storage.setItem(Backups.KEY, '[{"time":1,"data":{}}]');
  expect(b.list()).toEqual([{ time: 1, data: {} }]);
});

test('première copie, enregistrée sous la clé de l’historique', () => {
  const { b, storage } = setup();
  expect(b.save(DATA())).toBe(true);
  expect(JSON.parse(storage.getItem('minecarte:backups'))).toEqual([{ time: 1000000, data: DATA() }]);
  expect(b.list()).toEqual([{ time: 1000000, data: DATA() }]);
});

test('pas de copie de données vides, mais bien d’un seul lieu ou d’un seul chemin', () => {
  const { b } = setup();
  expect(b.save(DATA(0, 0), true)).toBe(false);
  expect(b.list()).toEqual([]);
  expect(b.save(DATA(0, 1), true)).toBe(true);
  expect(b.save(DATA(1, 0), true)).toBe(true);
  expect(b.list().map((e) => e.data)).toEqual([DATA(1, 0), DATA(0, 1)]);
});

test('pas de copie identique à la dernière, même forcée', () => {
  const { b, clock } = setup();
  b.save(DATA());
  clock.t += Backups.INTERVAL * 5;
  expect(b.save(DATA(), true)).toBe(false);
  expect(b.save(DATA())).toBe(false);
  expect(b.list()).toHaveLength(1);
});

test('une copie automatique au plus toutes les 10 minutes ; forcée, tout de suite', () => {
  const { b, clock } = setup();
  b.save(DATA(1));
  clock.t += Backups.INTERVAL - 1;
  expect(b.save(DATA(2))).toBe(false);
  expect(b.save(DATA(2), true)).toBe(true);
  expect(b.list().map((e) => [e.time, e.data.pois.length])).toEqual([[1599999, 2], [1000000, 1]]);
  clock.t += Backups.INTERVAL;
  expect(b.save(DATA(3))).toBe(true);
  expect(b.list().map((e) => [e.time, e.data.pois.length])).toEqual([[2199999, 3], [1599999, 2], [1000000, 1]]);
});

test('les 10 copies les plus récentes sont gardées', () => {
  const { b, clock } = setup();
  for (let i = 1; i <= 12; i++) {
    b.save(DATA(i));
    clock.t += Backups.INTERVAL;
  }
  expect(b.list().map((e) => e.data.pois.length)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
});

test('taille plafonnée : les copies les plus anciennes sont sacrifiées', () => {
  const { b, storage } = setup();
  const entry = (time, size) => ({ time, data: { s: 'x'.repeat(size) } });
  const overhead = JSON.stringify([entry(1, 0)]).length;
  b.write([entry(1, Backups.MAX_CHARS - overhead)]);
  expect(JSON.parse(storage.getItem(Backups.KEY))[0].time).toBe(1);
  b.write([entry(2, 10), entry(3, Backups.MAX_CHARS - overhead)]);
  expect(JSON.parse(storage.getItem(Backups.KEY))).toEqual([entry(2, 10)]);
  b.write([entry(4, Backups.MAX_CHARS - overhead + 1)]);
  expect(storage.getItem(Backups.KEY)).toBeNull();
});

test('stockage plein : les copies les plus anciennes sont sacrifiées, puis tout l’historique', () => {
  const storage = memory(250);
  const { b, clock } = setup(storage);
  for (let i = 1; i <= 4; i++) {
    b.save(DATA(i));
    clock.t += Backups.INTERVAL;
  }
  const kept = b.list().map((e) => e.data.pois.length);
  expect(kept[0]).toBe(4);
  expect(kept.length).toBeLessThan(4);
  expect(storage.getItem(Backups.KEY).length).toBeLessThanOrEqual(250);
  // Une copie qui ne tient pas seule : l'historique est vidé plutôt que laissé périmé.
  expect(b.save(DATA(20))).toBe(true);
  expect(storage.getItem(Backups.KEY)).toBeNull();
  expect(b.list()).toEqual([]);
});

test('résumé : nombre de lieux et de chemins', () => {
  expect(Backups.summary(DATA(0, 0))).toBe('0 lieu · 0 chemin');
  expect(Backups.summary(DATA(1, 2))).toBe('1 lieu · 2 chemins');
  expect(Backups.summary(DATA(2, 1))).toBe('2 lieux · 1 chemin');
});
