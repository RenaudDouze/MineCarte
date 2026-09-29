/*
 * Données de la carte : POI, liens entre POI et chemins.
 * Persistées dans le localStorage, importables / exportables en JSON.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'minecarte:data';
  const DIMENSIONS = ['overworld', 'nether', 'end'];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function int(value, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : fallback;
  }

  function color(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  }

  function icon(value) {
    return typeof value === 'string' && /^minecraft:[a-z0-9_]+$/.test(value) ? value : '';
  }

  function weight(value) {
    return Math.min(16, Math.max(1, int(value, 4)));
  }

  // Éléments objets d'une liste (tableau attendu) ; [] sinon.
  function objects(value) {
    return Array.isArray(value) ? value.filter((v) => v && typeof v === 'object') : [];
  }

  // Catégories de lieux ; « » (chaîne vide) = sans catégorie.
  const CATEGORIES = [
    { id: 'base', emoji: '🏠', label: 'Base' },
    { id: 'farm', emoji: '🌾', label: 'Ferme' },
    { id: 'portal', emoji: '🌀', label: 'Portail' },
    { id: 'village', emoji: '🏘️', label: 'Village' },
    { id: 'mine', emoji: '⛏️', label: 'Mine' },
    { id: 'structure', emoji: '🏛️', label: 'Structure' },
    { id: 'resource', emoji: '💎', label: 'Ressource' },
  ];

  function category(value) {
    return CATEGORIES.some((c) => c.id === value) ? value : '';
  }

  function dimension(value) {
    return DIMENSIONS.includes(value) ? value : 'overworld';
  }

  function emptyData() {
    return { version: 1, seed: 'minecarte', pois: [], paths: [] };
  }

  // Nettoie des données venant du localStorage ou d'un import.
  function sanitize(raw) {
    const data = emptyData();
    if (raw == null) return data;
    if (raw.seed != null) data.seed = String(raw.seed);

    const ids = new Set();
    const rawLinks = new Map();
    for (const p of objects(raw.pois)) {
      const id = typeof p.id === 'string' && p.id && !ids.has(p.id) ? p.id : uid();
      ids.add(id);
      data.pois.push({
        id,
        name: String(p.name || 'Lieu').slice(0, 100),
        color: color(p.color, '#e53935'),
        dim: dimension(p.dim),
        x: int(p.x, 0),
        y: int(p.y, 64),
        z: int(p.z, 0),
        icon: icon(p.icon),
        category: category(p.category),
      });
      rawLinks.set(id, p.links);
    }
    // Liens valides et symétriques uniquement.
    for (const p of data.pois) {
      const links = rawLinks.get(p.id);
      p.links = Array.isArray(links) ? [...new Set(links)].filter((l) => l !== p.id && ids.has(l)) : [];
    }
    for (const p of data.pois) {
      for (const l of p.links) {
        const other = data.pois.find((o) => o.id === l);
        if (!other.links.includes(p.id)) other.links.push(p.id);
      }
    }

    for (const path of objects(raw.paths)) {
      if (!Array.isArray(path.points)) continue;
      const points = path.points
        .filter((pt) => Array.isArray(pt) && pt.length >= 2)
        .map((pt) => [int(pt[0], 0), int(pt[1], 0)]);
      if (points.length < 2) continue;
      data.paths.push({
        id: typeof path.id === 'string' && path.id ? path.id : uid(),
        name: String(path.name || 'Chemin').slice(0, 100),
        color: color(path.color, '#ffeb3b'),
        dim: dimension(path.dim),
        weight: weight(path.weight),
        points,
      });
    }

    return data;
  }

  class Store {
    // persist: false → données en mémoire seulement (carte partagée en lecture
    // seule : rien n'est lu ni écrit dans le stockage du navigateur).
    constructor({ persist = true } = {}) {
      this.listeners = [];
      this.persist = persist;
      this.data = persist ? this.load() : emptyData();
    }

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? sanitize(JSON.parse(raw)) : emptyData();
      } catch (e) {
        console.warn('Impossible de lire les données sauvegardées', e);
        return emptyData();
      }
    }

    // source : 'remote' quand la modification vient de la synchronisation cloud.
    save(source) {
      try {
        if (this.persist) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.warn('Impossible de sauvegarder les données', e);
      }
      this.listeners.forEach((fn) => fn(this.data, source));
    }

    onChange(fn) {
      this.listeners.push(fn);
    }

    // --- POI -------------------------------------------------------------

    getPoi(id) {
      return this.data.pois.find((p) => p.id === id);
    }

    savePoi(input) {
      let poi = input.id && this.getPoi(input.id);
      if (!poi) {
        poi = { id: uid() };
        this.data.pois.push(poi);
      }
      poi.name = String(input.name ?? '').trim().slice(0, 100) || 'Lieu';
      poi.color = color(input.color, '#e53935');
      poi.dim = dimension(input.dim);
      poi.x = int(input.x, 0);
      poi.y = int(input.y, 64);
      poi.z = int(input.z, 0);
      poi.icon = icon(input.icon);
      poi.category = category(input.category);

      const wanted = new Set(Array.isArray(input.links) ? input.links.filter((l) => l !== poi.id && this.getPoi(l)) : []);
      for (const other of this.data.pois) {
        if (other === poi) continue;
        const linked = other.links.includes(poi.id);
        if (wanted.has(other.id) && !linked) other.links.push(poi.id);
        if (!wanted.has(other.id) && linked) other.links = other.links.filter((l) => l !== poi.id);
      }
      poi.links = [...wanted];
      this.save();
      return poi;
    }

    deletePoi(id) {
      this.data.pois = this.data.pois.filter((p) => p.id !== id);
      for (const p of this.data.pois) p.links = p.links.filter((l) => l !== id);
      this.save();
    }

    // --- Chemins -----------------------------------------------------------

    getPath(id) {
      return this.data.paths.find((p) => p.id === id);
    }

    savePath(input) {
      let path = input.id && this.getPath(input.id);
      if (!path) {
        path = { id: uid() };
        this.data.paths.push(path);
      }
      path.name = String(input.name ?? '').trim().slice(0, 100) || 'Chemin';
      path.color = color(input.color, '#ffeb3b');
      path.dim = dimension(input.dim);
      path.weight = weight(input.weight);
      if (input.points) path.points = input.points.map((pt) => [int(pt[0], 0), int(pt[1], 0)]);
      this.save();
      return path;
    }

    deletePath(id) {
      this.data.paths = this.data.paths.filter((p) => p.id !== id);
      this.save();
    }

    // --- Divers ------------------------------------------------------------

    replaceAll(raw, source) {
      this.data = sanitize(raw);
      this.save(source);
    }

    exportJson() {
      return JSON.stringify(this.data, null, 2);
    }
  }

  global.Store = Store;
  global.Store.CATEGORIES = CATEGORIES;
  global.DIMENSIONS = DIMENSIONS;
})(window);
