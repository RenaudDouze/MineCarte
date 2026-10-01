/*
 * Fonctions utilitaires pures de l'interface (sans état), testées et soumises
 * au mutation testing séparément de app.js.
 */
(function (global) {
  'use strict';

  const DIM_LABELS = { overworld: 'Overworld', nether: 'Nether', end: 'End' };
  const SWATCHES = [
    '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1',
    '#1e88e5', '#8e24aa', '#d81b60', '#6d4c41', '#ffffff', '#212121',
  ];

  // Centre du bloc (x, z) en coordonnées Leaflet (lng = X, lat = -Z).
  function toLatLng(x, z) {
    return global.L.latLng(-(z + 0.5), x + 0.5);
  }

  // Bloc contenant un point Leaflet.
  function fromLatLng(latlng) {
    return { x: Math.floor(latlng.lng), z: Math.floor(-latlng.lat) };
  }

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  }

  // Petit constructeur d'éléments DOM.
  function h(tag, attrs, ...children) {
    const el = global.document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      el.append(child instanceof global.Node ? child : global.document.createTextNode(String(child)));
    }
    return el;
  }

  // Longueur d'une polyligne en blocs, arrondie.
  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return Math.round(total);
  }

  function fmt(n) {
    return n.toLocaleString('fr-FR');
  }

  // Conversion Overworld <-> Nether (facteur 8) ; null pour l'End.
  function convert(dim, x, z) {
    if (dim === 'overworld') return { dim: 'nether', x: Math.floor(x / 8), z: Math.floor(z / 8) };
    if (dim === 'nether') return { dim: 'overworld', x: x * 8, z: z * 8 };
    return null;
  }

  // Texte comparable : minuscules, sans accents ni espaces autour.
  function normalize(text) {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  // Coordonnées tapées dans la recherche : « X Z » ou « X Y Z » (Y peut être
  // « ~ »), séparées par des espaces, virgules ou points-virgules. Les
  // décimales (copiées de l'écran F3) donnent le bloc qui les contient.
  // Renvoie { x, y, z } (y null si absent) ou null.
  const COORDS_RE = /^(-?\d+(?:\.\d+)?)[\s,;]+(?:(~|-?\d+(?:\.\d+)?)[\s,;]+)?(-?\d+(?:\.\d+)?)$/;
  function parseCoords(text) {
    const m = String(text).trim().match(COORDS_RE);
    if (!m) return null;
    const block = (v) => Math.floor(Number(v));
    return { x: block(m[1]), y: m[2] && m[2] !== '~' ? block(m[2]) : null, z: block(m[3]) };
  }

  // Points d'un chemin saisis à la main : une coordonnée par ligne (« X Z » ou
  // « X Y Z », Y ignoré), lignes vides permises. Renvoie { points, error } :
  // error est null, ou le message de la première ligne illisible.
  function parsePoints(text) {
    const points = [];
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const c = parseCoords(lines[i]);
      if (!c) return { points, error: `Ligne ${i + 1} : « ${lines[i].trim()} » n'est pas une coordonnée (X Z ou X Y Z).` };
      points.push([c.x, c.z]);
    }
    return { points, error: points.length < 2 ? 'Au moins 2 points, un par ligne (X Z ou X Y Z).' : null };
  }

  // Inverse de parsePoints : une ligne « X Z » par point.
  function formatPoints(points) {
    return points.map(([x, z]) => `${x} ${z}`).join('\n');
  }

  // Lieux et chemins dont le nom contient la recherche (sans tenir compte des
  // accents ni de la casse) : ceux dont le nom commence par elle d'abord, puis
  // par ordre alphabétique ; au plus `limit` résultats.
  function searchItems(query, pois, paths, limit) {
    const q = normalize(query);
    if (!q) return [];
    const rank = (item) => (normalize(item.name).startsWith(q) ? 0 : 1);
    const match = (type, list) => list
      .filter((item) => normalize(item.name).includes(q))
      .map((item) => ({ type, item }));
    return [...match('poi', pois), ...match('path', paths)]
      .sort((a, b) => rank(a.item) - rank(b.item) || a.item.name.localeCompare(b.item.name, 'fr'))
      .slice(0, limit);
  }

  // Blocs extrêmes des lieux et des points de chemins d'une dimension :
  // { minX, minZ, maxX, maxZ }, ou null si la dimension est vide.
  function extent(pois, paths, dim) {
    const points = [
      ...pois.filter((p) => p.dim === dim).map((p) => [p.x, p.z]),
      ...paths.filter((p) => p.dim === dim).flatMap((p) => p.points),
    ];
    if (!points.length) return null;
    const xs = points.map((pt) => pt[0]);
    const zs = points.map((pt) => pt[1]);
    return { minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) };
  }

  // Index du segment [i, i+1] d'une polyligne le plus proche d'un point
  // (coordonnées écran), avec la distance point-segment classique.
  function nearestSegment(point, vertices) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < vertices.length - 1; i++) {
      const dist = segmentDistance(point, vertices[i], vertices[i + 1]);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  function segmentDistance(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  global.Utils = { DIM_LABELS, SWATCHES, toLatLng, fromLatLng, esc, h, pathLength, fmt, convert, extent, normalize, parseCoords, parsePoints, formatPoints, searchItems, nearestSegment, segmentDistance };
})(window);
