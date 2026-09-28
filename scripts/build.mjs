// Construit le site statique publié sur GitHub Pages (dossier _site par défaut).
// SYNC_WORKER_URL (variable de dépôt) : adresse du worker de synchronisation ;
// absente, la synchronisation cloud est masquée dans le site.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] || '_site';
const syncUrl = (process.env.SYNC_WORKER_URL || '').trim().replace(/\/+$/, '');
if (syncUrl && !/^https:\/\/[^\s/]+$/.test(syncUrl)) {
  console.error(`SYNC_WORKER_URL invalide : « ${syncUrl} » (attendu : https://hôte, sans chemin).`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const entry of ['index.html', 'css', 'js', 'vendor']) cpSync(entry, join(out, entry), { recursive: true });
writeFileSync(join(out, '.nojekyll'), '');
writeFileSync(join(out, 'js/config.js'), [
  '// Généré par scripts/build.mjs.',
  `window.MINECARTE_CONFIG = Object.assign(${JSON.stringify({ syncUrl })}, window.MINECARTE_CONFIG);`,
  '',
].join('\n'));
console.log(`Site construit dans ${out}/ (synchronisation ${syncUrl ? `: ${syncUrl}` : 'désactivée'}).`);
