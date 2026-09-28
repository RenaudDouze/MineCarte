// Leaflet (UMD) exécuté comme par une balise <script> : il définit window.L.
// (Un import passerait par Vite, qui cherche une source map absente du paquet.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';

export function loadLeaflet() {
  if (!window.L) runInThisContext(readFileSync(join(import.meta.dirname, '../../vendor/leaflet/leaflet.js'), 'utf8'));
}
