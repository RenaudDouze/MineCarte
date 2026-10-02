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
- **Fond par dimension** : le même aplat légèrement texturé pour les trois dimensions, d'une
  couleur propre à chacune (vert herbe pour l'Overworld, rouge netherrack pour le Nether, violet
  pour l'End), qui ne peut pas être confondu avec une vraie carte.
- **Grille** : blocs, chunks (16) et régions (512), axes X = 0 et Z = 0. Les coordonnées sous la
  souris s'affichent en bas à gauche (chunk, région, équivalent Nether ⇄ Overworld).
- **Lieux** : ajout (bouton « + Lieu » ou clic droit sur la carte), modification et suppression.
  Chaque lieu a un nom, une couleur, une dimension et des coordonnées X, Y, Z. Seuls X et Z
  servent au placement, Y est affiché pour information.
- **Catégories** : un lieu peut être classé (Base, Ferme, Structure, Village, Biome, Portail,
  Intéressant ; les anciennes catégories Mine et Ressource deviennent « Intéressant »). Des
  pastilles au-dessus de la liste masquent ou affichent chaque catégorie, sur la
  carte comme dans la liste (réglage gardé dans le navigateur).
- **Icônes d'items** : un lieu peut afficher l'icône d'un item Minecraft (recherche en anglais
  parmi ~1 650 items). Les textures, propriété de Mojang, ne sont pas incluses dans le dépôt :
  elles sont chargées depuis le paquet npm [`minecraft-textures`](https://github.com/destruc7i0n/minecraft-textures)
  via jsDelivr (connexion internet requise).
- **Liens entre lieux** : un lieu peut être lié à un ou plusieurs autres lieux, y compris dans une
  autre dimension. Dans la popup d'un lieu, cliquer sur un lien centre la carte sur le lieu lié
  (et change de dimension si besoin). Les lieux liés d'une même dimension sont reliés par un
  trait pointillé. Le bouton « Portail Nether / Overworld » crée un lieu lié dans l'autre
  dimension aux coordonnées converties (÷8 ou ×8).
- **Chemins** : tracé de polylignes avec un nom, une couleur et une épaisseur (1 à 16 px), et
  affichage de leur longueur en blocs.
  - Tracé : clic pour ajouter un point, clic sur un lieu pour s'y accrocher, double-clic ou
    `Entrée` pour terminer, `Retour arrière` pour annuler le dernier point, `Échap` pour abandonner.
  - Édition : glisser un sommet pour le déplacer, clic sur un segment pour insérer un point,
    clic droit sur un sommet pour le supprimer. « Prolonger » ajoute des points à la fin.
  - Par coordonnées : « Par coordonnées » (onglet Chemins) crée un chemin à partir d'une liste
    de points, un par ligne (`X Z` ou `X Y Z`, Y ignoré). Le même champ « Points » du dialogue
    « Modifier » permet de corriger les points d'un chemin existant au bloc près.
- **Zones** (onglet Zones) : « + Tracer une zone » (ou « Commencer une zone ici » au clic droit)
  trace un polygone fermé, rempli de sa couleur, avec son aire en blocs² et son périmètre. Le nom
  de chaque zone est écrit sur la carte, en son centre (réglage « Noms des zones »). Une zone se
  trace, s'édite, se prolonge et se saisit par coordonnées comme un chemin (au moins 3 points) ;
  la case « Zone » du dialogue transforme un chemin en zone et inversement.
- **Recherche globale** (champ en haut, raccourci `/`) : trouve un lieu ou un chemin par son nom
  (sans tenir compte des accents ni de la casse, toutes dimensions confondues) ou des coordonnées
  `X Z` / `X Y Z` (`~` pour ignorer Y). Flèches pour choisir, `Entrée` pour y aller. Depuis des
  coordonnées trouvées : créer un lieu (coordonnées pré-remplies), commencer un chemin, ajouter le
  point au bout d'un chemin existant ou au tracé en cours.
- **Annuler / rétablir** : boutons ↶ ↷ en haut, ou `Ctrl+Z` / `Ctrl+Y` (`Ctrl+Maj+Z`), pour les 50
  dernières modifications (y compris « Tout effacer » et un import). Une modification reçue d'un
  autre appareil vide l'historique, pour ne jamais défaire le travail des autres.
- **Réglages** (bouton ⚙ en haut, dans une fenêtre à part) : affichage, synchronisation, données,
  historique local et aide.
- **Historique local** (Réglages) : une copie des données est faite automatiquement dans le
  navigateur (au plus toutes les 10 minutes, et toujours avant un import, un « Tout effacer » ou
  une restauration). Les 10 dernières sont listées avec leur date et leur contenu ; « Restaurer »
  y revient, même après avoir fermé la page (et reste annulable).
- **Tout afficher** : le bouton ⤢ sous le zoom cadre la carte sur tous les lieux et chemins de la
  dimension affichée.
- **Sur téléphone** : le panneau s'ouvre avec ☰ et se referme en touchant la carte ; un appui
  long sur la carte ouvre le menu (ajouter un lieu, commencer un chemin…). Au doigt, une mire
  marque le centre de la carte, dont les coordonnées s'affichent en bas, et « + Lieu » y place le
  nouveau lieu. Boutons et listes sont agrandis sur les écrans tactiles.
- **Saisie protégée** : ce qui est tapé dans le dialogue d'un lieu, d'un chemin ou d'une zone est
  gardé dans le navigateur tant qu'il n'est pas enregistré. Après une fermeture involontaire
  (`Échap`, clic à côté, onglet fermé), rouvrir le même élément (ou un nouvel élément) retrouve la
  saisie ; « Annuler » l'oublie. Une petite croix vide un champ de texte d'un clic.
- **URL partageable** (`#dimension/x/z/zoom`).
- **Sauvegarde** automatique dans le navigateur (localStorage), **export et import JSON**.
- **Synchronisation cloud par code** (Réglages) : « Créer un code » sur un appareil, puis
  « Rejoindre » avec ce code sur les autres. Les modifications sont synchronisées
  automatiquement ; en cas de modifications simultanées, les données sont fusionnées lieu par
  lieu et chemin par chemin. Nécessite un petit worker Cloudflare : voir `worker/README.md`.
- **Lien en lecture seule** (Réglages, une fois la synchronisation active) : un lien
  `…?vue=XXXXXXXX` montre la carte, à jour, sans permettre de la modifier ni révéler le code.
  La carte consultée reste en mémoire (rien n'est écrit dans le navigateur de la personne qui
  la regarde). « Révoquer » rend le lien inutilisable ; un nouveau lien peut être créé ensuite.

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | Page et dialogues |
| `css/style.css` | Styles |
| `js/noise.js` | Hachage déterministe (texture du fond) |
| `js/terrain.js` | Fond des dimensions et grille (`L.GridLayer`) |
| `js/icons.js` | Chargement et recherche des icônes d'items |
| `js/undo.js` | Annuler / rétablir (piles d'instantanés) |
| `js/backups.js` | Historique local (copies automatiques dans le navigateur) |
| `js/drafts.js` | Brouillons des dialogues (saisie gardée en cas de fermeture) |
| `js/sync.js` | Synchronisation cloud par code (fusion, envoi, réception) |
| `js/config.js` | Configuration (URL du worker, régénérée au déploiement) |
| `worker/` | Worker Cloudflare de synchronisation |
| `js/store.js` | Modèle de données (lieux, liens, chemins), persistance, import / export |
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
      "x": 120, "y": 64, "z": -340, "icon": "minecraft:diamond_sword", "category": "base",
      "links": ["…"] }
  ],
  "paths": [
    { "id": "…", "name": "Route", "color": "#ffeb3b", "dim": "nether", "weight": 4,
      "points": [[15, -42], [80, -42]] },
    { "id": "…", "name": "Ferme", "color": "#43a047", "dim": "overworld", "weight": 2,
      "points": [[0, 0], [100, 0], [100, 50]], "closed": true }
  ]
}
```
