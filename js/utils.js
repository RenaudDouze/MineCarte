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

  global.Utils = { DIM_LABELS, SWATCHES, toLatLng, fromLatLng, esc, h, pathLength, fmt, convert, nearestSegment, segmentDistance };
})(window);
