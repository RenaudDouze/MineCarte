import { test, expect, enableSync } from './fixtures.mjs';

test('synchronisation par code entre deux appareils', async ({ page, otherPage }) => {
  await enableSync(page);
  await enableSync(otherPage);

  await page.goto('/');
  await page.getByRole('button', { name: '+ POI' }).click();
  await page.locator('#poi-form [name="label"]').fill('Village');
  await page.locator('#poi-form button[type="submit"]').click();
  await page.locator('.tab[data-tab="settings"]').click();
  await page.locator('#sync-create').click();
  await expect(page.locator('#sync-status')).toHaveText(/Synchronisé/);
  const code = await page.locator('#sync-code').textContent();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  await otherPage.goto('/');
  await otherPage.locator('.tab[data-tab="settings"]').click();
  await otherPage.locator('#sync-join [name="code"]').fill(code);
  await otherPage.locator('#sync-join button[type="submit"]').click();
  await expect(otherPage.locator('#toast')).toHaveText(`Appareil relié au code ${code}.`);
  await expect(otherPage.locator('#poi-list .item-name')).toHaveText(['Village']);

  // Modification sur le second appareil, reçue par le premier.
  await otherPage.locator('.tab[data-tab="pois"]').click();
  await otherPage.getByRole('button', { name: '+ POI' }).click();
  await otherPage.locator('#poi-form [name="label"]').fill('Ferme');
  await otherPage.locator('#poi-form button[type="submit"]').click();
  await expect(otherPage.locator('#sync-status')).toHaveText(/Synchronisé/);
  await page.locator('#sync-now').click();
  await expect(page.locator('#poi-list .item-name')).toHaveText(['Ferme', 'Village']);
});
