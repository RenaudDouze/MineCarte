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
// app.js (câblage de l'interface : Leaflet, DOM, événements, ~1500 lignes)
// est découpé en plages de lignes (`fichier:début-fin`), un job de CI chacune.
export const targets = {
  'js/utils.js': ['tests/utils.test.js'],
  'js/noise.js': ['tests/noise.test.js'],
  'js/terrain.js': ['tests/terrain.test.js'],
  'js/store.js': ['tests/store.test.js'],
  'js/icons.js': ['tests/icons.test.js'],
  'js/config.js': ['tests/config.test.js'],
  'js/version.js': ['tests/version.test.js'],
  'js/sync.js': ['tests/sync.test.js'],
  'js/undo.js': ['tests/undo.test.js'],
  'js/backups.js': ['tests/backups.test.js'],
  'js/drafts.js': ['tests/drafts.test.js'],
  'js/app.js:1-150': ['tests/app.test.js'],
  'js/app.js:151-225': ['tests/app.test.js'],
  'js/app.js:226-260': ['tests/app.test.js'],
  'js/app.js:261-300': ['tests/app.test.js'],
  'js/app.js:301-335': ['tests/app.test.js'],
  'js/app.js:336-375': ['tests/app.test.js'],
  'js/app.js:376-450': ['tests/app.test.js'],
  'js/app.js:451-500': ['tests/app.test.js'],
  'js/app.js:501-550': ['tests/app.test.js'],
  'js/app.js:551-600': ['tests/app.test.js'],
  'js/app.js:601-640': ['tests/app.test.js'],
  'js/app.js:641-675': ['tests/app.test.js'],
  'js/app.js:676-750': ['tests/app.test.js'],
  'js/app.js:751-825': ['tests/app.test.js'],
  'js/app.js:826-900': ['tests/app.test.js'],
  'js/app.js:901-950': ['tests/app.test.js'],
  'js/app.js:951-1000': ['tests/app.test.js'],
  'js/app.js:1001-1050': ['tests/app.test.js'],
  'js/app.js:1051-1100': ['tests/app.test.js'],
  'js/app.js:1101-1150': ['tests/app.test.js'],
  'js/app.js:1151-1200': ['tests/app.test.js'],
  'js/app.js:1201-1275': ['tests/app.test.js'],
  'js/app.js:1276-1315': ['tests/app.test.js'],
  'js/app.js:1316-1350': ['tests/app.test.js'],
  'js/app.js:1351-1425': ['tests/app.test.js'],
  'js/app.js:1426-1507': ['tests/app.test.js'],
  'worker/src/index.js': ['worker/test/worker.test.js'],
  'worker/src/code.js': ['worker/test/worker.test.js'],
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
