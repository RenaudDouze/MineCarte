import { test, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<p id="app-version"></p>';
  delete window.MINECARTE_CONFIG;
});

test('affiche la version générée par le build', async () => {
  window.MINECARTE_CONFIG = { version: 'v1.2.3' };
  await import('../js/version.js');
  expect(document.getElementById('app-version').textContent).toBe('Version v1.2.3');
});

test('sans version (développement) : « dev »', async () => {
  window.MINECARTE_CONFIG = { syncUrl: '' };
  await import('../js/version.js');
  expect(document.getElementById('app-version').textContent).toBe('Version dev');
});

test('sans configuration du tout : « dev »', async () => {
  await import('../js/version.js');
  expect(document.getElementById('app-version').textContent).toBe('Version dev');
});

test("sans élément d'affichage : ne fait rien", async () => {
  document.body.innerHTML = '';
  window.MINECARTE_CONFIG = { version: 'v1.2.3' };
  await expect(import('../js/version.js')).resolves.toBeDefined();
  expect(document.body.textContent).toBe('');
});
