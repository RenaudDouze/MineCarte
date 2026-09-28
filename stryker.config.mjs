// Mutation testing à 100 % (seuil bloquant) sur toute la logique du site et
// du worker. Chaque module est associé aux seuls fichiers de test capables de
// tuer ses mutants : la CI lance un job par module (variable MUTATE), et le
// runner « command » ne relance que ces tests-là pour chaque mutant.
//
// Pourquoi le runner « command » et pas « vitest » : le runner vitest de
// Stryker n'exécute qu'environ un test par mutant sur ces scripts IIFE et
// laisse survivre des mutants que les tests tuent pourtant (même constat que
// KoiKiManke). Une commande `vitest run` fixe par mutant donne des résultats
// justes.
//
// app.js (câblage de l'interface : Leaflet, DOM, événements) est couvert à
// 100 % par tests/app.test.js et par les tests e2e, mais n'est pas muté :
// sa logique est déportée dans les modules ci-dessous (utils.js notamment),
// comme la « logique pure » de PlusUn et KoiKiManke.
export const targets = {
  'js/utils.js': ['tests/utils.test.js'],
  'js/noise.js': ['tests/noise.test.js'],
  'js/terrain.js': ['tests/terrain.test.js'],
  'js/store.js': ['tests/store.test.js'],
  'js/icons.js': ['tests/icons.test.js'],
  'js/config.js': ['tests/config.test.js'],
  'js/backgrounds.js': ['tests/backgrounds.test.js'],
  'js/sync.js': ['tests/sync.test.js'],
};

const selected = process.env.MUTATE ? process.env.MUTATE.split(',') : Object.keys(targets);
for (const file of selected) {
  if (!targets[file]) throw new Error(`MUTATE : module inconnu ${file}`);
}
const tests = [...new Set(selected.flatMap((file) => targets[file]))];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'command',
  commandRunner: { command: `npx vitest run ${tests.join(' ')}` },
  coverageAnalysis: 'off',
  // Le préprocesseur tsconfig de Stryker appelle une API retirée de
  // TypeScript 7 (`ts.parseConfigFileTextToJson`) et plante au démarrage :
  // le pointer vers un fichier inexistant le rend inopérant (le code muté est
  // du JavaScript). Même contournement que KoiKiManke.
  tsconfigFile: 'tsconfig.stryker-unused.json',
  mutate: selected,
  ignorePatterns: ['coverage', 'reports', 'playwright-report', 'test-results', '_site', 'worker/node_modules'],
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  thresholds: { high: 100, low: 100, break: 100 },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};
