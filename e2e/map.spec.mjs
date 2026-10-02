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
  await page.locator('#global-search').fill('120 -40');
  await page.locator('#global-search').press('Enter');
  await expect(page.locator('.leaflet-popup-content .popup-title')).toHaveText('📌 X 120 · Z -40');
  await page.getByRole('button', { name: /Commencer un chemin/ }).click();
  await expect(page.locator('#mode-banner')).toBeVisible();

  const map = page.locator('#map');
  await map.click({ position: { x: 200, y: 150 } });
  await map.click({ position: { x: 320, y: 260 } });
  await expect(page.locator('#mode-text')).toContainText('· 3 points');
  await page.locator('#mode-undo').click();
  await expect(page.locator('#mode-text')).toContainText('· 2 points');
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
  await page.getByRole('button', { name: '+ Lieu' }).click();
  await page.locator('#poi-form [name="label"]').fill('À exporter');
  await page.locator('#poi-form button[type="submit"]').click();

  await page.locator('#settings-btn').click();
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = await (await download).path();
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(file, 'utf8'));
  expect(data.pois.map((p) => p.name)).toEqual(['À exporter']);

  page.on('dialog', (d) => d.accept());
  await page.locator('#reset').click();
  await expect(page.locator('#poi-list')).toContainText('Aucun lieu');
  await page.locator('#import-file').setInputFiles({ name: 'carte.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#toast')).toHaveText('1 lieu(x) et 0 chemin(s) importés.');
  await expect(page.locator('#poi-list .item-name')).toHaveText(['À exporter']);
});

test('bouton « tout afficher » : cadre les lieux et chemins de la dimension', async ({ page }) => {
  await page.goto('/#overworld/0/0/2');
  await page.evaluate(() => {
    const { store } = window.MineCarte;
    store.savePoi({ name: 'Nord', dim: 'overworld', x: -900, z: -700 });
    store.savePoi({ name: 'Sud', dim: 'overworld', x: 1200, z: 800 });
  });
  await expect(page.locator('.poi-label', { hasText: 'Nord' })).not.toBeInViewport();
  await page.getByRole('button', { name: 'Afficher tous les lieux et chemins' }).click();
  await expect(page.locator('.poi-label', { hasText: 'Nord' })).toBeInViewport();
  await expect(page.locator('.poi-label', { hasText: 'Sud' })).toBeInViewport();
});

test('recherche globale : un lieu d’une autre dimension', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.MineCarte.store.savePoi({ name: 'Forteresse', dim: 'nether', x: 40, z: -12 });
  });
  await page.keyboard.press('/');
  await page.keyboard.type('forter');
  await expect(page.locator('#search-results .item-name')).toHaveText(['Forteresse']);
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-dim', 'nether');
  await expect(page.locator('.leaflet-popup-content .popup-title')).toHaveText('Forteresse');
});

test('chemin saisi par coordonnées, puis corrigé', async ({ page }) => {
  await page.goto('/#overworld/0/0/0');
  await page.locator('.tab[data-tab="paths"]').click();
  await page.getByRole('button', { name: 'Par coordonnées' }).click();
  const points = page.locator('#path-form [name="points"]');
  await expect(points).toBeFocused();
  await points.fill('0 0\n100 64 0\nnulle part');
  await expect(page.locator('#path-info')).toHaveText('Ligne 3 : « nulle part » n\'est pas une coordonnée (X Z ou X Y Z).');
  await page.locator('#path-form button[type="submit"]').click();
  await expect(page.locator('#path-dialog')).toBeVisible();
  await points.fill('0 0\n100 64 0\n100 -50');
  await expect(page.locator('#path-info')).toHaveText('Overworld · 150 blocs · 3 points');
  await page.locator('#path-form [name="label"]').fill('Voie ferrée');
  await page.locator('#path-form button[type="submit"]').click();
  await expect(page.locator('#path-dialog')).toBeHidden();
  await expect(page.locator('#path-list .item-name')).toHaveText(['Voie ferrée']);
  await expect(page.locator('.leaflet-popup-content .popup-sub').first()).toHaveText('150 blocs · 3 points');

  await page.locator('.leaflet-popup-content').getByRole('button', { name: 'Modifier' }).click();
  await expect(points).toHaveValue('0 0\n100 0\n100 -50');
  await points.fill('0 0\n100 0');
  await page.locator('#path-form button[type="submit"]').click();
  await expect(page.locator('#path-list .item-sub')).toContainText('100 blocs');
});

test('zone : polygone tracé à la souris, aire affichée', async ({ page }) => {
  await page.goto('/#overworld/0/0/0');
  await page.locator('.tab[data-tab="zones"]').click();
  await page.getByRole('button', { name: '+ Tracer une zone' }).click();
  const map = page.locator('#map');
  const box = await map.boundingBox();
  const at = (dx, dz) => ({ position: { x: box.width / 2 + dx, y: box.height / 2 + dz } });
  await map.click(at(0, 0));
  await map.click(at(100, 0));
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toHaveText('Une zone doit avoir au moins 3 points.');
  await map.click(at(100, 50));
  await map.click(at(0, 50));
  await page.keyboard.press('Enter');
  await expect(page.locator('#path-form [name="closed"]')).toBeChecked();
  await page.locator('#path-form [name="label"]').fill('Champ de blé');
  await page.locator('#path-form button[type="submit"]').click();
  await expect(page.locator('#zone-list .item-name')).toHaveText(['Champ de blé']);
  await expect(page.locator('#zone-list .item-sub')).toHaveText(/^5.000 blocs² · périmètre 300 blocs · 4 points$/);
  await expect(page.locator('#map path.leaflet-interactive[fill-opacity="0.2"]')).toHaveCount(1);
  // Nom de la zone affiché sur la carte, au centre ; masquable dans les réglages.
  await expect(page.locator('.zone-label')).toHaveText('Champ de blé');
  await expect(page.locator('.zone-label span')).toBeInViewport();
  await page.locator('.tab[data-tab="paths"]').click();
  await expect(page.locator('#path-list .empty')).toBeVisible();
  await page.locator('#settings-btn').click();
  await page.getByLabel('Noms des zones').uncheck();
  await expect(page.locator('.zone-label')).toHaveCount(0);
});
