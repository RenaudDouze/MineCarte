import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true });

test('téléphone : panneau, mire au centre et ajout d’un lieu', async ({ page }) => {
  await page.goto('/#overworld/0/0/1');
  await expect(page.locator('body')).toHaveClass(/sidebar-hidden/);
  await expect(page.locator('#add-poi')).not.toBeInViewport();

  await page.locator('#toggle-sidebar').tap();
  await expect(page.locator('#add-poi')).toBeInViewport();
  const box = await page.locator('#sidebar').boundingBox();
  expect(box.width).toBeLessThanOrEqual(412);
  expect(box.width).toBeGreaterThan(300);
  // Les contrôles de zoom ne recouvrent pas le panneau.
  await page.locator('.tab[data-tab="paths"]').tap({ position: { x: 20, y: 20 } });
  await page.locator('.tab[data-tab="pois"]').tap({ position: { x: 20, y: 20 } });

  // Toucher la carte (la bande encore visible à droite) referme le panneau.
  await page.locator('#map').tap({ position: { x: 405, y: 600 } });
  await expect(page.locator('body')).toHaveClass(/sidebar-hidden/);
  await expect(page.locator('.crosshair')).toBeVisible();

  // Au doigt, les coordonnées suivent le centre de la carte.
  await page.evaluate(() => {
    const { map } = window.MineCarte;
    map.setView(window.Utils.toLatLng(100, -50), 1, { animate: false });
  });
  await expect(page.locator('#coords')).toContainText('X 100  Z -50');

  await page.locator('#toggle-sidebar').tap();
  await page.locator('#add-poi').tap();
  await expect(page.locator('#poi-dialog')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#poi-form [name="x"]')).toHaveValue('100');
  await expect(page.locator('#poi-form [name="z"]')).toHaveValue('-50');
  await page.locator('#poi-form [name="label"]').fill('Camp');
  await page.locator('#poi-form button[type="submit"]').tap();
  await expect(page.locator('.poi-label', { hasText: 'Camp' })).toBeInViewport();
});
