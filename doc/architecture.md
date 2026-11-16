# Architecture

La description fonctionnelle (cartes, synchronisation, déploiement) est dans `CLAUDE.md`. Ce fichier fixe ce qui structure le chargement du code.

## Scripts classiques, pas de modules

`index.html` charge les fichiers de `js/` par des balises `<script src>` : aucun `import`, chaque fichier expose un espace de noms global (`global.Utils = …`). Il n'y a donc pas de graphe de dépendances qu'un outil comme `dependency-cruiser` puisse vérifier (écart déclaré dans `CLAUDE.md`).

## Règle : l'ordre des balises est l'architecture

Un fichier n'utilise que les espaces de noms chargés **avant** lui. Ordre actuel :

| # | Fichier | Rôle |
|---|---|---|
| 1 | `vendor/leaflet/leaflet.js` | bibliothèque de cartographie |
| 2 | `js/utils.js` | fonctions pures (géométrie, formats, recherche) |
| 3 | `js/noise.js`, `js/terrain.js` | génération du terrain |
| 4 | `js/config.js`, `js/icons.js` | configuration et icônes |
| 5 | `js/store.js` | état et persistance |
| 6 | `js/sync.js`, `js/undo.js`, `js/backups.js`, `js/drafts.js` | synchronisation, annulation, sauvegardes, brouillons |
| 7 | `js/app.js` | interface (dernier : il utilise tout le reste) |

Ajouter un fichier : l'insérer après ceux qu'il utilise et avant ceux qui l'utilisent, puis l'ajouter à `stryker.config.mjs` (la couverture prend `js/**` automatiquement).

## Pièges

- Un fichier chargé trop tôt échoue au démarrage (`undefined` sur l'espace de noms) : un test charge d'abord les fichiers dont dépend le module testé (par exemple `tests/terrain.test.js` importe `noise.js` avant `terrain.js`).
