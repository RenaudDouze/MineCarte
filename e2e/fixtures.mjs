// Page isolée du réseau : les icônes d'items (jsDelivr) sont servies par un
// faux manifeste, et le worker de synchronisation est le vrai code
// (worker/src/index.js) branché sur un KV en mémoire partagé par le test.
import { test as base, expect } from '@playwright/test';
import { createServer } from '../tests/helpers/server.js';

export const SYNC_URL = 'https://sync.test';
const CDN = 'https://cdn.jsdelivr.net/npm/minecraft-textures@26.3.0/dist/textures';
// PNG 1×1 rouge.
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function isolate(page, server) {
  await page.route(`${CDN}/manifest/**`, (route) => route.fulfill({
    json: { items: [{ id: 'minecraft:diamond', readable: 'Diamond', texture: 'item/diamond.png' }] },
  }));
  await page.route(`${CDN}/assets/**`, (route) => route.fulfill({ contentType: 'image/png', body: PNG_1PX }));
  await page.route(`${SYNC_URL}/**`, async (route) => {
    const req = route.request();
    const res = await server.fetch(req.url(), {
      method: req.method(),
      headers: req.headers(),
      body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer(),
    });
    await route.fulfill({
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: Buffer.from(await res.arrayBuffer()),
    });
  });
}

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => { await use(createServer()); },
  page: async ({ page, server }, use) => {
    await isolate(page, server);
    await use(page);
  },
  // Deuxième appareil : autre contexte (stockage séparé), même worker.
  otherPage: async ({ browser, server }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await isolate(page, server);
    await use(page);
    await context.close();
  },
});

// Active la synchronisation (équivalent de SYNC_WORKER_URL au build).
export async function enableSync(page) {
  await page.addInitScript((url) => { window.MINECARTE_CONFIG = { syncUrl: url }; }, SYNC_URL);
}

export { expect };
