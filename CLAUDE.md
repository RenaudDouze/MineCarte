# CLAUDE.md

Consignes pour Claude Code (claude.ai/code) sur ce dépôt.

## Projet

MineCarte : carte interactive de monde Minecraft (Leaflet), site statique publié sur GitHub
Pages, sans étape de compilation. Scripts navigateur en IIFE attachés à `window`, chargés dans
l'ordre par `index.html` : `vendor/leaflet`, `utils`, `noise`, `terrain`, `config`, `icons`,
`store`, `sync`, `app`. Worker Cloudflare de synchronisation dans `worker/`
(projet npm séparé, uniquement pour Wrangler).

## Commandes (racine)

```sh
npm ci
npm run lint              # oxlint --deny-warnings
npm run typecheck         # tsc (allowJs + checkJs, globals dans types/globals.d.ts)
npm test                  # vitest run (jsdom)
npm run test:coverage     # seuil 100 % lignes/branches/fonctions/instructions
npm run test:mutation     # Stryker, seuil 100 % ; MUTATE=js/store.js pour un module
npm run test:e2e          # Playwright sur _site-e2e (build + serveur statique)
npm run build             # _site/ ; SYNC_WORKER_URL=https://… pour la synchronisation
```

Un fichier : `npx vitest run tests/store.test.js`, `npx playwright test e2e/poi.spec.mjs`.

## Règles qualité (bloquantes en CI)

- **Couverture 100 %** sur `js/**` et `worker/src/**`. Tout nouveau code arrive avec ses tests.
- **Mutation 100 %** sur les modules listés dans `targets` de `stryker.config.mjs` (la matrice
  CI en est déduite : un nouveau module logique s'y ajoute avec ses fichiers de test).
  `app.js` (câblage Leaflet/DOM) est couvert à 100 % mais pas muté : y garder le moins de
  logique possible et la déplacer dans un module testé (`utils.js`, `store.js`…).
- Mutant équivalent : simplifier le code (supprimer le test redondant, la valeur par défaut
  inatteignable) plutôt que de désactiver le mutant. Pas de `// Stryker disable`.
- Un test ne vérifie pas seulement qu'une erreur est levée : il vérifie laquelle
  (`rejects.toBe(err)`, message exact), sinon des mutants survivent.
- Aucun test désactivé (`skip`, `only`) ; lint sans avertissement.

## Tests : pièges connus

- `tests/helpers/app.js` démarre l'application complète dans jsdom (`boot()`), avec faux
  canvas, faux `<dialog>`, IndexedDB (`fake-indexeddb`) et URL objet simulées. Les fausses
  minuteries s'installent **après** `boot()`.
- Île centrale de l'End (`terrain.js`) : distances comparées au carré, en entiers, pour que le
  bord soit exact (les tests visent des blocs pile sur le rayon).
- jsdom n'a qu'un `localStorage` : vider avant de simuler un autre appareil.
- `tests/helpers/server.js` : vrai worker sur KV en mémoire, utilisé par les tests unitaires
  et les tests e2e (via `page.route`).
- Stryker utilise le runner « command » (le runner vitest donne de faux survivants sur ces
  IIFE) ; `tsconfigFile` pointe volontairement vers un fichier absent (bug TypeScript 7).

## Déploiement

`pages.yml` et `worker-deploy.yml` se déclenchent après une CI verte sur `main`
(`workflow_run`). Configuration par variables (`SYNC_WORKER_URL`,
`CLOUDFLARE_KV_NAMESPACE_ID`) et secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) du
dépôt ; voir `worker/README.md`.
