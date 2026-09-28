import { test, expect, vi } from 'vitest';

async function load(preset) {
  vi.resetModules();
  if (preset === undefined) delete window.MINECARTE_CONFIG;
  else window.MINECARTE_CONFIG = preset;
  await import('../js/config.js');
  return window.MINECARTE_CONFIG;
}

test('par défaut : synchronisation désactivée', async () => {
  expect(await load()).toEqual({ syncUrl: '' });
});

test('une configuration posée avant le chargement est conservée', async () => {
  expect(await load({ syncUrl: 'https://sync.example' })).toEqual({ syncUrl: 'https://sync.example' });
  expect(await load({ autre: 1 })).toEqual({ syncUrl: '', autre: 1 });
});
