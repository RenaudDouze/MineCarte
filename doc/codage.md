# Conventions de code

Le détail de la philosophie de test et de la CI est dans `CLAUDE.md` ; ce fichier fixe les conventions du quotidien.

## À faire

- Commits au format conventionnel `type(portée): sujet`, à l'impératif, qui disent le pourquoi (hook : `git config core.hooksPath .githooks`). La version se déduit des commits : ne jamais l'écrire à la main.
- Ajouter un test à côté du fichier modifié ; couverture et mutation restent à 100 %.
- Garder la logique dans des fonctions pures (`js/utils.js`), le DOM et le réseau dans la coque.
- Un nouveau module s'ajoute aux cibles de `stryker.config.mjs`.

## À éviter

- Baisser un seuil (couverture, mutation) ou ajouter un `Stryker disable` sans raison écrite.
- Utiliser un espace de noms avant son chargement (voir `doc/architecture.md`).
- Référencer une action GitHub par un tag : toujours par SHA.
