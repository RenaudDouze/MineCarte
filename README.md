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
- **Fond** : par défaut un fond neutre (aplat légèrement texturé par dimension ; dans l'End, l'île
  centrale, ses piliers et le vide, qui sont les mêmes dans tous les mondes), pour ne pas être
  confondu avec une vraie carte. En option (Réglages → « Fond décoratif (fictif) »), un fond
  décoratif est généré pour chaque dimension à partir d'une graine modifiable (biomes pour
  l'Overworld, biomes du Nether et lacs de lave, îles extérieures au-delà de 1024 blocs pour
  l'End). Il ne reproduit **pas** le vrai monde Minecraft : la mention « Fond fictif — pas le
  terrain réel » reste alors affichée sur la carte.
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
| `js/noise.js` | Bruit de valeur seedé (fBm) |
| `js/terrain.js` | Génération des fonds des dimensions et de la grille (`L.GridLayer`) |
| `js/icons.js` | Chargement et recherche des icônes d'items |
| `js/sync.js` | Synchronisation cloud par code (fusion, envoi, réception) |
| `js/config.js` | Configuration (URL du worker, régénérée au déploiement) |
| `worker/` | Worker Cloudflare de synchronisation |
| `js/store.js` | Modèle de données (POI, liens, chemins), persistance, import / export |
| `js/app.js` | Carte, rendu, interactions |

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
