import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.mjs';

// A11Y-02 : chaque état qui change le DOM passe par axe-core, dans les deux
// thèmes (A11Y-05).
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations;
}

for (const scheme of ['light', 'dark']) {
  test.describe(`thème ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test('axe : carte, Overworld', async ({ page }) => {
      await page.goto('/#overworld/0/0/0');
      await expect(page.locator('.leaflet-tile-container canvas').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('axe : popup d’une position cherchée', async ({ page }) => {
      await page.goto('/');
      await page.locator('#global-search').fill('120 -40');
      await page.locator('#global-search').press('Enter');
      await expect(page.locator('.leaflet-popup-content .popup-title')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}
