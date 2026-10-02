import { test, expect, enableSync } from './fixtures.mjs';

test('synchronisation par code entre deux appareils', async ({ page, otherPage }) => {
  await enableSync(page);
  await enableSync(otherPage);

  await page.goto('/');
  await page.getByRole('button', { name: '+ Lieu' }).click();
  await page.locator('#poi-form [name="label"]').fill('Village');
  await page.locator('#poi-form button[type="submit"]').click();
  await page.locator('#settings-btn').click();
  await page.locator('#sync-create').click();
  await expect(page.locator('#sync-status')).toHaveText(/Synchronisé/);
  const code = await page.locator('#sync-code').textContent();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  await otherPage.goto('/');
  await otherPage.locator('#settings-btn').click();
  await otherPage.locator('#sync-join [name="code"]').fill(code);
  await otherPage.locator('#sync-join button[type="submit"]').click();
  await expect(otherPage.locator('#toast')).toHaveText(`Appareil relié au code ${code}.`);
  await expect(otherPage.locator('#poi-list .item-name')).toHaveText(['Village']);

  // Modification sur le second appareil, reçue par le premier.
  await otherPage.locator('#settings-close').click();
  await otherPage.getByRole('button', { name: '+ Lieu' }).click();
  await otherPage.locator('#poi-form [name="label"]').fill('Ferme');
  await otherPage.locator('#poi-form button[type="submit"]').click();
  await expect(otherPage.locator('#sync-status')).toHaveText(/Synchronisé/);
  await page.locator('#sync-now').click();
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Ferme', 'Village']);
});

test('lien en lecture seule : consultation sans modification, puis révocation', async ({ page, otherPage }) => {
  await enableSync(page);
  await enableSync(otherPage);

  await page.goto('/');
  await page.getByRole('button', { name: '+ Lieu' }).click();
  await page.locator('#poi-form [name="label"]').fill('Village');
  await page.locator('#poi-form button[type="submit"]').click();
  await page.locator('#settings-btn').click();
  await page.locator('#sync-create').click();
  await expect(page.locator('#sync-status')).toHaveText(/Synchronisé/);
  await page.locator('#share-create').click();
  await expect(page.locator('#share-url')).toHaveValue(/\?vue=[A-Z2-9]{8}$/);
  const link = await page.locator('#share-url').inputValue();

  await otherPage.goto(link);
  await expect(otherPage.locator('#readonly')).toContainText('Lecture seule');
  await expect(otherPage.locator('#poi-list .item-name')).toHaveText(['Village']);
  await expect(otherPage.getByRole('button', { name: '+ Lieu' })).toBeHidden();
  await expect(otherPage.locator('#undo-btn')).toBeHidden();
  await otherPage.locator('#poi-list .item').click();
  await expect(otherPage.locator('.leaflet-popup-content').getByRole('button', { name: 'Modifier' })).toBeHidden();
  await expect(otherPage.locator('.leaflet-popup-content').getByRole('button', { name: 'Supprimer' })).toBeHidden();
  await otherPage.locator('#map').click({ button: 'right', position: { x: 200, y: 200 } });
  await expect(otherPage.locator('#context-menu button:visible')).toHaveText(['📋 Copier les coordonnées', '🎯 Centrer ici']);
  expect(await otherPage.evaluate(() => localStorage.getItem('minecarte:data'))).toBeNull();

  // Les modifications du propriétaire apparaissent chez la personne qui consulte.
  await page.locator('#settings-close').click();
  await page.getByRole('button', { name: '+ Lieu' }).click();
  await page.locator('#poi-form [name="label"]').fill('Ferme');
  await page.locator('#poi-form button[type="submit"]').click();
  await expect(page.locator('#sync-status')).toHaveText(/Synchronisé/);
  await otherPage.reload();
  await expect(otherPage.locator('#poi-list .item-name')).toHaveText(['Ferme', 'Village']);

  page.on('dialog', (d) => d.accept());
  await page.locator('#settings-btn').click();
  await page.locator('#share-revoke').click();
  await expect(page.locator('#toast')).toHaveText('Lien révoqué.');
  await otherPage.reload();
  await expect(otherPage.locator('#readonly')).toContainText('Lien inconnu ou révoqué.');
});
