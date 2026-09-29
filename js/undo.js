/*
 * Annuler / rétablir : piles d'instantanés (JSON) des données de la carte.
 *
 * Chaque modification locale empile l'état précédent. Un état reçu d'un autre
 * appareil vide les piles : annuler ne doit jamais défaire les modifications
 * de quelqu'un d'autre.
 */
(function (global) {
  'use strict';

  const LIMIT = 50;

  class UndoStack {
    constructor(snapshot) {
      this.reset(snapshot);
    }

    // Nouvel état après une modification locale.
    record(snapshot) {
      if (snapshot === this.current) return;
      this.undos.push(this.current);
      if (this.undos.length > LIMIT) this.undos.shift();
      this.current = snapshot;
      this.redos = [];
    }

    // Nouvel état venu d'ailleurs : l'historique repart de là.
    reset(snapshot) {
      this.current = snapshot;
      this.undos = [];
      this.redos = [];
    }

    get canUndo() {
      return this.undos.length > 0;
    }

    get canRedo() {
      return this.redos.length > 0;
    }

    // État à restaurer, ou null s'il n'y a rien à annuler.
    undo() {
      if (!this.canUndo) return null;
      this.redos.push(this.current);
      this.current = this.undos.pop();
      return this.current;
    }

    redo() {
      if (!this.canRedo) return null;
      this.undos.push(this.current);
      this.current = this.redos.pop();
      return this.current;
    }
  }

  UndoStack.LIMIT = LIMIT;
  global.UndoStack = UndoStack;
})(window);
