# CLAUDE.md

Consignes pour Claude Code (claude.ai/code) sur ce dépôt.

## Projet

MineCarte : carte interactive de monde Minecraft (Leaflet), site statique publié sur GitHub
Pages, sans étape de compilation. Scripts navigateur en IIFE attachés à `window`, chargés dans
l'ordre par `index.html` : `vendor/leaflet`, `utils`, `noise`, `terrain`, `config`, `icons`,
`store`, `sync`, `undo`, `backups`, `drafts`, `app`. Worker Cloudflare de synchronisation dans `worker/`
(projet npm séparé, uniquement pour Wrangler).

## Commandes (racine)

```sh
npm ci
npm run lint              # oxlint --deny-warnings
npm run typecheck         # tsc (allowJs + checkJs, globals dans types/globals.d.ts)
npm test                  # vitest run (jsdom)
npm run test:coverage     # seuil 100 % lignes/branches/fonctions/instructions
npm run test:mutation     # Stryker, seuil 100 % ; MUTATE=js/store.js ou js/app.js:1-150 pour un module/une plage
npm run test:e2e          # Playwright sur _site-e2e (build + serveur statique)
npm run build             # _site/ ; SYNC_WORKER_URL=https://… pour la synchronisation
```

Un fichier : `npx vitest run tests/store.test.js`, `npx playwright test e2e/poi.spec.mjs`.

## Règles qualité (bloquantes en CI)

- **Couverture 100 %** sur `js/**` et `worker/src/**`. Tout nouveau code arrive avec ses tests.
- **Mutation 100 %** sur les modules listés dans `targets` de `stryker.config.mjs` (la matrice
  CI en est déduite : un nouveau module s'y ajoute avec ses fichiers de test). `app.js`
  (câblage Leaflet/DOM) est muté lui aussi, découpé en plages de lignes
  (`js/app.js:1-150`…, ~50-75 lignes, un job de CI chacune) : en ajoutant du code, ajuster les plages
  pour qu'elles couvrent tout le fichier. Un fichier long se découpe ainsi, jamais en
  désactivant des mutants.
- Mutant équivalent : simplifier le code (supprimer le test redondant, la valeur par défaut
  inatteignable) plutôt que de désactiver le mutant. Pas de `// Stryker disable`.
- Un test ne vérifie pas seulement qu'une erreur est levée : il vérifie laquelle
  (`rejects.toBe(err)`, message exact), sinon des mutants survivent.
- Aucun test désactivé (`skip`, `only`) ; lint sans avertissement.

## Tests : pièges connus

- `tests/helpers/app.js` démarre l'application complète dans jsdom (`boot()`), avec faux
  canvas, faux `<dialog>`, IndexedDB (`fake-indexeddb`) et URL objet simulées. Les fausses
  minuteries s'installent **après** `boot()`.
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

## Documentation, versioning and architecture rules

- `doc/` holds the stable truth for humans and agents: `architecture.md` (script load order), `codage.md` (conventions), `improvement.md` (backlog).
- Commits follow Conventional Commits (`type(scope): subject`); enable the hook with `git config core.hooksPath .githooks`. The version is derived from the commits by semantic-release (`release.yml`): never edit a version number or a changelog by hand.
- Audit (CI-13) : le niveau `high` complet passe par `.github/scripts/audit-check.mjs` ; un avis sans correctif se déclare dans `.github/audit-exceptions.json` (raison + expiration, 30 jours au plus), jamais en baissant le seuil.
- Version affichée (VER-09) : dernier tag `v*`, lu à la construction par `.github/scripts/app-version.mjs` (identique dans tous les dépôts, ne pas le modifier ici) ; `js/version.js` lit `version` dans `js/config.js`, généré par `scripts/build.mjs` ; affichée au bas de la barre latérale. Les workflows de build (`pages.yml`) font un checkout en `fetch-depth: 0`, sans quoi la page affiche `dev`. Les tests figent la valeur : jamais de dépendance aux tags git.

## Écarts au guide

- ARCH-01 / ARCH-02 : le projet charge des scripts classiques (espace de noms global, aucun `import`), donc `dependency-cruiser` n'a aucun graphe à vérifier. L'ordre des balises `<script>` fait office d'architecture, décrit dans `doc/architecture.md`.
