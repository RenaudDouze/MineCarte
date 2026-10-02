/*
 * Brouillons des dialogues : ce qui a été saisi sans être enregistré survit à
 * une fermeture involontaire (Échap, clic à côté, onglet fermé, rechargement).
 *
 * Seuls les champs modifiés par rapport à l'ouverture du dialogue sont gardés,
 * avec l'élément concerné (identifiant, ou « new » pour un nouvel élément).
 * Rouvrir le même élément réapplique ces changements par-dessus ses valeurs du
 * moment : un nouveau lieu ouvert ailleurs garde ses coordonnées, mais
 * retrouve le nom déjà tapé.
 */
(function (global) {
  'use strict';

  const KEY = 'minecarte:drafts';

  class Drafts {
    constructor(storage) {
      this.storage = storage;
    }

    // Champs de `current` dont la valeur diffère de `initial`.
    static changes(initial, current) {
      const out = {};
      for (const [field, value] of Object.entries(current)) {
        if (JSON.stringify(value) !== JSON.stringify(initial[field])) out[field] = value;
      }
      return out;
    }

    all() {
      try {
        const drafts = JSON.parse(this.storage.getItem(KEY));
        return drafts && typeof drafts === 'object' && !Array.isArray(drafts) ? drafts : {};
      } catch {
        return {};
      }
    }

    write(drafts) {
      try {
        if (Object.keys(drafts).length) this.storage.setItem(KEY, JSON.stringify(drafts));
        else this.storage.removeItem(KEY);
      } catch {
        // Stockage indisponible : le brouillon est perdu, la saisie continue.
      }
    }

    // Enregistre ce qui a changé dans le formulaire `form` ; rien de changé :
    // plus de brouillon.
    save(form, target, initial, current) {
      const drafts = this.all();
      const changes = Drafts.changes(initial, current);
      if (Object.keys(changes).length) drafts[form] = { target, changes };
      else delete drafts[form];
      this.write(drafts);
    }

    // Valeurs à afficher en rouvrant `target` (brouillon appliqué), ou null
    // s'il n'y a pas de brouillon pour cet élément.
    restore(form, target, initial) {
      const draft = this.all()[form];
      if (!draft || draft.target !== target) return null;
      return Object.assign({}, initial, draft.changes);
    }

    clear(form) {
      const drafts = this.all();
      delete drafts[form];
      this.write(drafts);
    }
  }

  Drafts.KEY = KEY;
  global.Drafts = Drafts;
})(window);
