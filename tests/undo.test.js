import { test, expect, beforeAll } from 'vitest';

let UndoStack;
beforeAll(async () => {
  await import('../js/undo.js');
  UndoStack = window.UndoStack;
});

test('état initial : rien à annuler ni à rétablir', () => {
  const u = new UndoStack('a');
  expect(u.current).toBe('a');
  expect(u.canUndo).toBe(false);
  expect(u.canRedo).toBe(false);
  expect(u.undo()).toBeNull();
  expect(u.redo()).toBeNull();
  expect(u.current).toBe('a');
});

test('annuler puis rétablir, dans l’ordre', () => {
  const u = new UndoStack('a');
  u.record('b');
  u.record('c');
  expect(u.canUndo).toBe(true);
  expect(u.undo()).toBe('b');
  expect(u.canRedo).toBe(true);
  expect(u.undo()).toBe('a');
  expect(u.canUndo).toBe(false);
  expect(u.undo()).toBeNull();
  expect(u.redo()).toBe('b');
  expect(u.redo()).toBe('c');
  expect(u.canRedo).toBe(false);
  expect(u.redo()).toBeNull();
  expect(u.current).toBe('c');
  // Ce qui a été rétabli peut de nouveau être annulé.
  expect(u.undo()).toBe('b');
  expect(u.undo()).toBe('a');
});

test('une nouvelle modification efface ce qui pouvait être rétabli', () => {
  const u = new UndoStack('a');
  u.record('b');
  u.undo();
  u.record('x');
  expect(u.canRedo).toBe(false);
  expect(u.undo()).toBe('a');
});

test('état identique : rien n’est empilé', () => {
  const u = new UndoStack('a');
  u.record('a');
  expect(u.canUndo).toBe(false);
  u.record('b');
  u.record('b');
  expect(u.undo()).toBe('a');
  expect(u.canUndo).toBe(false);
});

test('au plus 50 états annulables, les plus anciens oubliés', () => {
  expect(UndoStack.LIMIT).toBe(50);
  const u = new UndoStack('s0');
  for (let i = 1; i <= 52; i++) u.record(`s${i}`);
  const undone = [];
  while (u.canUndo) undone.push(u.undo());
  expect(undone).toHaveLength(50);
  expect(undone.at(-1)).toBe('s2');
});

test('état venu d’ailleurs : piles vidées', () => {
  const u = new UndoStack('a');
  u.record('b');
  u.record('c');
  u.undo();
  u.reset('z');
  expect(u.current).toBe('z');
  expect(u.canUndo).toBe(false);
  expect(u.canRedo).toBe(false);
});
