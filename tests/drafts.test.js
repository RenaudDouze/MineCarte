import { test, expect, beforeAll } from 'vitest';

let Drafts;
beforeAll(async () => {
  await import('../js/drafts.js');
  Drafts = window.Drafts;
});

function memory() {
  const items = new Map();
  return {
    items,
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => items.set(k, v),
    removeItem: (k) => items.delete(k),
  };
}

const INITIAL = { label: '', x: '10', links: [], closed: false };

test('clé de stockage', () => {
  expect(Drafts.KEY).toBe('minecarte:drafts');
});

test('changes : seulement les champs modifiés, tableaux comparés par valeur', () => {
  expect(Drafts.changes(INITIAL, { ...INITIAL })).toEqual({});
  expect(Drafts.changes(INITIAL, { ...INITIAL, label: 'Base', links: ['a'], closed: true }))
    .toEqual({ label: 'Base', links: ['a'], closed: true });
  expect(Drafts.changes(INITIAL, { ...INITIAL, links: [] })).toEqual({});
  expect(Drafts.changes({ x: '1' }, { x: '1', y: '2' })).toEqual({ y: '2' });
});

test('enregistrer puis restaurer le même élément, par-dessus ses valeurs du moment', () => {
  const storage = memory();
  const d = new Drafts(storage);
  d.save('poi', 'new', INITIAL, { ...INITIAL, label: 'Base' });
  expect(JSON.parse(storage.getItem('minecarte:drafts'))).toEqual({ poi: { target: 'new', changes: { label: 'Base' } } });
  expect(d.restore('poi', 'new', { ...INITIAL, x: '99' })).toEqual({ ...INITIAL, x: '99', label: 'Base' });
  // Autre élément ou autre formulaire : rien.
  expect(d.restore('poi', 'abc', INITIAL)).toBeNull();
  expect(d.restore('path', 'new', INITIAL)).toBeNull();
});

test('un brouillon par formulaire, le dernier remplace le précédent', () => {
  const d = new Drafts(memory());
  d.save('poi', 'a', INITIAL, { ...INITIAL, label: 'A' });
  d.save('path', 'new', { points: '' }, { points: '1 2' });
  d.save('poi', 'b', INITIAL, { ...INITIAL, label: 'B' });
  expect(d.all()).toEqual({ poi: { target: 'b', changes: { label: 'B' } }, path: { target: 'new', changes: { points: '1 2' } } });
  expect(d.restore('poi', 'a', INITIAL)).toBeNull();
});

test('revenir aux valeurs de départ efface le brouillon ; clear aussi', () => {
  const storage = memory();
  const d = new Drafts(storage);
  d.save('poi', 'new', INITIAL, { ...INITIAL, label: 'X' });
  d.save('path', 'new', { points: '' }, { points: '1 2' });
  d.save('poi', 'new', INITIAL, { ...INITIAL });
  expect(d.all()).toEqual({ path: { target: 'new', changes: { points: '1 2' } } });
  d.clear('path');
  expect(storage.getItem('minecarte:drafts')).toBeNull();
  d.clear('poi');
  expect(storage.getItem('minecarte:drafts')).toBeNull();
});

test('stockage illisible ou inattendu : aucun brouillon', () => {
  const storage = memory();
  const d = new Drafts(storage);
  for (const raw of ['{oups', '[1]', '"texte"', 'null']) {
    storage.setItem('minecarte:drafts', raw);
    expect([raw, d.all()]).toEqual([raw, {}]);
  }
  storage.setItem('minecarte:drafts', '{"poi":{"target":"new","changes":{"label":"Z"}}}');
  expect(d.restore('poi', 'new', INITIAL).label).toBe('Z');
});

test('stockage indisponible : ni erreur ni brouillon', () => {
  const broken = {
    getItem: () => { throw new Error('bloqué'); },
    setItem: () => { throw new Error('plein'); },
    removeItem: () => { throw new Error('bloqué'); },
  };
  const d = new Drafts(broken);
  expect(() => d.save('poi', 'new', INITIAL, { ...INITIAL, label: 'X' })).not.toThrow();
  expect(() => d.clear('poi')).not.toThrow();
  expect(d.restore('poi', 'new', INITIAL)).toBeNull();
});
