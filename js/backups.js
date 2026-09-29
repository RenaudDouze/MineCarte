/*
 * Historique local : copies automatiques des données dans le navigateur, pour
 * revenir à un état antérieur (erreur, import malheureux, synchronisation
 * indésirable), même après avoir fermé la page.
 *
 * Une copie au plus toutes les 10 minutes, seulement si les données ont changé
 * et ne sont pas vides ; les 10 plus récentes sont gardées. L'historique est
 * plafonné en taille pour laisser la place aux données elles-mêmes : les
 * copies les plus anciennes sont sacrifiées si besoin.
 */
(function (global) {
  'use strict';

  const KEY = 'minecarte:backups';
  const LIMIT = 10;
  const INTERVAL = 10 * 60 * 1000;
  const MAX_CHARS = 1500000;

  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  class Backups {
    constructor(storage, now) {
      this.storage = storage;
      this.now = now;
    }

    // Copies, de la plus récente à la plus ancienne : [{ time, data }].
    list() {
      try {
        const list = JSON.parse(this.storage.getItem(KEY));
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    }

    // Copie des données, sauf si elles sont vides ou identiques à la dernière
    // copie. Sans force, attend INTERVAL depuis la dernière copie.
    // Renvoie true si une copie a été faite.
    save(data, force) {
      if (!data.pois.length && !data.paths.length) return false;
      const list = this.list();
      const last = list[0];
      if (last && JSON.stringify(last.data) === JSON.stringify(data)) return false;
      if (last && !force && this.now() - last.time < INTERVAL) return false;
      list.unshift({ time: this.now(), data });
      this.write(list.slice(0, LIMIT));
      return true;
    }

    write(list) {
      for (; list.length; list.pop()) {
        const json = JSON.stringify(list);
        if (json.length > MAX_CHARS) continue;
        try {
          this.storage.setItem(KEY, json);
          return;
        } catch {
          // Stockage plein : on retente sans la copie la plus ancienne.
        }
      }
      this.storage.removeItem(KEY);
    }

    // « 3 lieux · 1 chemin »
    static summary(data) {
      return `${plural(data.pois.length, 'lieu', 'lieux')} · ${plural(data.paths.length, 'chemin', 'chemins')}`;
    }
  }

  Backups.KEY = KEY;
  Backups.LIMIT = LIMIT;
  Backups.INTERVAL = INTERVAL;
  Backups.MAX_CHARS = MAX_CHARS;
  global.Backups = Backups;
})(window);
