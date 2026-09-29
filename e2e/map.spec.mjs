import { test, expect } from './fixtures.mjs';

test('dimensions : bouton, ancre d’URL et coordonnées converties', async ({ page }) => {
  await page.goto('/#overworld/800/-160/0');
  await expect(page.locator('#coords')).toContainText('Nether ≈ 100, -20');
  await page.getByRole('button', { name: /Nether/ }).first().click();
  await expect(page.locator('body')).toHaveAttribute('data-dim', 'nether');
  await expect(page).toHaveURL(/#nether\//);
  await page.goto('/#end/0/0/1');
  await expect(page.locator('body')).toHaveAttribute('data-dim', 'end');
  await expect(page.locator('.leaflet-tile-container canvas').first()).toBeVisible();
});

test('recherche de coordonnées puis création d’un chemin', async ({ page }) => {
  await page.goto('/');
  await page.locator('#goto [name="x"]').fill('120');
  await page.locator('#goto [name="z"]').fill('-40');
  await page.locator('#goto button[type="submit"]').click();
  await expect(page.locator('.leaflet-popup-content .popup-title')).toHaveText('📌 X 120 · Z -40');
  await page.getByRole('button', { name: /Commencer un chemin/ }).click();
  await expect(page.locator('#mode-banner')).toBeVisible();

  const map = page.locator('#map');
  await map.click({ position: { x: 200, y: 150 } });
  await map.click({ position: { x: 320, y: 260 } });
  await expect(page.locator('#mode-text')).toContainText('3 point(s)');
  await page.locator('#mode-undo').click();
  await expect(page.locator('#mode-text')).toContainText('2 point(s)');
  await page.locator('#mode-finish').click();

  await expect(page.locator('#path-dialog')).toBeVisible();
  await page.locator('#path-form [name="label"]').fill('Route du nord');
  await page.locator('#path-form [name="weight"]').fill('8');
  await page.locator('#path-form button[type="submit"]').click();
  await expect(page.locator('#path-list .item-name')).toHaveText(['Route du nord']);
  await expect(page.locator('#path-list .item-sub')).toContainText('2 points');
  // Le tracé et son ombre, dessinés par Leaflet.
  await expect(page.locator('.leaflet-path-pane path')).toHaveCount(2);
  expect(await page.evaluate(() => window.MineCarte.store.data.paths[0].weight)).toBe(8);
});

test('export puis import JSON', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ POI' }).click();
  await page.locator('#poi-form [name="label"]').fill('À exporter');
  await page.locator('#poi-form button[type="submit"]').click();

  await page.locator('.tab[data-tab="settings"]').click();
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = await (await download).path();
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(file, 'utf8'));
  expect(data.pois.map((p) => p.name)).toEqual(['À exporter']);

  page.on('dialog', (d) => d.accept());
  await page.locator('#reset').click();
  await expect(page.locator('#poi-list')).toContainText('Aucun POI');
  await page.locator('#import-file').setInputFiles({ name: 'carte.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#toast')).toHaveText('1 POI et 0 chemins importés.');
  await expect(page.locator('#poi-list .item-name')).toHaveText(['À exporter']);
});
