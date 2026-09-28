import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// L'environnement de développement fournit son propre Chromium ; la CI installe
// le sien (playwright install --with-deps chromium).
const localChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(localChromium) ? localChromium : undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  // Le site tel qu'il est publié : build puis serveur statique.
  webServer: {
    command: 'node scripts/build.mjs _site-e2e && node scripts/serve.mjs _site-e2e',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    env: { PORT: '4173', SYNC_WORKER_URL: '' },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
});
