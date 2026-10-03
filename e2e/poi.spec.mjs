import { test, expect } from './fixtures.mjs';

test('créer un POI au clic droit, le retrouver après rechargement, le supprimer', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-dim', 'overworld');
  await expect(page.locator('#poi-list')).toContainText('Aucun lieu');

  await page.locator('#map').click({ button: 'right', position: { x: 300, y: 200 } });
  await expect(page.locator('#context-menu')).toBeVisible();
  await page.getByRole('button', { name: /Ajouter un lieu ici/ }).click();
  await expect(page.locator('#poi-dialog')).toBeVisible();
  await page.locator('#poi-form [name="label"]').fill('Base principale');
  await page.locator('#poi-form [name="y"]').fill('72');
  await page.locator('#poi-form button[type="submit"]').click();

  await expect(page.locator('#poi-dialog')).toBeHidden();
  await expect(page.locator('.poi-label', { hasText: 'Base principale' })).toBeVisible();
  await expect(page.locator('.leaflet-popup-content .popup-title')).toHaveText('Base principale');
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Base principale']);

  await page.reload();
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Base principale']);
  await page.locator('#poi-list .item').click();
  await expect(page.locator('.leaflet-popup-content .popup-coords')).toContainText('Y 72');

  page.once('dialog', (d) => d.accept());
  await page.locator('.leaflet-popup-content').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.locator('.poi-label')).toHaveCount(0);
  await expect(page.locator('#poi-list')).toContainText('Aucun lieu');
});

test('POI liés : navigation vers un autre POI, même dans une autre dimension', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ Lieu' }).click();
  await page.locator('#poi-form [name="label"]').fill('Portail');
  await page.locator('#poi-form button[type="submit"]').click();

  await page.locator('.leaflet-popup-content').getByRole('button', { name: /Portail Nether/ }).click();
  await expect(page.locator('#poi-form [name="dim"]')).toHaveValue('nether');
  await expect(page.locator('#poi-links input:checked')).toHaveCount(1);
  await page.locator('#poi-form button[type="submit"]').click();

  await expect(page.locator('body')).toHaveAttribute('data-dim', 'nether');
  // L'ancienne popup peut rester le temps de son animation de fermeture.
  const popup = (title) => page.locator('.leaflet-popup-content').filter({ has: page.locator('.popup-title', { hasText: new RegExp(`^${title}$`) }) });
  await expect(popup('Portail \\(Nether\\)')).toBeVisible();
  await popup('Portail \\(Nether\\)').locator('.link-btn').click();
  await expect(page.locator('body')).toHaveAttribute('data-dim', 'overworld');
  await expect(popup('Portail').last()).toBeVisible();
  await expect(popup('Portail')).toHaveCount(1);
});

test('icône d’item choisie dans la liste', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ Lieu' }).click();
  await page.locator('#poi-form [name="label"]').fill('Mine');
  await page.locator('#icon-choose').click();
  await page.locator('#icon-search').fill('diam');
  await page.locator('#icon-grid .icon-cell').click();
  await expect(page.locator('#icon-current')).toContainText('Diamond');
  await page.locator('#poi-form button[type="submit"]').click();
  await expect(page.locator('.poi-pin-item img')).toBeVisible();
});

test('catégories : choix dans le dialogue et filtre', async ({ page }) => {
  await page.goto('/');
  for (const [name, category] of [['Maison', 'base'], ['Champ de blé', 'farm']]) {
    await page.getByRole('button', { name: '+ Lieu' }).click();
    await page.locator('#poi-form [name="label"]').fill(name);
    await page.locator('#poi-form [name="category"]').selectOption(category);
    await page.locator('#poi-form button[type="submit"]').click();
  }
  await expect(page.locator('#poi-list .item-sub').first()).toContainText('🌾 Ferme');
  await page.locator('.cat-chip', { hasText: 'Ferme' }).click();
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Maison']);
  await expect(page.locator('.poi-label', { hasText: 'Champ de blé' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Maison']);
  await page.locator('.cat-chip', { hasText: 'Ferme' }).click();
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Champ de blé', 'Maison']);
  // Ctrl+clic : seule cette catégorie, puis tout.
  await page.locator('.cat-chip', { hasText: 'Base' }).click({ modifiers: ['Control'] });
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Maison']);
  await page.locator('.cat-chip', { hasText: 'Base' }).click({ modifiers: ['Control'] });
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Champ de blé', 'Maison']);
});

test('annuler / rétablir une suppression', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ Lieu' }).click();
  await page.locator('#poi-form [name="label"]').fill('Temple');
  await page.locator('#poi-form button[type="submit"]').click();
  page.once('dialog', (d) => d.accept());
  await page.locator('.leaflet-popup-content').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.locator('#poi-list .item-name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Temple']);
  await page.keyboard.press('Control+y');
  await expect(page.locator('#poi-list .item-name')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Temple']);
});

test('historique local : restaurer un état après rechargement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ Lieu' }).click();
  await page.locator('#poi-form [name="label"]').fill('Premier');
  await page.locator('#poi-form button[type="submit"]').click();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: 'Tout effacer' }).click();
  await expect(page.locator('.poi-label')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Réglages' }).click();
  await expect(page.locator('#backup-list .item-sub')).toHaveText(['1 lieu · 0 chemin']);
  await page.locator('#backup-list').getByRole('button', { name: 'Restaurer' }).click();
  await expect(page.locator('.poi-label', { hasText: 'Premier' })).toBeVisible();
  await expect(page.locator('#toast')).toContainText('restauré');
});

test('saisie gardée après une fermeture involontaire, croix pour vider un champ', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ Lieu' }).click();
  const label = page.locator('#poi-form [name="label"]');
  await label.fill('Temple de la jungle');
  await page.keyboard.press('Escape');
  await expect(page.locator('#poi-dialog')).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: '+ Lieu' }).click();
  await expect(label).toHaveValue('Temple de la jungle');
  await expect(page.locator('#toast')).toHaveText('Saisie non enregistrée restaurée.');

  // La croix n'apparaît que sur un champ rempli, et le vide.
  const clear = page.locator('#poi-form .clearable:has([name="label"]) .clear-btn');
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(label).toHaveValue('');
  await expect(label).toBeFocused();
  await expect(clear).toBeHidden();
  await page.locator('#poi-dialog').getByRole('button', { name: 'Annuler' }).click();
  expect(await page.evaluate(() => localStorage.getItem('minecarte:drafts'))).toBeNull();
});
