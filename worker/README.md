# Worker de synchronisation MineCarte

Petit service Cloudflare Worker qui sert de relais entre tes appareils : chacun
pousse et récupère un instantané JSON de ses POI et chemins, identifié par un
code à 8 caractères (pas de compte, pas de mot de passe). Côté appli, la logique
est dans `../js/sync.js`.

## Mise en place (une seule fois)

Il faut un compte Cloudflare (gratuit). Commandes à lancer depuis ce dossier
(`worker/`) :

```sh
npm install
npx wrangler login
npx wrangler kv namespace create SYNC_KV
```

La dernière commande affiche un `id` : colle-le dans `wrangler.toml` à la place
de `REMPLACER_PAR_L_ID_DU_NAMESPACE`, puis déploie :

```sh
npm run deploy
```

Wrangler affiche l'URL du worker (`https://minecarte-sync.<ton-compte>.workers.dev`).
Ajoute-la au dépôt GitHub comme **variable** (Settings → Secrets and variables →
Actions → onglet *Variables* → New repository variable) :

- `SYNC_WORKER_URL` = l'URL du worker, sans slash final.

Relance ensuite le déploiement GitHub Pages (onglet Actions → « Déploiement
GitHub Pages » → Run workflow) : la section « Synchronisation cloud » apparaît
dans les Réglages de la carte. Sans cette variable, elle reste masquée.

## Déploiement automatique (optionnel)

Le workflow `.github/workflows/worker-deploy.yml` lance les tests puis redéploie
le worker à chaque changement sous `worker/` poussé sur `main`. Pour qu'il
déploie, ajoute deux **secrets** au dépôt (Settings → Secrets and variables →
Actions → New repository secret) :

- `CLOUDFLARE_API_TOKEN` : token créé avec le modèle « Edit Cloudflare Workers »
  (dashboard Cloudflare → Profil → API Tokens) ;
- `CLOUDFLARE_ACCOUNT_ID` : visible dans la barre latérale des pages Workers.

Sans ces secrets, le workflow s'arrête après les tests.

## Développement

```sh
npm test       # tests (node --test, aucune dépendance)
npm run dev    # worker en local (wrangler dev)
```

## API et stockage

| Requête | Réponse |
| --- | --- |
| `POST /api/sync` | `201 { code }` |
| `GET /api/sync/:code` | `200 { version, data }` ou `404` |
| `PUT /api/sync/:code` avec `{ baseVersion, data }` | `200 { version, data }` ou `409 { version, data }` |

- Une valeur par code, sous la clé `sync:<CODE>` ; `data` contient `seed`, `pois`
  et `paths` (même format que l'export JSON).
- Écriture optimiste : un `PUT` n'est accepté que si `baseVersion` est la version
  stockée, puis la version est incrémentée. Sinon `409` avec l'état serveur :
  l'appli fusionne (POI par POI, chemin par chemin) et repousse. La version est
  un entier attribué par le serveur, jamais une horloge.
- Un code inutilisé pendant 180 jours expire.
- Aucune protection au-delà du code (~500 milliards de combinaisons) : quiconque
  le connaît peut lire et modifier les données associées.
- Quota du plan gratuit de Cloudflare KV : 1 000 écritures par jour. L'appli
  regroupe les modifications (envoi 1,5 s après la dernière) et ne fait que des
  lectures pour vérifier les changements des autres appareils (toutes les 30 s
  quand la carte est affichée).
