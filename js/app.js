/*
 * MineCarte — interface : carte Leaflet, POI, liens et chemins.
 */
(function () {
  'use strict';

  const { DIM_LABELS, SWATCHES, toLatLng, fromLatLng, esc, h, pathLength, fmt, polygonCentroid, ring, pathSummary, convert, extent, parseCoords, parsePoints, formatPoints, toggleCategory, searchItems, nearestSegment } = Utils;
  const OPTIONS_KEY = 'minecarte:options';

  // ?vue=… : carte partagée en lecture seule, gardée en mémoire (rien n'est
  // écrit dans le navigateur de la personne qui la consulte).
  const viewId = new URLSearchParams(location.search).get('vue');
  const store = new Store({ persist: !viewId });
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
    const defaults = { grid: true, labels: true, zoneLabels: true, links: true, allDims: false, hiddenCats: [] };
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

  // Cadre la carte sur tous les lieux et chemins de la dimension affichée.
  function fitAll() {
    const e = extent(store.data.pois, store.data.paths, state.dim);
    if (!e) return toast('Aucun lieu ni chemin dans cette dimension.');
    const bounds = L.latLngBounds(toLatLng(e.minX, e.minZ), toLatLng(e.maxX, e.maxZ));
    map.fitBounds(bounds.pad(0.1), { maxZoom: 2, animate: false });
  }

  // Bouton sous le zoom (+ / −).
  const FitControl = L.Control.extend({
    onAdd() {
      const button = h('a', {
        href: '#',
        role: 'button',
        class: 'fit-all',
        title: 'Afficher tous les lieux et chemins',
        'aria-label': 'Afficher tous les lieux et chemins',
      }, '⤢');
      const bar = h('div', { class: 'leaflet-bar' }, button);
      // Un clic sur le bouton n'est pas un clic sur la carte (tracé en cours…).
      L.DomEvent.disableClickPropagation(bar);
      button.addEventListener('click', (ev) => {
        ev.preventDefault();
        fitAll();
      });
      return bar;
    },
  });
  new FitControl({ position: 'topleft' }).addTo(map);

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

  // --- Catégories -------------------------------------------------------------------

  const CATEGORIES = Store.CATEGORIES;
  const categoryOf = (poi) => CATEGORIES.find((c) => c.id === poi.category);
  const isShown = (poi) => !state.options.hiddenCats.includes(poi.category);

  // Filtre : une pastille par catégorie utilisée (et « Sans catégorie »),
  // seulement s'il y en a au moins deux.
  function renderCategoryFilter() {
    const used = [{ id: '', emoji: '', label: 'Sans catégorie' }, ...CATEGORIES]
      .map((c) => ({ ...c, count: store.data.pois.filter((p) => p.category === c.id).length }))
      .filter((c) => c.count);
    const box = $('#cat-filter');
    box.hidden = used.length < 2;
    box.replaceChildren(...used.map((c) => {
      const hidden = state.options.hiddenCats.includes(c.id);
      return h('button', {
        type: 'button',
        class: `cat-chip${hidden ? ' off' : ''}`,
        'aria-pressed': String(!hidden),
        title: `${hidden ? 'Afficher' : 'Masquer'} cette catégorie (Ctrl+clic : n'afficher qu'elle)`,
        onclick: (e) => {
          state.options.hiddenCats = toggleCategory(state.options.hiddenCats, used.map((u) => u.id), c.id, e.ctrlKey || e.metaKey);
          saveOptions();
          render();
        },
      }, `${c.emoji ? `${c.emoji} ` : ''}${c.label} (${c.count})`);
    }));
  }

  function render() {
    poiLayer.clearLayers();
    linkLayer.clearLayers();
    pathLayer.clearLayers();
    state.markers.clear();

    const pois = store.data.pois.filter((p) => p.dim === state.dim && isShown(p));
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
          if (!other || other.dim !== state.dim || !isShown(other) || other.id < poi.id) continue;
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
      // Zone : polygone fermé, rempli de sa couleur.
      const Shape = path.closed ? L.Polygon : L.Polyline;
      new Shape(latlngs, { pane: 'pathPane', color: '#000', weight: path.weight + 3, opacity: 0.35, fill: false, interactive: false })
        .addTo(pathLayer);
      const line = new Shape(latlngs, {
        pane: 'pathPane', color: path.color, weight: path.weight, opacity: 0.95, fillColor: path.color, fillOpacity: 0.2,
      });
      line.on('click', (e) => {
        if (state.mode) return;
        openPathPopup(path, e.latlng);
      });
      line.bindTooltip(esc(path.name), { sticky: true });
      line.addTo(pathLayer);
      if (path.closed && state.options.zoneLabels) {
        L.marker(toLatLng(...polygonCentroid(path.points)), {
          icon: L.divIcon({ className: 'zone-label', html: `<span>${esc(path.name)}</span>`, iconSize: null }),
          interactive: false,
          keyboard: false,
        }).addTo(pathLayer);
      }
    }

    renderCategoryFilter();
    renderLists();
  }

  // Trait pour un chemin, carré plein pour une zone.
  function pathSwatch(path) {
    return h('span', { class: path.closed ? 'swatch-zone' : 'swatch-line', style: `background:${path.color}` });
  }

  function dimBadge(dim) {
    return h('span', { class: `badge badge-${dim}` }, DIM_LABELS[dim]);
  }

  function renderLists() {
    const query = $('#poi-search').value.trim().toLowerCase();
    const allDims = state.options.allDims;
    const pois = store.data.pois
      .filter((p) => (allDims || p.dim === state.dim) && isShown(p) && p.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    const poiList = $('#poi-list');
    poiList.replaceChildren(...pois.map((poi) => {
      const cat = categoryOf(poi);
      return h('li', { class: 'item', onclick: () => focusPoi(poi.id) },
        poiDot(poi),
        h('span', { class: 'item-main' },
          h('span', { class: 'item-name' }, poi.name),
          h('span', { class: 'item-sub' }, `${cat ? `${cat.emoji} ${cat.label} · ` : ''}X ${poi.x} · Y ${poi.y} · Z ${poi.z}`)),
        allDims && poi.dim !== state.dim ? dimBadge(poi.dim) : null,
        poi.links.length ? h('span', { class: 'item-links', title: 'Liens' }, `🔗 ${poi.links.length}`) : null);
    }));
    if (!pois.length) {
      poiList.append(h('li', { class: 'empty' }, query ? 'Aucun résultat.' : 'Aucun lieu. Clic droit sur la carte ou « + Lieu ».'));
    }

    const here = store.data.paths.filter((p) => p.dim === state.dim);
    renderPathList($('#path-list'), here.filter((p) => !p.closed),
      'Aucun chemin dans cette dimension. Clic droit sur la carte ou « + Tracer un chemin ».');
    renderPathList($('#zone-list'), here.filter((p) => p.closed),
      'Aucune zone dans cette dimension. Clic droit sur la carte ou « + Tracer une zone ».');
  }

  function renderPathList(list, paths, empty) {
    list.replaceChildren(...paths.map((path) => h('li', { class: 'item', onclick: () => focusPath(path.id) },
      pathSwatch(path),
      h('span', { class: 'item-main' },
        h('span', { class: 'item-name' }, path.name),
        h('span', { class: 'item-sub' }, pathSummary(path.points, path.closed))))));
    if (!paths.length) list.append(h('li', { class: 'empty' }, empty));
  }

  // --- POI : popup, navigation, dialogue ------------------------------------------

  function openPoiPopup(poi) {
    const conv = convert(poi.dim, poi.x, poi.z);
    const cat = categoryOf(poi);
    const links = poi.links.map((id) => store.getPoi(id)).filter(Boolean);

    const content = h('div', { class: 'poi-popup' },
      h('div', { class: 'popup-title' },
        poiDot(poi), poi.name),
      cat ? h('div', { class: 'popup-cat' }, `${cat.emoji} ${cat.label}`) : null,
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
        h('button', { type: 'button', class: 'edit', onclick: () => openPoiDialog(poi) }, 'Modifier'),
        conv ? h('button', {
          type: 'button',
          class: 'edit',
          title: `Créer un lieu lié dans ${conv.dim === 'nether' ? 'le Nether' : "l'Overworld"} aux coordonnées converties`,
          onclick: () => openPoiDialog({
            name: `${poi.name} (${DIM_LABELS[conv.dim]})`,
            color: poi.color,
            icon: poi.icon,
            category: poi.category,
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
          class: 'danger edit',
          onclick: () => {
            if (confirm(`Supprimer le lieu « ${poi.name} » ?`)) {
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

  // Petite croix discrète pour vider un champ de saisie (visible s'il n'est pas vide).
  function addClearButton(input) {
    const wrap = h('span', { class: 'clearable' });
    input.replaceWith(wrap);
    if (!input.placeholder) input.placeholder = ' ';
    wrap.append(input, h('button', {
      type: 'button',
      class: 'clear-btn',
      tabindex: '-1',
      title: 'Effacer',
      'aria-label': 'Effacer',
      // Le champ garde le focus (la recherche ne se referme pas).
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      },
    }, '×'));
  }

  function fillSwatches() {
    $$('.swatches').forEach((box) => {
      const input = /** @type {HTMLInputElement} */ (box.closest('form').elements[box.dataset.target]);
      box.replaceChildren(...SWATCHES.map((c) => h('button', {
        type: 'button',
        class: 'swatch',
        style: `background:${c}`,
        title: c,
        onclick: () => {
          input.value = c;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
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
    if (!others.length) box.append(h('p', { class: 'hint' }, 'Aucun autre lieu pour le moment.'));
  }

  // --- Brouillons des dialogues ------------------------------------------------------
  // Saisie non enregistrée gardée en cas de fermeture involontaire (Échap, clic à
  // côté, onglet fermé) ; « Enregistrer » et « Annuler » l'oublient.

  const drafts = new Drafts(localStorage);
  const openDrafts = {}; // formulaire → { target, initial } du dernier dialogue ouvert

  function startDraft(form, target, initial, fill) {
    openDrafts[form] = { target, initial };
    const restored = drafts.restore(form, target, initial);
    if (restored) {
      fill(restored);
      toast('Saisie non enregistrée restaurée.');
    }
  }

  function saveDraft(form, current) {
    const { target, initial } = openDrafts[form];
    drafts.save(form, target, initial, current);
  }

  function endDraft(form) {
    drafts.clear(form);
  }

  let poiDialogLinks = new Set();

  function poiFormState() {
    const f = $('#poi-form').elements;
    return {
      label: f.label.value, category: f.category.value, color: f.color.value, icon: f.icon.value,
      dim: f.dim.value, x: f.x.value, y: f.y.value, z: f.z.value, links: [...poiDialogLinks].sort(),
    };
  }

  function fillPoiForm(s, id) {
    const f = $('#poi-form').elements;
    f.label.value = s.label;
    f.color.value = s.color;
    f.category.value = s.category;
    f.dim.value = s.dim;
    f.x.value = s.x;
    f.y.value = s.y;
    f.z.value = s.z;
    setPoiIcon(s.icon);
    poiDialogLinks = new Set(s.links);
    renderLinkPicker(poiDialogLinks, id);
  }

  const savePoiDraft = () => saveDraft('poi', poiFormState());

  function openPoiDialog(poi) {
    const form = $('#poi-form');
    const center = fromLatLng(map.getCenter());
    const data = Object.assign({ name: '', color: '#e53935', icon: '', category: '', dim: state.dim, x: center.x, y: 64, z: center.z, links: [] }, poi);
    $('#poi-dialog-title').textContent = data.id ? 'Modifier le lieu' : 'Nouveau lieu';
    form.elements.id.value = data.id || '';
    $('#icon-picker').hidden = true;
    $('#poi-link-filter').value = '';
    fillPoiForm({ ...data, label: data.name }, data.id);
    startDraft('poi', data.id || 'new', poiFormState(), (s) => fillPoiForm(s, data.id));
    $('#poi-dialog').showModal();
    form.elements.label.focus();
    form.elements.label.select();
  }

  $('#poi-form').elements.category.replaceChildren(
    h('option', { value: '' }, 'Sans catégorie'),
    ...CATEGORIES.map((c) => h('option', { value: c.id }, `${c.emoji} ${c.label}`)));

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
        savePoiDraft();
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
  $('#icon-clear').addEventListener('click', () => {
    setPoiIcon('');
    savePoiDraft();
  });
  $('#poi-form').addEventListener('input', savePoiDraft);
  $('#poi-form').addEventListener('change', savePoiDraft);

  function updateWeightPreview() {
    const f = $('#path-form').elements;
    $('#weight-value').textContent = `${f.weight.value} px`;
    $('#weight-preview').style.cssText = `height:${f.weight.value}px;background:${f.color.value}`;
  }
  $('#path-form').elements.weight.addEventListener('input', updateWeightPreview);
  $('#path-form').elements.color.addEventListener('input', updateWeightPreview);

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
      category: f.category.value,
      links: [...poiDialogLinks],
    });
    endDraft('poi');
    // Un lieu enregistré dans une catégorie masquée la fait réapparaître.
    if (state.options.hiddenCats.includes(poi.category)) {
      state.options.hiddenCats = state.options.hiddenCats.filter((id) => id !== poi.category);
      saveOptions();
      render();
    }
    $('#poi-dialog').close();
    focusPoi(poi.id);
  });

  // --- Chemins : popup, dialogue ---------------------------------------------------

  function openPathPopup(path, latlng) {
    const content = h('div', { class: 'path-popup' },
      h('div', { class: 'popup-title' }, pathSwatch(path), path.name),
      h('div', { class: 'popup-sub' }, pathSummary(path.points, path.closed)),
      path.dim === 'nether' && !path.closed
        ? h('div', { class: 'popup-sub' }, `≈ ${fmt(pathLength(path.points) * 8)} blocs dans l'Overworld`) : null,
      h('div', { class: 'popup-actions edit' },
        h('button', { type: 'button', onclick: () => { map.closePopup(); openPathDialog(path); } }, 'Modifier'),
        h('button', { type: 'button', onclick: () => { map.closePopup(); openPathDialog(path, true); } }, 'Coordonnées'),
        h('button', { type: 'button', onclick: () => { map.closePopup(); startEditing(path.id); } }, 'Éditer le tracé'),
        h('button', { type: 'button', onclick: () => { map.closePopup(); startDrawing({ pathId: path.id }); } }, 'Prolonger'),
        h('button', {
          type: 'button',
          class: 'danger',
          onclick: () => {
            if (confirm(`Supprimer ${path.closed ? 'la zone' : 'le chemin'} « ${path.name} » ?`)) {
              map.closePopup();
              store.deletePath(path.id);
            }
          },
        }, 'Supprimer')));
    L.popup({ minWidth: 220 }).setLatLng(latlng).setContent(content).openOn(map);
  }

  function focusPath(id) {
    const path = store.getPath(id);
    if (path.dim !== state.dim) setDimension(path.dim);
    const bounds = L.latLngBounds(path.points.map(([x, z]) => toLatLng(x, z)));
    map.fitBounds(bounds.pad(0.2), { maxZoom: 2, animate: false });
    const mid = path.points[Math.floor(path.points.length / 2)];
    openPathPopup(path, toLatLng(mid[0], mid[1]));
    closeSidebarOnMobile();
  }

  // Chemin existant, ou nouveau chemin (sans id) dont les points se saisissent
  // dans le dialogue.
  function pathFormState() {
    const f = $('#path-form').elements;
    return { label: f.label.value, color: f.color.value, weight: f.weight.value, points: f.points.value, closed: f.closed.checked };
  }

  function fillPathForm(s) {
    const f = $('#path-form').elements;
    f.label.value = s.label;
    f.color.value = s.color;
    f.weight.value = s.weight;
    f.points.value = s.points;
    f.closed.checked = s.closed;
  }

  // `byCoords` : curseur dans les points plutôt que dans le nom (un nouveau
  // chemin commence toujours par ses points).
  function openPathDialog(path, byCoords) {
    const form = $('#path-form');
    form.elements.id.value = path.id || '';
    form.elements.dim.value = path.dim;
    fillPathForm({ label: path.name, color: path.color, weight: path.weight, points: formatPoints(path.points), closed: !!path.closed });
    startDraft('path', path.id || 'new', pathFormState(), fillPathForm);
    updateWeightPreview();
    updatePathInfo();
    $('#path-dialog').showModal();
    if (path.id && !byCoords) {
      form.elements.label.focus();
      form.elements.label.select();
    } else {
      form.elements.points.focus();
    }
  }

  // Longueur et nombre de points saisis, ou la ligne illisible.
  function updatePathInfo() {
    const f = $('#path-form').elements;
    const closed = f.closed.checked;
    $('#path-title').textContent = closed ? 'Zone' : 'Chemin';
    const { points, error } = parsePoints(f.points.value, closed ? 3 : 2);
    $('#path-info').classList.toggle('error', !!error);
    $('#path-info').textContent = error || `${DIM_LABELS[f.dim.value]} · ${closed ? 'zone de ' : ''}${pathSummary(points, closed)}`;
    return points;
  }

  $('#path-form').elements.points.addEventListener('input', updatePathInfo);
  $('#path-form').addEventListener('input', () => saveDraft('path', pathFormState()));
  $('#path-form').addEventListener('change', () => saveDraft('path', pathFormState()));
  $('#path-form').elements.closed.addEventListener('change', updatePathInfo);

  $('#path-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const points = updatePathInfo();
    if ($('#path-info').classList.contains('error')) {
      f.points.focus();
      return;
    }
    const path = store.getPath(f.id.value);
    endDraft('path');
    $('#path-dialog').close();
    // Chemin supprimé entre-temps (autre appareil) : rien à enregistrer.
    if (f.id.value && !path) return;
    const saved = store.savePath(Object.assign({}, path || { dim: f.dim.value }, {
      name: f.label.value, color: f.color.value, weight: f.weight.value, points, closed: f.closed.checked,
    }));
    if (!path) focusPath(saved.id);
  });

  // « Annuler » : fermeture voulue, le brouillon est oublié.
  document.querySelectorAll('dialog [data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dialog = btn.closest('dialog');
      endDraft(dialog.dataset.draft);
      dialog.close();
    });
  });

  // --- Modes tracé / édition ------------------------------------------------------

  function nextPathColor() {
    return SWATCHES[store.data.paths.length % 8];
  }

  function startDrawing({ pathId = null, start = null, closed = false } = {}) {
    cancelMode();
    map.closePopup();
    const existing = pathId && store.getPath(pathId);
    const color = existing ? existing.color : nextPathColor();
    const weight = existing ? existing.weight : 4;
    const isZone = existing ? !!existing.closed : closed;
    const Shape = isZone ? L.Polygon : L.Polyline;
    state.mode = 'draw';
    state.draw = {
      pathId: existing ? existing.id : null,
      points: existing ? existing.points.map((p) => p.slice()) : [],
      color,
      closed: isZone,
      line: new Shape([], { pane: 'pathPane', color, weight, fillColor: color, fillOpacity: 0.2, interactive: false }).addTo(drawLayer),
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
    showBanner(`Tracé${d.closed ? ' de zone' : ''}${d.pathId ? ' (prolongement)' : ''} — ${pathSummary(d.points, d.closed)}. ` +
      'Clic : ajouter · clic sur un lieu : s’y accrocher · double-clic / Entrée : terminer', true);
  }

  function finishDrawing() {
    const d = state.draw;
    if (d.points.length < (d.closed ? 3 : 2)) {
      toast(d.closed ? 'Une zone doit avoir au moins 3 points.' : 'Un chemin doit avoir au moins 2 points.');
      return;
    }
    const points = d.points;
    const existing = d.pathId && store.getPath(d.pathId);
    endMode();
    if (existing) {
      store.savePath(Object.assign({}, existing, { points }));
    } else {
      const path = store.savePath({
        name: `${d.closed ? 'Zone' : 'Chemin'} ${store.data.paths.length + 1}`,
        color: d.color,
        dim: state.dim,
        points,
        closed: d.closed,
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
    const Shape = path.closed ? L.Polygon : L.Polyline;
    state.edit = {
      pathId,
      name: path.name,
      closed: !!path.closed,
      points: path.points.map((p) => p.slice()),
      line: new Shape([], { pane: 'pathPane', color: path.color, weight: Math.max(path.weight + 2, 6), fillColor: path.color, fillOpacity: 0.2 })
        .addTo(drawLayer),
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
        if (ed.points.length <= (ed.closed ? 3 : 2)) {
          toast(ed.closed ? 'Une zone doit garder au moins 3 points.' : 'Un chemin doit garder au moins 2 points.');
          return;
        }
        ed.points.splice(i, 1);
        rebuildEdit();
      });
      m.addTo(ed.vertices);
    });
    showBanner(`Édition de « ${ed.name} » — ${pathSummary(ed.points, ed.closed)}. ` +
      'Glisser : déplacer · clic sur un segment : insérer · clic droit sur un sommet : supprimer', false);
  }

  function insertEditPoint(latlng) {
    const ed = state.edit;
    const vertices = ed.points.map(([x, z]) => map.latLngToLayerPoint(toLatLng(x, z)));
    // Zone : le segment de fermeture (dernier → premier) compte aussi.
    const best = nearestSegment(map.latLngToLayerPoint(latlng), ed.closed ? ring(vertices) : vertices);
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

  // Au doigt, pas de survol : les coordonnées suivent le centre de la carte, marqué d'une mire.
  map.getContainer().addEventListener('pointerdown', (e) => {
    document.body.classList.toggle('touch', e.pointerType === 'touch');
  });
  map.on('move', () => {
    if (document.body.classList.contains('touch')) updateCoords(map.getCenter());
  });

  map.on('click', (e) => {
    hideContextMenu();
    closeSidebarOnMobile();
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
    const item = (label, fn, cls) => h('button', { type: 'button', class: cls, onclick: () => { hideContextMenu(); fn(); } }, label);
    menu.replaceChildren(
      h('div', { class: 'menu-title' }, `X ${x} · Z ${z}`),
      item('📍 Ajouter un lieu ici', () => openPoiDialog({ x, z }), 'edit'),
      item('〰 Commencer un chemin ici', () => startDrawing({ start: { x, z } }), 'edit'),
      item('⬠ Commencer une zone ici', () => startDrawing({ start: { x, z }, closed: true }), 'edit'),
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
    } else if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
    } else if ((e.ctrlKey || e.metaKey) && !state.mode) {
      // Ctrl+Z : annuler ; Ctrl+Y ou Ctrl+Maj+Z : rétablir.
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoChange();
      } else if (k === 'y' || k === 'z') {
        e.preventDefault();
        redoChange();
      }
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

  // --- Recherche globale : lieux, chemins et coordonnées ------------------------------

  const searchInput = $('#global-search');
  const searchResults = $('#search-results');
  let searchChoices = [];
  let searchActive = 0;

  function goTo(x, z, y) {
    map.setView(toLatLng(x, z), Math.max(map.getZoom(), 1));
    openLocationPopup(x, z, y);
  }

  const searchLine = (icon, name, sub) => [icon, h('span', { class: 'item-main' },
    h('span', { class: 'item-name' }, name),
    h('span', { class: 'item-sub' }, sub))];

  // Propositions : les coordonnées reconnues, puis les lieux et chemins.
  function searchEntries(query) {
    const entries = [];
    const c = parseCoords(query);
    if (c) {
      entries.push({
        content: searchLine(h('span', { class: 'search-icon' }, '📌'),
          `Aller à X ${c.x}${c.y === null ? '' : ` · Y ${c.y}`} · Z ${c.z}`, DIM_LABELS[state.dim]),
        run: () => goTo(c.x, c.z, c.y),
      });
    }
    for (const { type, item } of searchItems(query, store.data.pois, store.data.paths, 8)) {
      entries.push(type === 'poi'
        ? {
          content: searchLine(poiDot(item), item.name, `${DIM_LABELS[item.dim]} · X ${item.x} · Z ${item.z}`),
          run: () => focusPoi(item.id),
        }
        : {
          content: searchLine(pathSwatch(item), item.name,
            `${DIM_LABELS[item.dim]} · ${item.closed ? 'zone' : 'chemin'} · ${pathSummary(item.points, item.closed)}`),
          run: () => focusPath(item.id),
        });
    }
    return entries;
  }

  function highlightSearch() {
    [...searchResults.children].forEach((li, i) => {
      li.classList.toggle('active', i === searchActive);
      li.setAttribute('aria-selected', String(i === searchActive));
    });
  }

  function closeSearch() {
    searchResults.hidden = true;
    searchChoices = [];
  }

  function renderSearch() {
    if (!searchInput.value.trim()) return closeSearch();
    searchChoices = searchEntries(searchInput.value);
    searchActive = 0;
    searchResults.replaceChildren(...searchChoices.map((choice, i) => h('li', {
      class: 'search-item',
      role: 'option',
      // Garder le focus dans le champ : le clic arrive avant la perte de focus.
      onmousedown: (e) => e.preventDefault(),
      onclick: () => chooseSearch(i),
    }, choice.content)));
    highlightSearch();
    if (!searchChoices.length) searchResults.append(h('li', { class: 'empty' }, 'Aucun résultat.'));
    searchResults.hidden = false;
  }

  function chooseSearch(i) {
    const choice = searchChoices[i];
    if (!choice) return;
    searchInput.value = '';
    closeSearch();
    searchInput.blur();
    choice.run();
  }

  searchInput.addEventListener('input', renderSearch);
  searchInput.addEventListener('focus', renderSearch);
  searchInput.addEventListener('blur', closeSearch);
  searchInput.addEventListener('keydown', (e) => {
    const n = searchChoices.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      searchActive = n ? (searchActive + (e.key === 'ArrowDown' ? 1 : n - 1)) % n : 0;
      highlightSearch();
    } else if (e.key === 'Escape') {
      searchInput.value = '';
      closeSearch();
    }
  });
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    chooseSearch(searchActive);
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
        btn('📍 Créer un lieu', () => {
          map.closePopup();
          openPoiDialog(y === null ? { x, z } : { x, y, z });
        }, 'primary'),
        btn('〰 Commencer un chemin', () => startDrawing({ start: { x, z } })),
        btn('⬠ Commencer une zone', () => startDrawing({ start: { x, z }, closed: true })),
      ];
    }

    const content = h('div', { class: 'location-popup' },
      h('div', { class: 'popup-title' }, '📌 ', `X ${x}${y === null ? '' : ` · Y ${y}`} · Z ${z}`),
      conv ? h('div', { class: 'popup-sub' }, `≈ ${DIM_LABELS[conv.dim]} : X ${conv.x}, Z ${conv.z}`) : null,
      actions ? h('div', { class: 'popup-actions edit' }, actions) : null,
      !state.mode && paths.length ? h('select', {
        class: 'append-path edit',
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
  $('#new-zone').addEventListener('click', () => {
    closeSidebarOnMobile();
    startDrawing({ closed: true });
  });
  function newPathByCoords(closed) {
    cancelMode();
    openPathDialog({
      name: `${closed ? 'Zone' : 'Chemin'} ${store.data.paths.length + 1}`, color: nextPathColor(), weight: 4, dim: state.dim, points: [], closed,
    });
  }
  $('#new-path-coords').addEventListener('click', () => newPathByCoords(false));
  $('#new-zone-coords').addEventListener('click', () => newPathByCoords(true));

  // Réglages
  const optionInputs = { grid: '#opt-grid', labels: '#opt-labels', zoneLabels: '#opt-zone-labels', links: '#opt-links', allDims: '#poi-all-dims' };
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
      saveBackup(true);
      store.replaceAll(raw);
      toast(`${store.data.pois.length} lieu(x) et ${store.data.paths.length} chemin(s) importés.`);
    } catch (err) {
      alert(`Fichier invalide : ${err.message}`);
    }
  });

  $('#reset').addEventListener('click', () => {
    const cloudNote = cloud.code ? ' Les données seront aussi effacées du cloud et des appareils reliés.' : '';
    if (!confirm(`Effacer tous les lieux et chemins ? Ils restent récupérables avec Annuler ou l'historique local.${cloudNote}`)) return;
    cancelMode();
    map.closePopup();
    saveBackup(true);
    store.replaceAll({ seed: store.data.seed });
  });

  // Images des fonds importés (fonctionnalité retirée) : on libère la place
  // qu'elles occupaient dans le navigateur.
  window.indexedDB?.deleteDatabase('minecarte');

  // --- Synchronisation cloud --------------------------------------------------------

  const cloud = new CloudSync(store, (window.MINECARTE_CONFIG || {}).syncUrl, renderSync);

  // Appelé par CloudSync, qui ne démarre que si la synchronisation est configurée.
  function renderSync(status) {
    const on = !!cloud.code;
    $('#sync-section').hidden = false;
    $('#sync-off').hidden = on;
    $('#sync-on').hidden = !on;
    if (!on) showShare(null);
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

  // Réglages : fenêtre à part, ouverte par ⚙ (ou par le badge de synchronisation).
  $('#settings-btn').addEventListener('click', () => $('#settings-dialog').showModal());
  $('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
  $('#sync-badge').addEventListener('click', () => {
    $('#settings-dialog').showModal();
    $('#sync-section').scrollIntoView({ block: 'nearest' });
  });

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

  // --- Lien de lecture seule --------------------------------------------------------------------

  function showShare(view) {
    $('#share-on').hidden = !view;
    $('#share-url').value = view ? `${location.origin}${location.pathname}?vue=${view}` : '';
  }

  $('#share-create').addEventListener('click', async () => {
    try {
      showShare(await cloud.share());
    } catch (err) {
      toast(err.message);
    }
  });
  $('#share-copy').addEventListener('click', () => copy($('#share-url').value));
  $('#share-revoke').addEventListener('click', async () => {
    if (!confirm('Révoquer le lien en lecture seule ? Il ne fonctionnera plus pour personne.')) return;
    try {
      showShare(await cloud.unshare());
      toast('Lien révoqué.');
    } catch (err) {
      toast(err.message);
    }
  });

  function renderView(status) {
    const error = status.kind === 'error';
    $('#readonly').classList.toggle('error', error);
    $('#readonly-text').textContent = error ? `⚠ ${status.message}` : '👁 Lecture seule';
  }

  $('#sync-copy').addEventListener('click', () => copy(CloudSync.formatCode(cloud.code)));
  $('#sync-now').addEventListener('click', () => cloud.pull());
  $('#sync-leave').addEventListener('click', () => {
    if (!confirm('Déconnecter cet appareil du code ? Les données restent sur cet appareil et dans le cloud.')) return;
    cloud.leave();
  });

  // --- Annuler / rétablir ------------------------------------------------------------------------

  const undo = new UndoStack(JSON.stringify(store.data));

  function updateUndoButtons() {
    $('#undo-btn').disabled = !undo.canUndo;
    $('#redo-btn').disabled = !undo.canRedo;
  }

  // Les états restaurés passent par replaceAll(…, 'history') : ils sont
  // synchronisés comme une modification locale, sans être réempilés.
  store.onChange((data, source) => {
    const snapshot = JSON.stringify(data);
    if (source === 'remote') undo.reset(snapshot);
    else if (source !== 'history') undo.record(snapshot);
    updateUndoButtons();
  });

  function restore(snapshot, message) {
    if (snapshot === null) return;
    cancelMode();
    map.closePopup();
    store.replaceAll(JSON.parse(snapshot), 'history');
    toast(message);
  }

  // --- Historique local -----------------------------------------------------------------------

  const backups = new Backups(localStorage, () => Date.now());

  function saveBackup(force) {
    if (!viewId && backups.save(store.data, force)) renderBackups();
  }

  function renderBackups() {
    const list = backups.list();
    $('#backup-list').replaceChildren(...(list.length ? list.map((entry) => {
      const when = new Date(entry.time).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      return h('li', { class: 'item' },
        h('span', { class: 'item-main' },
          h('span', { class: 'item-name' }, when),
          h('span', { class: 'item-sub' }, Backups.summary(entry.data))),
        h('button', { type: 'button', onclick: () => restoreBackup(entry, when) }, 'Restaurer'));
    }) : [h('li', { class: 'empty' }, 'Aucune copie pour l\'instant.')]));
  }

  function restoreBackup(entry, when) {
    if (!confirm(`Revenir à l'état du ${when} ? L'état actuel est d'abord copié dans l'historique.`)) return;
    cancelMode();
    map.closePopup();
    saveBackup(true);
    store.replaceAll(entry.data);
    toast(`État du ${when} restauré.`);
  }

  store.onChange(() => saveBackup(false));
  saveBackup(false);
  renderBackups();

  function undoChange() {
    restore(undo.undo(), 'Modification annulée.');
  }

  function redoChange() {
    restore(undo.redo(), 'Modification rétablie.');
  }

  $('#undo-btn').addEventListener('click', undoChange);
  $('#redo-btn').addEventListener('click', redoChange);

  // --- Démarrage ------------------------------------------------------------------------------

  store.onChange(() => render());
  // Les icônes d'items ne sont chargées que si un POI en utilise une.
  function loadIconsIfNeeded() {
    if (!Icons.isLoaded() && store.data.pois.some((p) => p.icon)) Icons.load().then(render, () => {});
  }
  store.onChange(loadIconsIfNeeded);
  loadIconsIfNeeded();
  window.MineCarte = { map, store, state, cloud };
  fillSwatches();
  $$('input[type="text"]:not([readonly]), input[type="search"], textarea').forEach(addClearButton);
  if (window.innerWidth < 720) document.body.classList.add('sidebar-hidden');

  const initial = parseHash();
  setDimension(initial ? initial.dim : 'overworld', initial || state.views.overworld);
  if (viewId) {
    document.body.classList.add('readonly');
    $('#readonly').hidden = false;
    $('#readonly-exit').href = location.pathname;
    new CloudSync.View(store, cloud.url, viewId, renderView).start();
  } else {
    cloud.start();
  }
})();
