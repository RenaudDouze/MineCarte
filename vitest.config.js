import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les modules du site sont des scripts navigateur (IIFE attachées à
    // window) : jsdom par défaut ; les tests du worker passent en `node`
    // via leur docblock `@vitest-environment node`.
    environment: 'jsdom',
    include: ['tests/**/*.test.js', 'worker/test/**/*.test.js'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['js/**/*.js', 'worker/src/**/*.js'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
