# MineCarte

Carte interactive de monde Minecraft, inspirée de la [seed map de Chunkbase](https://www.chunkbase.com/apps/seed-map),
construite avec [Leaflet](https://leafletjs.com/).

## Lancer

Aucune compilation ni dépendance à installer : ouvrez `index.html` dans un navigateur
(Leaflet est inclus dans `vendor/leaflet`). Pour la copie dans le presse-papiers, préférez
un petit serveur local :

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

## Fonctionnalités

- **Trois dimensions** : Overworld, Nether et End, avec un onglet chacune. Chaque dimension
  garde sa propre vue (position et zoom).
- **Fond fictif** : chaque dimension a un fond qui ressemble à une carte Minecraft (océans,
  plages, rivières, forêts, déserts, montagnes… ; lave et forêts du Nether ; îles de l'End), mais
  il est inventé à partir d'une graine fixe et ne correspond pas à ton monde. La mention « Fond
  fictif — pas le terrain réel » reste affichée sur la carte. Seuls l'île centrale de l'End, ses
  piliers et le portail de sortie sont à leur vraie place.
- **Grille** : blocs, chunks (16) et régions (512), axes X = 0 et Z = 0. Les coordonnées sous la
  souris s'affichent en bas à gauche (chunk, région, équivalent Nether ⇄ Overworld).
- **POI** : ajout (bouton « + POI » ou clic droit sur la carte), modification et suppression.
  Chaque POI a un nom, une couleur, une dimension et des coordonnées X, Y, Z. Seuls X et Z
  servent au placement, Y est affiché pour information.
- **Icônes d'items** : un POI peut afficher l'icône d'un item Minecraft (recherche en anglais
  parmi ~1 650 items). Les textures, propriété de Mojang, ne sont pas incluses dans le dépôt :
  elles sont chargées depuis le paquet npm [`minecraft-textures`](https://github.com/destruc7i0n/minecraft-textures)
  via jsDelivr (connexion internet requise).
- **Liens entre POI** : un POI peut être lié à un ou plusieurs autres POI, y compris dans une
  autre dimension. Dans la popup d'un POI, cliquer sur un lien centre la carte sur le POI lié
  (et change de dimension si besoin). Les POI liés d'une même dimension sont reliés par un
  trait pointillé. Le bouton « Portail Nether / Overworld » crée un POI lié dans l'autre
  dimension aux coordonnées converties (÷8 ou ×8).
- **Chemins** : tracé de polylignes avec un nom, une couleur et une épaisseur (1 à 16 px), et
  affichage de leur longueur en blocs.
  - Tracé : clic pour ajouter un point, clic sur un POI pour s'y accrocher, double-clic ou
    `Entrée` pour terminer, `Retour arrière` pour annuler le dernier point, `Échap` pour abandonner.
  - Édition : glisser un sommet pour le déplacer, clic sur un segment pour insérer un point,
    clic droit sur un sommet pour le supprimer. « Prolonger » ajoute des points à la fin.
- **Aller à** des coordonnées X / Z (Y optionnel) : depuis l'emplacement trouvé, créer un POI
  (coordonnées pré-remplies), commencer un chemin, ajouter le point au bout d'un chemin existant
  ou au tracé en cours.
- **URL partageable** (`#dimension/x/z/zoom`).
- **Sauvegarde** automatique dans le navigateur (localStorage), **export et import JSON**.
- **Synchronisation cloud par code** (Réglages) : « Créer un code » sur un appareil, puis
  « Rejoindre » avec ce code sur les autres. Les modifications sont synchronisées
  automatiquement ; en cas de modifications simultanées, les données sont fusionnées POI par
  POI et chemin par chemin. Nécessite un petit worker Cloudflare : voir `worker/README.md`.

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | Page et dialogues |
| `css/style.css` | Styles |
| `js/noise.js` | Bruit de valeur (fond fictif) |
| `js/terrain.js` | Fond fictif des dimensions (biomes) et grille (`L.GridLayer`) |
| `js/icons.js` | Chargement et recherche des icônes d'items |
| `js/sync.js` | Synchronisation cloud par code (fusion, envoi, réception) |
| `js/config.js` | Configuration (URL du worker, régénérée au déploiement) |
| `worker/` | Worker Cloudflare de synchronisation |
| `js/store.js` | Modèle de données (POI, liens, chemins), persistance, import / export |
| `js/utils.js` | Fonctions partagées (coordonnées, conversions, longueurs, DOM) |
| `js/app.js` | Carte, rendu, interactions |

## Développement et contrôles qualité

Le site n'a besoin d'aucune dépendance pour fonctionner ; les outils de test, eux, s'installent
avec `npm ci` (Node 22.12 ou plus).

```sh
npm run lint            # oxlint, aucun avertissement toléré
npm run typecheck       # TypeScript (vérification des JS via JSDoc)
npm test                # tests unitaires (Vitest + jsdom)
npm run test:coverage   # idem, couverture exigée à 100 % (lignes, branches, fonctions)
npm run test:mutation   # Stryker, score de mutation exigé à 100 % (MUTATE=js/store.js pour un module)
npm run test:e2e        # Playwright sur le site construit (npm run build)
npm run build           # site statique dans _site/ (SYNC_WORKER_URL pour la synchronisation)
```

La CI (`.github/workflows/ci.yml`) lance sur chaque PR, dans des jobs séparés : lint, types,
tests unitaires + couverture 100 %, tests e2e, mutation testing à 100 % (un job par module,
agrégés dans le check « Mutation testing (100 %) »), construction du worker, audit des
dépendances, puis le build. Le site et le worker ne sont déployés qu'après une CI verte sur
`main`. CodeQL et Dependabot complètent le tout.

Pour bloquer le merge d'une PR tant qu'un contrôle échoue : Settings → Branches → règle sur
`main` → *Require status checks to pass*, avec les checks « Linter », « Vérification des
types », « Tests unitaires + couverture 100 % », « Tests fonctionnels (Playwright) »,
« Mutation testing (100 %) », « Worker de synchronisation (bundle + audit) », « Audit des
dépendances » et « Build du site ».

Coordonnées : la carte utilise `L.CRS.Simple`, avec 1 pixel = 1 bloc au zoom 0,
`lng = X` et `lat = -Z` (Z croît vers le sud, comme dans le jeu).

## Format des données exportées

```json
{
  "version": 1,
  "seed": "minecarte",
  "pois": [
    { "id": "…", "name": "Base", "color": "#e53935", "dim": "overworld",
      "x": 120, "y": 64, "z": -340, "icon": "minecraft:diamond_sword", "links": ["…"] }
  ],
  "paths": [
    { "id": "…", "name": "Route", "color": "#ffeb3b", "dim": "nether", "weight": 4,
      "points": [[15, -42], [80, -42]] }
  ]
}
```
