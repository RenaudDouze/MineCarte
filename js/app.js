/*
 * MineCarte — interface : carte Leaflet, POI, liens et chemins.
 */
(function () {
  'use strict';

  const { DIM_LABELS, SWATCHES, toLatLng, fromLatLng, esc, h, pathLength, fmt, convert, nearestSegment } = Utils;
  const OPTIONS_KEY = 'minecarte:options';

  const store = new Store();
  /** @type {(sel: string) => any} */
  const $ = (sel) => document.querySelector(sel);
  /** @type {(sel: string) => HTMLElement[]} */
  const $$ = (sel) => /** @type {HTMLElement[]} */ ([...document.querySelectorAll(sel)]);

  const state = {
    dim: null,
    views: {
      overworld: { center: L.latLng(0, 0), zoom: 0 },
      nether: { center: L.latLng(0, 0), zoom: 1 },
      end: { center: L.latLng(0, 0), zoom: 1 },
    },
    mode: null, // null | 'draw' | 'edit'
    draw: null,
    edit: null,
    markers: new Map(),
    options: loadOptions(),
  };

  // --- Utilitaires -----------------------------------------------------------

  function loadOptions() {
    const defaults = { grid: true, labels: true, links: true, allDims: false };
    try {
      return Object.assign(defaults, JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}'));
    } catch {
      return defaults;
    }
  }

  function saveOptions() {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(state.options));
    } catch {
      /* stockage indisponible : on ignore */
    }
  }

  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function copy(text) {
    const done = () => toast(`Copié : ${text}`);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => prompt('Copier :', text));
    } else {
      prompt('Copier :', text);
    }
  }

  // --- Carte -------------------------------------------------------------------

  const map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -6,
    maxZoom: 5,
    zoomSnap: 1,
    attributionControl: false,
    boxZoom: false,
  });
  map.createPane('imagePane').style.zIndex = '220';
  map.createPane('gridPane').style.zIndex = '250';
  map.createPane('linkPane').style.zIndex = '390';
  map.createPane('pathPane').style.zIndex = '395';

  const terrainLayers = {};
  function terrainLayer(dim) {
    if (!terrainLayers[dim]) terrainLayers[dim] = new Terrain.TerrainLayer({ dimension: dim });
    return terrainLayers[dim];
  }
  const gridLayer = new Terrain.GridOverlay();

  const linkLayer = L.layerGroup().addTo(map);
  const pathLayer = L.layerGroup().addTo(map);
  const poiLayer = L.layerGroup().addTo(map);
  const drawLayer = L.layerGroup().addTo(map);

  function applyLayers() {
    const current = terrainLayer(state.dim);
    for (const layer of Object.values(terrainLayers)) {
      if (layer !== current && map.hasLayer(layer)) map.removeLayer(layer);
    }
    if (!map.hasLayer(current)) current.addTo(map);
    if (state.options.grid && !map.hasLayer(gridLayer)) gridLayer.addTo(map);
    if (!state.options.grid && map.hasLayer(gridLayer)) map.removeLayer(gridLayer);
    map.getContainer().style.background = Terrain.background[state.dim];
    map.getContainer().classList.toggle('hide-labels', !state.options.labels);
    renderBackgrounds();
  }

  function setDimension(dim, view) {
    if (dim === state.dim && !view) return;
    cancelMode();
    map.closePopup();
    if (state.dim) state.views[state.dim] = { center: map.getCenter(), zoom: map.getZoom() };
    state.dim = dim;
    document.body.dataset.dim = dim;
    $$('.dim-btn').forEach((b) => b.classList.toggle('active', b.dataset.dim === dim));
    applyLayers();
    const v = view || state.views[dim];
    map.setView(v.center, v.zoom, { animate: false });
    render();
    updateHash();
    updateCoords(map.getCenter());
  }

  // --- Rendu des POI, liens et chemins ---------------------------------------------

  function poiIcon(poi) {
    const src = poi.icon && Icons.url(poi.icon);
    const pin = src
      ? `<span class="poi-pin poi-pin-item" style="border-color:${poi.color}"><img src="${src}" alt=""></span>`
      : `<span class="poi-pin" style="background:${poi.color}"></span>`;
    return L.divIcon({
      className: 'poi-icon',
      iconSize: null,
      html: `${pin}<span class="poi-label">${esc(poi.name)}</span>`,
    });
  }

  // Pastille d'un POI dans les listes et popups : son icône d'item, sinon sa couleur.
  function poiDot(poi) {
    const src = poi.icon && Icons.url(poi.icon);
    return src
      ? h('span', { class: 'dot dot-item', style: `border-color:${poi.color}` }, h('img', { src, alt: '' }))
      : h('span', { class: 'dot', style: `background:${poi.color}` });
  }

  function render() {
    poiLayer.clearLayers();
    linkLayer.clearLayers();
    pathLayer.clearLayers();
    state.markers.clear();

    const pois = store.data.pois.filter((p) => p.dim === state.dim);
    for (const poi of pois) {
      const marker = L.marker(toLatLng(poi.x, poi.z), {
        icon: poiIcon(poi),
        title: `${poi.name} (${poi.x}, ${poi.y}, ${poi.z})`,
        riseOnHover: true,
      });
      marker.on('click', () => {
        if (state.mode === 'draw') addDrawPoint(poi.x, poi.z);
        else if (!state.mode) openPoiPopup(poi);
      });
      marker.addTo(poiLayer);
      state.markers.set(poi.id, marker);
    }

    if (state.options.links) {
      for (const poi of pois) {
        for (const id of poi.links) {
          const other = store.getPoi(id);
          if (!other || other.dim !== state.dim || other.id < poi.id) continue;
          L.polyline([toLatLng(poi.x, poi.z), toLatLng(other.x, other.z)], {
            pane: 'linkPane',
            color: '#ffffff',
            weight: 2,
            opacity: 0.7,
            dashArray: '4 6',
            interactive: false,
          }).addTo(linkLayer);
        }
      }
    }

    for (const path of store.data.paths) {
      if (path.dim !== state.dim) continue;
      if ((state.draw && state.draw.pathId === path.id) || (state.edit && state.edit.pathId === path.id)) continue;
      const latlngs = path.points.map(([x, z]) => toLatLng(x, z));
      L.polyline(latlngs, { pane: 'pathPane', color: '#000', weight: path.weight + 3, opacity: 0.35, interactive: false })
        .addTo(pathLayer);
      const line = L.polyline(latlngs, { pane: 'pathPane', color: path.color, weight: path.weight, opacity: 0.95 });
      line.on('click', (e) => {
        if (state.mode) return;
        openPathPopup(path, e.latlng);
      });
      line.bindTooltip(esc(path.name), { sticky: true });
      line.addTo(pathLayer);
    }

    renderLists();
  }

  function dimBadge(dim) {
    return h('span', { class: `badge badge-${dim}` }, DIM_LABELS[dim]);
  }

  function renderLists() {
    const query = $('#poi-search').value.trim().toLowerCase();
    const allDims = state.options.allDims;
    const pois = store.data.pois
      .filter((p) => (allDims || p.dim === state.dim) && p.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    const poiList = $('#poi-list');
    poiList.replaceChildren(...pois.map((poi) => h('li', { class: 'item', onclick: () => focusPoi(poi.id) },
      poiDot(poi),
      h('span', { class: 'item-main' },
        h('span', { class: 'item-name' }, poi.name),
        h('span', { class: 'item-sub' }, `X ${poi.x} · Y ${poi.y} · Z ${poi.z}`)),
      allDims && poi.dim !== state.dim ? dimBadge(poi.dim) : null,
      poi.links.length ? h('span', { class: 'item-links', title: 'Liens' }, `🔗 ${poi.links.length}`) : null)));
    if (!pois.length) {
      poiList.append(h('li', { class: 'empty' }, query ? 'Aucun résultat.' : 'Aucun POI. Clic droit sur la carte ou « + POI ».'));
    }

    const paths = store.data.paths.filter((p) => p.dim === state.dim);
    const pathList = $('#path-list');
    pathList.replaceChildren(...paths.map((path) => h('li', { class: 'item', onclick: () => focusPath(path.id) },
      h('span', { class: 'swatch-line', style: `background:${path.color}` }),
      h('span', { class: 'item-main' },
        h('span', { class: 'item-name' }, path.name),
        h('span', { class: 'item-sub' }, `${fmt(pathLength(path.points))} blocs · ${path.points.length} points`)))));
    if (!paths.length) {
      pathList.append(h('li', { class: 'empty' }, 'Aucun chemin dans cette dimension. Clic droit sur la carte ou « + Tracer un chemin ».'));
    }
  }

  // --- POI : popup, navigation, dialogue ------------------------------------------

  function openPoiPopup(poi) {
    const conv = convert(poi.dim, poi.x, poi.z);
    const links = poi.links.map((id) => store.getPoi(id)).filter(Boolean);

    const content = h('div', { class: 'poi-popup' },
      h('div', { class: 'popup-title' },
        poiDot(poi), poi.name),
      h('div', { class: 'popup-coords' },
        h('span', {}, `X ${poi.x}`), h('span', { class: 'y', title: 'Hauteur (information)' }, `Y ${poi.y}`), h('span', {}, `Z ${poi.z}`)),
      conv ? h('div', { class: 'popup-sub' }, `≈ ${DIM_LABELS[conv.dim]} : X ${conv.x}, Z ${conv.z}`) : null,
      links.length ? h('div', { class: 'popup-links' },
        h('div', { class: 'popup-label' }, 'Liens'),
        links.map((other) => h('button', {
          type: 'button',
          class: 'link-btn',
          title: `Aller à ${other.name}`,
          onclick: () => focusPoi(other.id),
        },
        poiDot(other),
        h('span', { class: 'link-name' }, other.name),
        other.dim !== poi.dim ? dimBadge(other.dim) : null,
        h('span', { class: 'arrow' }, '➜')))) : null,
      h('div', { class: 'popup-actions' },
        h('button', { type: 'button', onclick: () => openPoiDialog(poi) }, 'Modifier'),
        conv ? h('button', {
          type: 'button',
          title: `Créer un POI lié dans ${conv.dim === 'nether' ? 'le Nether' : "l'Overworld"} aux coordonnées converties`,
          onclick: () => openPoiDialog({
            name: `${poi.name} (${DIM_LABELS[conv.dim]})`,
            color: poi.color,
            icon: poi.icon,
            dim: conv.dim,
            x: conv.x,
            y: poi.y,
            z: conv.z,
            links: [poi.id],
          }),
        }, `Portail ${DIM_LABELS[conv.dim]}`) : null,
        h('button', { type: 'button', onclick: () => copy(`${poi.x} ${poi.y} ${poi.z}`) }, 'Copier'),
        h('button', {
          type: 'button',
          class: 'danger',
          onclick: () => {
            if (confirm(`Supprimer le POI « ${poi.name} » ?`)) {
              map.closePopup();
              store.deletePoi(poi.id);
            }
          },
        }, 'Supprimer')));

    L.popup({ offset: [0, -4], minWidth: 220, maxWidth: 320 })
      .setLatLng(toLatLng(poi.x, poi.z))
      .setContent(content)
      .openOn(map);
  }

  function highlight(id) {
    const marker = state.markers.get(id);
    const el = marker && marker.getElement();
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  function focusPoi(id) {
    const poi = store.getPoi(id);
    if (!poi) return;
    const latlng = toLatLng(poi.x, poi.z);
    const zoom = Math.max(map.getZoom(), 0);
    const done = () => {
      openPoiPopup(poi);
      highlight(poi.id);
    };
    if (poi.dim !== state.dim) {
      setDimension(poi.dim, { center: latlng, zoom });
      done();
    } else if (map.getBounds().contains(latlng)) {
      done();
    } else if (map.getBounds().pad(3).contains(latlng)) {
      map.once('moveend', done);
      map.flyTo(latlng, zoom, { duration: 0.6 });
    } else {
      map.setView(latlng, zoom, { animate: false });
      done();
    }
    closeSidebarOnMobile();
  }

  function fillSwatches() {
    $$('.swatches').forEach((box) => {
      const input = /** @type {HTMLInputElement} */ (box.closest('form').elements[box.dataset.target]);
      box.replaceChildren(...SWATCHES.map((c) => h('button', {
        type: 'button',
        class: 'swatch',
        style: `background:${c}`,
        title: c,
        onclick: () => { input.value = c; },
      })));
    });
  }

  function renderLinkPicker(selected, selfId) {
    const filter = $('#poi-link-filter').value.trim().toLowerCase();
    const box = $('#poi-links');
    const others = store.data.pois
      .filter((p) => p.id !== selfId)
      .sort((a, b) => DIMENSIONS.indexOf(a.dim) - DIMENSIONS.indexOf(b.dim) || a.name.localeCompare(b.name, 'fr'));
    box.replaceChildren(...others
      .filter((p) => selected.has(p.id) || p.name.toLowerCase().includes(filter))
      .map((p) => h('label', { class: 'link-option' },
        h('input', {
          type: 'checkbox',
          value: p.id,
          checked: selected.has(p.id),
          onchange: (e) => (e.target.checked ? selected.add(p.id) : selected.delete(p.id)),
        }),
        poiDot(p),
        h('span', { class: 'link-name' }, p.name),
        h('span', { class: 'item-sub' }, `${p.x}, ${p.z}`),
        dimBadge(p.dim))));
    if (!others.length) box.append(h('p', { class: 'hint' }, 'Aucun autre POI pour le moment.'));
  }

  let poiDialogLinks = new Set();
  function openPoiDialog(poi) {
    const form = $('#poi-form');
    const center = fromLatLng(map.getCenter());
    const data = Object.assign({ name: '', color: '#e53935', icon: '', dim: state.dim, x: center.x, y: 64, z: center.z, links: [] }, poi);
    $('#poi-dialog-title').textContent = data.id ? 'Modifier le POI' : 'Nouveau POI';
    form.elements.id.value = data.id || '';
    form.elements.label.value = data.name;
    form.elements.color.value = data.color;
    form.elements.dim.value = data.dim;
    form.elements.x.value = data.x;
    form.elements.y.value = data.y;
    form.elements.z.value = data.z;
    setPoiIcon(data.icon);
    $('#icon-picker').hidden = true;
    $('#poi-link-filter').value = '';
    poiDialogLinks = new Set(data.links);
    renderLinkPicker(poiDialogLinks, data.id);
    $('#poi-dialog').showModal();
    form.elements.label.focus();
    form.elements.label.select();
  }

  $('#poi-link-filter').addEventListener('input', () => {
    renderLinkPicker(poiDialogLinks, $('#poi-form').elements.id.value);
  });

  // --- Choix de l'icône d'item -------------------------------------------------

  function setPoiIcon(id) {
    $('#poi-form').elements.icon.value = id || '';
    const preview = $('#icon-current');
    const src = id && Icons.url(id);
    preview.replaceChildren(
      src ? h('img', { src, alt: '' }) : h('span', { class: 'icon-none' }, '—'),
      h('span', {}, id ? Icons.name(id) : 'Aucune (pastille de couleur)'));
    $('#icon-clear').hidden = !id;
  }

  function renderIconGrid() {
    const grid = $('#icon-grid');
    const results = Icons.search($('#icon-search').value, 160);
    const current = $('#poi-form').elements.icon.value;
    grid.replaceChildren(...results.map((item) => h('button', {
      type: 'button',
      class: `icon-cell${item.id === current ? ' selected' : ''}`,
      title: `${item.readable} (${item.id})`,
      onclick: () => {
        setPoiIcon(item.id);
        $('#icon-picker').hidden = true;
      },
    }, h('img', { src: Icons.url(item.id), alt: item.readable, loading: 'lazy' }))));
    if (!results.length) grid.append(h('p', { class: 'hint' }, 'Aucun item trouvé (recherche en anglais : diamond, totem, bed…).'));
  }

  $('#icon-choose').addEventListener('click', () => {
    const picker = $('#icon-picker');
    picker.hidden = !picker.hidden;
    if (picker.hidden) return;
    $('#icon-search').focus();
    if (Icons.isLoaded()) {
      renderIconGrid();
      return;
    }
    $('#icon-grid').replaceChildren(h('p', { class: 'hint' }, 'Chargement des icônes…'));
    Icons.load().then(renderIconGrid, () => {
      $('#icon-grid').replaceChildren(h('p', { class: 'hint' }, 'Impossible de charger les icônes (connexion internet requise).'));
    });
  });
  $('#icon-search').addEventListener('input', () => { if (Icons.isLoaded()) renderIconGrid(); });
  $('#icon-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  $('#icon-clear').addEventListener('click', () => setPoiIcon(''));

  function updateWeightPreview() {
    const f = $('#path-form').elements;
    $('#weight-value').textContent = `${f.weight.value} px`;
    $('#weight-preview').style.cssText = `height:${f.weight.value}px;background:${f.color.value}`;
  }
  $('#path-form').elements.weight.addEventListener('input', updateWeightPreview);
  $('#path-form').elements.color.addEventListener('input', updateWeightPreview);
  $('#path-form').querySelector('.swatches').addEventListener('click', () => setTimeout(updateWeightPreview));

  $('#poi-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const poi = store.savePoi({
      id: f.id.value || null,
      name: f.label.value,
      color: f.color.value,
      dim: f.dim.value,
      x: f.x.value,
      y: f.y.value,
      z: f.z.value,
      icon: f.icon.value,
      links: [...poiDialogLinks],
    });
    $('#poi-dialog').close();
    focusPoi(poi.id);
  });

  // --- Chemins : popup, dialogue ---------------------------------------------------

  function openPathPopup(path, latlng) {
    const length = pathLength(path.points);
    const content = h('div', { class: 'path-popup' },
      h('div', { class: 'popup-title' },
        h('span', { class: 'swatch-line', style: `background:${path.color}` }), path.name),
      h('div', { class: 'popup-sub' }, `${fmt(length)} blocs · ${path.points.length} points`),
      path.dim === 'nether' ? h('div', { class: 'popup-sub' }, `≈ ${fmt(length * 8)} blocs dans l'Overworld`) : null,
      h('div', { class: 'popup-actions' },
        h('button', { type: 'button', onclick: () => { map.closePopup(); openPathDialog(path); } }, 'Modifier'),
        h('button', { type: 'button', onclick: () => { map.closePopup(); startEditing(path.id); } }, 'Éditer le tracé'),
        h('button', { type: 'button', onclick: () => { map.closePopup(); startDrawing({ pathId: path.id }); } }, 'Prolonger'),
        h('button', {
          type: 'button',
          class: 'danger',
          onclick: () => {
            if (confirm(`Supprimer le chemin « ${path.name} » ?`)) {
              map.closePopup();
              store.deletePath(path.id);
            }
          },
        }, 'Supprimer')));
    L.popup({ minWidth: 220 }).setLatLng(latlng).setContent(content).openOn(map);
  }

  // Appelé depuis la liste, qui ne montre que les chemins de la dimension affichée.
  function focusPath(id) {
    const path = store.getPath(id);
    const bounds = L.latLngBounds(path.points.map(([x, z]) => toLatLng(x, z)));
    map.fitBounds(bounds.pad(0.2), { maxZoom: 2, animate: false });
    const mid = path.points[Math.floor(path.points.length / 2)];
    openPathPopup(path, toLatLng(mid[0], mid[1]));
    closeSidebarOnMobile();
  }

  function openPathDialog(path) {
    const form = $('#path-form');
    form.elements.id.value = path.id;
    form.elements.label.value = path.name;
    form.elements.color.value = path.color;
    form.elements.weight.value = path.weight;
    updateWeightPreview();
    $('#path-info').textContent = `${DIM_LABELS[path.dim]} · ${fmt(pathLength(path.points))} blocs · ${path.points.length} points`;
    $('#path-dialog').showModal();
    form.elements.label.focus();
    form.elements.label.select();
  }

  $('#path-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const path = store.getPath(f.id.value);
    if (path) store.savePath(Object.assign({}, path, { name: f.label.value, color: f.color.value, weight: f.weight.value }));
    $('#path-dialog').close();
  });

  document.querySelectorAll('dialog [data-close]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  });

  // --- Modes tracé / édition ------------------------------------------------------

  function nextPathColor() {
    return SWATCHES[store.data.paths.length % 8];
  }

  function startDrawing({ pathId = null, start = null } = {}) {
    cancelMode();
    map.closePopup();
    const existing = pathId && store.getPath(pathId);
    const color = existing ? existing.color : nextPathColor();
    const weight = existing ? existing.weight : 4;
    state.mode = 'draw';
    state.draw = {
      pathId: existing ? existing.id : null,
      points: existing ? existing.points.map((p) => p.slice()) : [],
      color,
      line: L.polyline([], { pane: 'pathPane', color, weight, interactive: false }).addTo(drawLayer),
      preview: L.polyline([], { pane: 'pathPane', color, weight: 2, dashArray: '6 6', interactive: false }).addTo(drawLayer),
      vertices: L.layerGroup().addTo(drawLayer),
    };
    if (start) state.draw.points.push([start.x, start.z]);
    map.doubleClickZoom.disable();
    map.getContainer().classList.add('drawing');
    updateDraw();
    render();
  }

  function addDrawPoint(x, z) {
    const pts = state.draw.points;
    const last = pts[pts.length - 1];
    if (last && last[0] === x && last[1] === z) return;
    pts.push([x, z]);
    updateDraw();
  }

  function undoDrawPoint() {
    if (state.mode !== 'draw') return;
    state.draw.points.pop();
    state.draw.preview.setLatLngs([]);
    updateDraw();
  }

  function updateDraw() {
    const d = state.draw;
    const latlngs = d.points.map(([x, z]) => toLatLng(x, z));
    d.line.setLatLngs(latlngs);
    d.vertices.clearLayers();
    latlngs.forEach((ll) => L.circleMarker(ll, {
      pane: 'pathPane', radius: 4, color: '#fff', weight: 2, fillColor: d.color, fillOpacity: 1, interactive: false,
    }).addTo(d.vertices));
    showBanner(`Tracé${d.pathId ? ' (prolongement)' : ''} — ${d.points.length} point(s), ${fmt(pathLength(d.points))} blocs. ` +
      'Clic : ajouter · clic sur un POI : s’y accrocher · double-clic / Entrée : terminer', true);
  }

  function finishDrawing() {
    const d = state.draw;
    if (d.points.length < 2) {
      toast('Un chemin doit avoir au moins 2 points.');
      return;
    }
    const points = d.points;
    const existing = d.pathId && store.getPath(d.pathId);
    endMode();
    if (existing) {
      store.savePath(Object.assign({}, existing, { points }));
    } else {
      const path = store.savePath({
        name: `Chemin ${store.data.paths.length + 1}`,
        color: d.color,
        dim: state.dim,
        points,
      });
      openPathDialog(path);
    }
  }

  const vertexIcon = L.divIcon({ className: 'vertex-icon', iconSize: [12, 12] });

  function startEditing(pathId) {
    cancelMode();
    const path = store.getPath(pathId);
    if (!path) return;
    state.mode = 'edit';
    state.edit = {
      pathId,
      name: path.name,
      points: path.points.map((p) => p.slice()),
      line: L.polyline([], { pane: 'pathPane', color: path.color, weight: Math.max(path.weight + 2, 6) }).addTo(drawLayer),
      vertices: L.layerGroup().addTo(drawLayer),
    };
    state.edit.line.on('click', (e) => {
      L.DomEvent.stop(e);
      insertEditPoint(e.latlng);
    });
    map.getContainer().classList.add('editing');
    rebuildEdit();
    render();
  }

  function rebuildEdit() {
    const ed = state.edit;
    ed.line.setLatLngs(ed.points.map(([x, z]) => toLatLng(x, z)));
    ed.vertices.clearLayers();
    ed.points.forEach(([x, z], i) => {
      const m = L.marker(toLatLng(x, z), { icon: vertexIcon, draggable: true, zIndexOffset: 1000 });
      m.on('drag', (e) => {
        const p = fromLatLng(e.target.getLatLng());
        ed.points[i] = [p.x, p.z];
        ed.line.setLatLngs(ed.points.map(([px, pz]) => toLatLng(px, pz)));
        updateCoords(e.target.getLatLng());
      });
      m.on('dragend', () => rebuildEdit());
      m.on('contextmenu', (e) => {
        L.DomEvent.stop(e);
        if (ed.points.length <= 2) {
          toast('Un chemin doit garder au moins 2 points.');
          return;
        }
        ed.points.splice(i, 1);
        rebuildEdit();
      });
      m.addTo(ed.vertices);
    });
    showBanner(`Édition de « ${ed.name} » — ${ed.points.length} points, ${fmt(pathLength(ed.points))} blocs. ` +
      'Glisser : déplacer · clic sur un segment : insérer · clic droit sur un sommet : supprimer', false);
  }

  function insertEditPoint(latlng) {
    const ed = state.edit;
    const vertices = ed.points.map(([x, z]) => map.latLngToLayerPoint(toLatLng(x, z)));
    const best = nearestSegment(map.latLngToLayerPoint(latlng), vertices);
    const pt = fromLatLng(latlng);
    ed.points.splice(best + 1, 0, [pt.x, pt.z]);
    rebuildEdit();
  }

  function finishEditing() {
    const ed = state.edit;
    const path = store.getPath(ed.pathId);
    const points = ed.points;
    endMode();
    if (path) store.savePath(Object.assign({}, path, { points }));
  }

  function finishMode() {
    if (state.mode === 'draw') finishDrawing();
    else if (state.mode === 'edit') finishEditing();
  }

  function endMode() {
    drawLayer.clearLayers();
    state.mode = null;
    state.draw = null;
    state.edit = null;
    map.doubleClickZoom.enable();
    map.getContainer().classList.remove('drawing', 'editing');
    $('#mode-banner').hidden = true;
  }

  function cancelMode() {
    if (!state.mode) return;
    endMode();
    render();
  }

  function showBanner(text, canUndo) {
    $('#mode-text').textContent = text;
    $('#mode-undo').hidden = !canUndo;
    $('#mode-banner').hidden = false;
  }

  $('#mode-undo').addEventListener('click', undoDrawPoint);
  $('#mode-finish').addEventListener('click', finishMode);
  $('#mode-cancel').addEventListener('click', cancelMode);

  // --- Événements carte -----------------------------------------------------------

  function updateCoords(latlng) {
    const { x, z } = fromLatLng(latlng);
    const conv = convert(state.dim, x, z);
    $('#coords').textContent = `X ${x}  Z ${z}  ·  Chunk ${x >> 4}, ${z >> 4}  ·  Région r.${x >> 9}.${z >> 9}` +
      (conv ? `  ·  ${DIM_LABELS[conv.dim]} ≈ ${conv.x}, ${conv.z}` : '');
  }

  map.on('mousemove', (e) => {
    updateCoords(e.latlng);
    if (state.mode === 'draw' && state.draw.points.length) {
      const last = state.draw.points[state.draw.points.length - 1];
      state.draw.preview.setLatLngs([toLatLng(last[0], last[1]), e.latlng]);
    }
  });

  map.on('click', (e) => {
    hideContextMenu();
    if (state.mode === 'draw') {
      const { x, z } = fromLatLng(e.latlng);
      addDrawPoint(x, z);
    }
  });

  map.on('dblclick', () => {
    if (state.mode === 'draw') finishDrawing();
  });

  map.on('contextmenu', (e) => {
    if (state.mode) return;
    showContextMenu(e);
  });

  map.on('movestart zoomstart', hideContextMenu);
  map.on('moveend', updateHash);

  // --- Menu contextuel ----------------------------------------------------------------

  function showContextMenu(e) {
    const { x, z } = fromLatLng(e.latlng);
    const menu = $('#context-menu');
    const item = (label, fn) => h('button', { type: 'button', onclick: () => { hideContextMenu(); fn(); } }, label);
    menu.replaceChildren(
      h('div', { class: 'menu-title' }, `X ${x} · Z ${z}`),
      item('📍 Ajouter un POI ici', () => openPoiDialog({ x, z })),
      item('〰 Commencer un chemin ici', () => startDrawing({ start: { x, z } })),
      item('📋 Copier les coordonnées', () => copy(`${x} ~ ${z}`)),
      item('🎯 Centrer ici', () => map.panTo(e.latlng)));
    menu.hidden = false;
    const left = Math.min(e.originalEvent.clientX, window.innerWidth - menu.offsetWidth - 4);
    const top = Math.min(e.originalEvent.clientY, window.innerHeight - menu.offsetHeight - 4);
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, top)}px`;
  }

  function hideContextMenu() {
    $('#context-menu').hidden = true;
  }

  document.addEventListener('click', (e) => {
    const target = /** @type {Element} */ (e.target);
    if (!target.closest('#context-menu') && !target.closest('#map')) hideContextMenu();
  });

  // --- Clavier ------------------------------------------------------------------------

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const typing = /** @type {Element} */ (e.target).matches('input, textarea, select');
    if (e.key === 'Escape') {
      hideContextMenu();
      cancelMode();
    } else if (typing) {
      return;
    } else if (e.key === 'Enter' && state.mode) {
      e.preventDefault();
      finishMode();
    } else if ((e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) && state.mode === 'draw') {
      e.preventDefault();
      undoDrawPoint();
    }
  });

  // --- URL (#dimension/x/z/zoom) --------------------------------------------------------

  // replaceState ne déclenche pas hashchange : pas de boucle avec l'écouteur ci-dessous.
  function updateHash() {
    const { x, z } = fromLatLng(map.getCenter());
    history.replaceState(null, '', `#${state.dim}/${x}/${z}/${map.getZoom()}`);
  }

  function parseHash() {
    const m = location.hash.match(/^#(overworld|nether|end)\/(-?\d+)\/(-?\d+)\/(-?\d+)$/);
    if (!m) return null;
    return { dim: m[1], center: toLatLng(Number(m[2]), Number(m[3])), zoom: Number(m[4]) };
  }

  window.addEventListener('hashchange', () => {
    const v = parseHash();
    if (v) setDimension(v.dim, v);
  });

  // --- Barre du haut et panneau latéral ---------------------------------------------------

  $$('.dim-btn').forEach((btn) => {
    btn.addEventListener('click', () => setDimension(btn.dataset.dim));
  });

  $('#goto').addEventListener('submit', (e) => {
    e.preventDefault();
    // Champs type="number" (x et z requis) : le navigateur n'y laisse qu'un
    // nombre fini ou une chaîne vide.
    const f = e.target.elements;
    const x = Math.round(Number(f.x.value));
    const z = Math.round(Number(f.z.value));
    const y = f.y.value === '' ? null : Math.round(Number(f.y.value));
    map.setView(toLatLng(x, z), Math.max(map.getZoom(), 1));
    openLocationPopup(x, z, y);
  });

  // Emplacement recherché : repère temporaire + actions (POI, chemin).
  const searchLayer = L.layerGroup().addTo(map);

  function openLocationPopup(x, z, y) {
    const latlng = toLatLng(x, z);
    const conv = convert(state.dim, x, z);
    const btn = (label, fn, cls) => h('button', { type: 'button', class: cls, onclick: fn }, label);
    const paths = store.data.paths.filter((p) => p.dim === state.dim);

    let actions;
    if (state.mode === 'draw') {
      actions = [btn('➕ Ajouter au tracé en cours', () => {
        map.closePopup();
        addDrawPoint(x, z);
      }, 'primary')];
    } else if (!state.mode) {
      actions = [
        btn('📍 Créer un POI', () => {
          map.closePopup();
          openPoiDialog(y === null ? { x, z } : { x, y, z });
        }, 'primary'),
        btn('〰 Commencer un chemin', () => startDrawing({ start: { x, z } })),
      ];
    }

    const content = h('div', { class: 'location-popup' },
      h('div', { class: 'popup-title' }, '📌 ', `X ${x}${y === null ? '' : ` · Y ${y}`} · Z ${z}`),
      conv ? h('div', { class: 'popup-sub' }, `≈ ${DIM_LABELS[conv.dim]} : X ${conv.x}, Z ${conv.z}`) : null,
      actions ? h('div', { class: 'popup-actions' }, actions) : null,
      !state.mode && paths.length ? h('select', {
        class: 'append-path',
        onchange: (e) => appendToPath(e.target.value, x, z),
      },
      h('option', { value: '' }, 'Ajouter au bout d’un chemin…'),
      paths.map((p) => h('option', { value: p.id }, p.name))) : null,
      h('div', { class: 'popup-actions' },
        btn('📋 Copier', () => copy(y === null ? `${x} ~ ${z}` : `${x} ${y} ${z}`))));

    // Le repère est ajouté après l'ouverture : fermer l'ancienne popup vide le calque.
    L.popup({ minWidth: 230, offset: [0, -4] })
      .setLatLng(latlng)
      .setContent(content)
      .on('remove', () => searchLayer.clearLayers())
      .openOn(map);
    L.circleMarker(latlng, {
      radius: 7, color: '#fff', weight: 2, fillColor: '#000', fillOpacity: 0.4, interactive: false,
    }).addTo(searchLayer);
  }

  function appendToPath(id, x, z) {
    const path = store.getPath(id);
    if (!path) return;
    map.closePopup();
    store.savePath(Object.assign({}, path, { points: [...path.points, [x, z]] }));
    toast(`Point ajouté à « ${path.name} ».`);
  }

  function setSidebar(open) {
    document.body.classList.toggle('sidebar-hidden', !open);
    setTimeout(() => map.invalidateSize(), 220);
  }

  function closeSidebarOnMobile() {
    if (window.innerWidth < 720) setSidebar(false);
  }

  $('#toggle-sidebar').addEventListener('click', () => {
    setSidebar(document.body.classList.contains('sidebar-hidden'));
  });

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
    });
  });

  $('#poi-search').addEventListener('input', renderLists);
  $('#add-poi').addEventListener('click', () => openPoiDialog({}));
  $('#new-path').addEventListener('click', () => {
    closeSidebarOnMobile();
    startDrawing();
  });

  // Réglages
  const optionInputs = { grid: '#opt-grid', labels: '#opt-labels', links: '#opt-links', allDims: '#poi-all-dims' };
  for (const [key, sel] of Object.entries(optionInputs)) {
    const input = $(sel);
    input.checked = !!state.options[key];
    input.addEventListener('change', () => {
      state.options[key] = input.checked;
      saveOptions();
      applyLayers();
      render();
    });
  }

  $('#export').addEventListener('click', () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'minecarte.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!confirm('Remplacer toutes les données actuelles par celles du fichier ?')) return;
      cancelMode();
      map.closePopup();
      store.replaceAll(raw);
      toast(`${store.data.pois.length} POI et ${store.data.paths.length} chemins importés.`);
    } catch (err) {
      alert(`Fichier invalide : ${err.message}`);
    }
  });

  $('#reset').addEventListener('click', () => {
    const cloudNote = cloud.code ? ' Les données seront aussi effacées du cloud et des appareils reliés.' : '';
    if (!confirm(`Effacer tous les POI, chemins et fonds importés ? Cette action est irréversible (pensez à exporter).${cloudNote}`)) return;
    cancelMode();
    map.closePopup();
    store.replaceAll({ seed: store.data.seed });
  });

  // --- Fonds de carte importés (uNmINeD) ----------------------------------------------
  // Métadonnées dans store.data.backgrounds (synchronisées), images dans IndexedDB
  // (Backgrounds) et, si la synchronisation est active, dans le cloud.

  const bgState = {
    overlays: new Map(), // id du fond -> { overlay, url }
    urls: new Map(), // empreinte -> URL objet de l'image
    loading: new Set(),
    missing: new Map(), // empreinte -> date du dernier essai infructueux
  };
  const SCALE_LABELS = {
    0.25: '4 px par bloc', 0.5: '2 px par bloc', 1: '1 px par bloc', 2: '1 px = 2 blocs', 4: '1 px = 4 blocs', 8: '1 px = 8 blocs',
  };
  const MISSING_RETRY_MS = 30000;

  // Emprise de l'image en coordonnées Leaflet (bords des blocs, pas leur centre).
  function bgBounds(bg) {
    const x2 = bg.x + bg.width * bg.scale;
    const z2 = bg.z + bg.height * bg.scale;
    return L.latLngBounds([-bg.z, bg.x], [-z2, x2]);
  }

  // Image d'un fond : d'abord sur l'appareil, sinon depuis le cloud.
  async function loadBgImage(hash) {
    if (bgState.urls.has(hash) || bgState.loading.has(hash)) return;
    bgState.loading.add(hash);
    try {
      let blob = await Backgrounds.getBlob(hash);
      if (!blob && cloud.code) {
        blob = await cloud.fetchBlob(hash);
        if (blob) await Backgrounds.putBlob(hash, blob);
      }
      if (blob) {
        bgState.urls.set(hash, URL.createObjectURL(blob));
        bgState.missing.delete(hash);
      } else {
        bgState.missing.set(hash, Date.now());
      }
    } catch {
      bgState.missing.set(hash, Date.now());
    } finally {
      bgState.loading.delete(hash);
      renderBackgrounds();
    }
  }

  let pruneTimer;
  function renderBackgrounds() {
    const list = store.data.backgrounds;
    for (const [id, entry] of bgState.overlays) {
      const bg = list.find((b) => b.id === id);
      if (bg && bgState.urls.get(bg.hash) === entry.url) continue;
      map.removeLayer(entry.overlay);
      bgState.overlays.delete(id);
    }
    for (const bg of list) {
      const url = bgState.urls.get(bg.hash);
      if (!url) {
        const failed = bgState.missing.get(bg.hash);
        if (!failed || Date.now() - failed > MISSING_RETRY_MS) loadBgImage(bg.hash);
        continue;
      }
      let entry = bgState.overlays.get(bg.id);
      if (!entry) {
        entry = { url, overlay: L.imageOverlay(url, bgBounds(bg), { pane: 'imagePane', className: 'bg-image', interactive: false }) };
        bgState.overlays.set(bg.id, entry);
      }
      entry.overlay.setBounds(bgBounds(bg));
      entry.overlay.setOpacity(bg.opacity);
      const show = bg.visible && bg.dim === state.dim;
      if (show && !map.hasLayer(entry.overlay)) entry.overlay.addTo(map);
      if (!show && map.hasLayer(entry.overlay)) map.removeLayer(entry.overlay);
    }
    const hashes = new Set(list.map((b) => b.hash));
    for (const [hash, url] of bgState.urls) {
      if (hashes.has(hash)) continue;
      URL.revokeObjectURL(url);
      bgState.urls.delete(hash);
    }
    renderBgList();
    // Nettoie les images locales qui ne servent plus.
    clearTimeout(pruneTimer);
    pruneTimer = setTimeout(() => Backgrounds.prune(new Set(store.data.backgrounds.map((b) => b.hash))).catch(() => {}), 3000);
  }

  function renderBgList() {
    const list = $('#bg-list');
    const items = store.data.backgrounds
      .slice()
      .sort((a, b) => DIMENSIONS.indexOf(a.dim) - DIMENSIONS.indexOf(b.dim) || a.name.localeCompare(b.name, 'fr'));
    list.replaceChildren(...items.map((bg) => {
      const status = bgState.urls.has(bg.hash) ? null
        : bgState.loading.has(bg.hash) ? 'Chargement de l’image…'
          : '⚠ Image indisponible sur cet appareil';
      return h('li', { class: 'item bg-item' },
        h('input', {
          type: 'checkbox',
          checked: bg.visible,
          title: 'Afficher / masquer',
          onchange: (e) => store.saveBackground(Object.assign({}, bg, { visible: e.target.checked })),
        }),
        h('span', { class: 'item-main', onclick: () => focusBackground(bg) },
          h('span', { class: 'item-name' }, bg.name),
          h('span', { class: 'item-sub' }, `${DIM_LABELS[bg.dim]} · X ${bg.x}, Z ${bg.z}`),
          h('span', { class: 'item-sub' }, `${bg.width}×${bg.height} px · ${SCALE_LABELS[bg.scale]}`),
          status ? h('span', { class: 'item-sub bg-status' }, status) : null),
        h('button', { type: 'button', class: 'icon-btn', title: 'Modifier', onclick: () => openBgDialog(bg) }, '✎'),
        h('button', {
          type: 'button',
          class: 'icon-btn danger',
          title: 'Supprimer',
          onclick: () => {
            const where = cloud.code ? ' (aussi dans le cloud et sur les appareils reliés)' : '';
            if (confirm(`Supprimer le fond « ${bg.name} »${where} ?`)) store.deleteBackground(bg.id);
          },
        }, '🗑'));
    }));
    if (!items.length) list.append(h('li', { class: 'empty' }, 'Aucun fond importé.'));
  }

  function focusBackground(bg) {
    if (bg.dim !== state.dim) setDimension(bg.dim);
    map.fitBounds(bgBounds(bg), { animate: false });
    closeSidebarOnMobile();
  }

  let bgDialogSize = null;
  function updateBgInfo() {
    const f = $('#bg-form').elements;
    const scale = Number(f.scale.value);
    const size = bgDialogSize;
    $('#bg-info').textContent = size
      ? `Image de ${size.width}×${size.height} px : couvre X ${f.x.value} → ${Number(f.x.value) + size.width * scale}, ` +
        `Z ${f.z.value} → ${Number(f.z.value) + size.height * scale}.`
      : 'Choisis une image pour voir la zone couverte.';
  }

  function openBgDialog(bg) {
    const form = $('#bg-form');
    form.reset();
    const center = fromLatLng(map.getCenter());
    const data = Object.assign({ id: '', name: '', dim: state.dim, x: center.x, z: center.z, scale: 1, opacity: 1 }, bg);
    $('#bg-dialog-title').textContent = bg ? 'Modifier le fond' : 'Importer un fond de carte';
    form.elements.id.value = data.id;
    form.elements.label.value = data.name;
    form.elements.dim.value = data.dim;
    form.elements.x.value = data.x;
    form.elements.z.value = data.z;
    form.elements.scale.value = String(data.scale);
    form.elements.opacity.value = Math.round(data.opacity * 100);
    form.elements.file.required = !bg;
    bgDialogSize = bg ? { width: bg.width, height: bg.height } : null;
    updateBgInfo();
    $('#bg-dialog').showModal();
  }

  $('#bg-add').addEventListener('click', () => openBgDialog(null));
  ['x', 'z', 'scale'].forEach((n) => $('#bg-form').elements[n].addEventListener('input', updateBgInfo));

  $('#bg-form').elements.file.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      bgDialogSize = await Backgrounds.imageSize(file);
      const f = $('#bg-form').elements;
      if (!f.label.value) f.label.value = file.name.replace(/\.[^.]+$/, '');
    } catch {
      bgDialogSize = null;
      toast('Image illisible.');
    }
    updateBgInfo();
  });

  // Place l'image au centre de la vue actuelle (quand on ne connaît pas ses coordonnées).
  $('#bg-center').addEventListener('click', () => {
    if (!bgDialogSize) return toast('Choisis d’abord une image.');
    const f = $('#bg-form').elements;
    const scale = Number(f.scale.value);
    const c = fromLatLng(map.getCenter());
    f.x.value = Math.round(c.x - (bgDialogSize.width * scale) / 2);
    f.z.value = Math.round(c.z - (bgDialogSize.height * scale) / 2);
    updateBgInfo();
  });

  $('#bg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const existing = store.getBackground(f.id.value);
    const file = f.file.files[0];
    if (!file && !existing) return;
    try {
      let image = existing ? { hash: existing.hash, type: existing.type, width: existing.width, height: existing.height } : null;
      if (file) {
        const size = await Backgrounds.imageSize(file);
        const hash = await Backgrounds.sha256(file);
        await Backgrounds.putBlob(hash, file);
        image = { hash, type: file.type, width: size.width, height: size.height };
      }
      const bg = store.saveBackground(Object.assign({
        id: existing ? existing.id : `bg-${Date.now().toString(36)}`,
        name: f.label.value.trim() || 'Fond',
        dim: f.dim.value,
        x: Math.round(Number(f.x.value)) || 0,
        z: Math.round(Number(f.z.value)) || 0,
        scale: Number(f.scale.value),
        opacity: Number(f.opacity.value) / 100,
        visible: existing ? existing.visible : true,
      }, image));
      $('#bg-dialog').close();
      if (!existing) focusBackground(bg);
    } catch (err) {
      alert(`Impossible d'enregistrer le fond : ${err.message || err}`);
    }
  });

  // Fonds importés avant la synchronisation des images : on les reprend dans les données.
  Backgrounds.migrateLegacy().then((metas) => {
    metas.forEach((meta) => { if (!store.getBackground(meta.id)) store.saveBackground(meta); });
  }, () => {
    $('#bg-add').disabled = true;
    $('#bg-add').title = 'Stockage local indisponible dans ce navigateur';
  });

  // --- Synchronisation cloud --------------------------------------------------------

  const cloud = new CloudSync(store, (window.MINECARTE_CONFIG || {}).syncUrl, renderSync, {
    getBlob: (hash) => Backgrounds.getBlob(hash).catch(() => null),
  });

  // Appelé par CloudSync, qui ne démarre que si la synchronisation est configurée.
  function renderSync(status) {
    const on = !!cloud.code;
    $('#sync-section').hidden = false;
    $('#sync-off').hidden = on;
    $('#sync-on').hidden = !on;
    $('#sync-code').textContent = CloudSync.formatCode(cloud.code);
    const time = status.at ? status.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    const text = {
      off: '',
      idle: `✓ Synchronisé${time ? ` à ${time}` : ''}.`,
      pending: 'Modifications en attente d’envoi…',
      syncing: 'Synchronisation…',
      error: `⚠ ${status.message}`,
    }[status.kind];
    const el = $('#sync-status');
    el.textContent = text;
    el.dataset.kind = status.kind;
    const badge = $('#sync-badge');
    badge.hidden = !on;
    badge.dataset.kind = status.kind;
    badge.title = `Synchronisation cloud (${CloudSync.formatCode(cloud.code)}) : ${text}`;
  }

  function showSettings() {
    setSidebar(true);
    $('.tab[data-tab="settings"]').click();
    $('#sync-section').scrollIntoView({ block: 'nearest' });
  }

  $('#sync-badge').addEventListener('click', showSettings);

  $('#sync-create').addEventListener('click', async () => {
    try {
      const code = await cloud.create();
      toast(`Code créé : ${CloudSync.formatCode(code)}`);
    } catch {
      toast('Impossible de créer un code (connexion ?).');
    }
  });

  $('#sync-join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.elements.code;
    try {
      const code = await cloud.join(input.value);
      input.value = '';
      toast(`Appareil relié au code ${CloudSync.formatCode(code)}.`);
    } catch (err) {
      toast(err.message || 'Impossible de rejoindre ce code.');
    }
  });

  $('#sync-copy').addEventListener('click', () => copy(CloudSync.formatCode(cloud.code)));
  $('#sync-now').addEventListener('click', () => cloud.pull());
  $('#sync-leave').addEventListener('click', () => {
    if (!confirm('Déconnecter cet appareil du code ? Les données restent sur cet appareil et dans le cloud.')) return;
    cloud.leave();
  });

  // --- Démarrage ------------------------------------------------------------------------------

  store.onChange(() => render());
  store.onChange(() => renderBackgrounds());
  // Les icônes d'items ne sont chargées que si un POI en utilise une.
  function loadIconsIfNeeded() {
    if (!Icons.isLoaded() && store.data.pois.some((p) => p.icon)) Icons.load().then(render, () => {});
  }
  store.onChange(loadIconsIfNeeded);
  loadIconsIfNeeded();
  window.MineCarte = { map, store, state, cloud };
  fillSwatches();
  if (window.innerWidth < 720) document.body.classList.add('sidebar-hidden');

  const initial = parseHash();
  setDimension(initial ? initial.dim : 'overworld', initial || state.views.overworld);
  cloud.start();
})();
