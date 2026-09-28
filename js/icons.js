/*
 * Icônes d'items Minecraft pour les POI.
 * Les textures (propriété de Mojang) ne sont pas copiées dans le dépôt : elles sont
 * chargées à la demande depuis le paquet npm « minecraft-textures » via jsDelivr.
 */
(function (global) {
  'use strict';

  const VERSION = '26.3';
  const BASE = 'https://cdn.jsdelivr.net/npm/minecraft-textures@26.3.0/dist/textures';

  let items = null;
  let byId = new Map();
  let loading = null;

  // Charge la liste des items (une seule fois). Renvoie une promesse de la liste.
  function load() {
    if (!loading) {
      loading = fetch(`${BASE}/manifest/${VERSION}.json`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((manifest) => {
          items = manifest.items;
          byId = new Map(items.map((item) => [item.id, item]));
          return items;
        });
      loading.catch(() => { loading = null; });
    }
    return loading;
  }

  function url(id) {
    const item = byId.get(id);
    return item ? `${BASE}/assets/${item.texture}` : null;
  }

  function name(id) {
    const item = byId.get(id);
    return item ? item.readable : String(id || '').replace(/^minecraft:/, '').replace(/_/g, ' ');
  }

  // Recherche sur le nom anglais et l'identifiant (ex. « diamond », « totem »).
  function search(query, limit) {
    if (!items) return [];
    // Les segments vides (espaces multiples) valent « tout » : inutile de les filtrer.
    const words = query.toLowerCase().split(/\s/);
    const out = [];
    for (const item of items) {
      const hay = `${item.readable} ${item.id}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) {
        out.push(item);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  global.Icons = { load, url, name, search, isLoaded: () => !!items };
})(window);
