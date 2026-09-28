# Worker de synchronisation MineCarte

Petit service Cloudflare Worker qui sert de relais entre tes appareils : chacun
pousse et récupère un instantané JSON de ses POI et chemins, identifié par un
code à 8 caractères (pas de compte, pas de mot de passe). Côté appli, la logique
est dans `../js/sync.js`.

## Mise en place (une seule fois, sans ligne de commande)

Tout se configure dans le dashboard Cloudflare et dans les réglages du dépôt
GitHub ; le déploiement est fait par GitHub Actions.

### 1. Côté Cloudflare (compte gratuit)

1. **Espace de stockage KV** : *Storage & Databases* → *Workers KV* → *Create
   instance*, nom `minecarte-sync`. Copie son **ID** (32 caractères).
2. **Token d'API** : icône de profil → *Profile* → *API Tokens* → *Create Token*
   → modèle **« Edit Cloudflare Workers »** → *Account Resources* : ton compte →
   *Continue to summary* → *Create Token*. Copie le token (il ne sera plus
   affiché).
3. **Account ID** : visible sur la page d'accueil du compte ou dans la barre
   latérale de *Workers & Pages* (*Account details*).

Si c'est ton premier Worker, Cloudflare demande de choisir un sous-domaine
`*.workers.dev` (déjà fait si tu as déployé PlusUn).

### 2. Côté GitHub (Settings → Secrets and variables → Actions)

| Type | Nom | Valeur |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | le token de l'étape 1.2 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | l'Account ID de l'étape 1.3 |
| Variable | `CLOUDFLARE_KV_NAMESPACE_ID` | l'ID du KV de l'étape 1.1 |

### 3. Déployer

1. Onglet *Actions* → « Déploiement du worker de synchronisation » → *Run
   workflow*. Le résumé du run affiche l'URL du worker
   (`https://minecarte-sync.<sous-domaine>.workers.dev`).
2. Ajoute la variable `SYNC_WORKER_URL` = cette URL (sans slash final).
3. Relance « Déploiement GitHub Pages » (*Run workflow*) : la section
   « Synchronisation cloud » apparaît dans les Réglages de la carte. Sans
   `SYNC_WORKER_URL`, elle reste masquée.

Ensuite, après chaque CI verte sur `main`, le worker est redéployé s'il a
changé, et le site à chaque fois.

L'origine autorisée à appeler le worker (`ALLOWED_ORIGIN`) est définie dans
`wrangler.toml` : `https://renauddouze.github.io`.

## Développement

```sh
npm run dev    # worker en local (wrangler dev)
```

Les tests du worker (`worker/test/`) tournent avec ceux du site, depuis la
racine du dépôt : `npm test`, couverture et mutation à 100 %.

Pour `npm run dev` ou un déploiement local (`npm run deploy`), remplace
temporairement `__CLOUDFLARE_KV_NAMESPACE_ID__` dans `wrangler.toml` par l'ID du
KV, sans committer ce changement.

## API et stockage

| Requête | Réponse |
| --- | --- |
| `POST /api/sync` | `201 { code }` |
| `GET /api/sync/:code` | `200 { version, data }` ou `404` |
| `PUT /api/sync/:code` avec `{ baseVersion, data }` | `200 { version, data }` ou `409 { version, data }` |
| `PUT /api/sync/:code/blob/:sha256` avec l'image | `201`, `200` (déjà présente), `400` (empreinte fausse), `413` (> 20 Mo), `415` |
| `GET /api/sync/:code/blob/:sha256` | `200` avec l'image ou `404` |

- Une valeur par code, sous la clé `sync:<CODE>` ; `data` contient `seed`, `pois`
  et `paths` (même format que l'export JSON).
- Écriture optimiste : un `PUT` n'est accepté que si `baseVersion` est la version
  stockée, puis la version est incrémentée. Sinon `409` avec l'état serveur :
  l'appli fusionne (POI par POI, chemin par chemin) et repousse. La version est
  un entier attribué par le serveur, jamais une horloge.
- Les images des fonds de carte sont stockées à part, une clé `blob:<CODE>:<sha256>` par image
  (20 Mo max, PNG / JPEG / WebP). Le worker vérifie l'empreinte à l'envoi et ne réécrit pas une
  image déjà présente. `data.backgrounds` ne contient que leurs descriptions ; une image qui n'y
  est plus référencée après une écriture est supprimée.
- Un code inutilisé pendant 180 jours expire (ses images, elles, n'ont pas d'expiration : elles
  sont supprimées quand on retire le fond).
- Aucune protection au-delà du code (~500 milliards de combinaisons) : quiconque
  le connaît peut lire et modifier les données associées.
- Quota du plan gratuit de Cloudflare KV : 1 000 écritures par jour. L'appli
  regroupe les modifications (envoi 1,5 s après la dernière) et ne fait que des
  lectures pour vérifier les changements des autres appareils (toutes les 30 s
  quand la carte est affichée).
