/*
 * Synchronisation cloud par code (worker Cloudflare, voir worker/README.md).
 *
 * Le worker stocke un instantané { version, data } par code. Chaque appareil
 * garde la dernière version reçue (« base ») : une modification locale est
 * poussée avec baseVersion ; si un autre appareil a écrit entre-temps (409),
 * on fusionne base / local / distant POI par POI et chemin par chemin, puis
 * on repousse.
 */
(function (global) {
  'use strict';

  const STATE_KEY = 'minecarte:sync';
  const POLL_MS = 30000;
  const PUSH_DELAY_MS = 1500;

  // JSON à clés triées : deux objets égaux donnent la même chaîne quel que
  // soit l'ordre d'insertion de leurs propriétés.
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  function snapshot(data) {
    return { seed: data.seed, pois: data.pois, paths: data.paths, backgrounds: data.backgrounds };
  }

  // Fusion à trois voies, élément par élément (par id) : on garde le côté qui
  // a changé par rapport à la base ; si les deux ont changé, le local gagne.
  // Un élément absent d'un côté mais présent dans la base a été supprimé.
  function merge(base, local, remote) {
    const b = base || {};
    const pick = (bv, lv, rv) => {
      if (stable(lv) === stable(bv)) return rv;
      if (stable(rv) === stable(bv)) return lv;
      return lv;
    };
    const list = (key) => {
      const index = (arr) => new Map((arr || []).map((item) => [item.id, item]));
      const bm = index(b[key]);
      const lm = index(local[key]);
      const rm = index(remote[key]);
      const ids = [...new Set([...rm.keys(), ...lm.keys()])];
      return ids.map((id) => pick(bm.get(id), lm.get(id), rm.get(id))).filter(Boolean);
    };
    return {
      seed: pick(b.seed, local.seed, remote.seed) || local.seed,
      pois: list('pois'),
      paths: list('paths'),
      backgrounds: list('backgrounds'),
    };
  }

  function normalizeCode(raw) {
    return String(raw || '').toUpperCase().replace(/[\s-]/g, '');
  }

  function isValidCode(code) {
    return /^[ABCDEFGHJKMNPQRSTWXYZ23456789]{8}$/.test(code);
  }

  function formatCode(code) {
    return code ? `${code.slice(0, 4)}-${code.slice(4)}` : '';
  }

  class CloudSync {
    // hooks.getBlob(hash) : image locale d'un fond (Blob ou null), pour l'envoyer.
    constructor(store, url, onStatus, hooks) {
      this.store = store;
      this.hooks = hooks || {};
      this.url = String(url || '').replace(/\/+$/, '');
      this.onStatus = onStatus || (() => {});
      this.state = this.loadState();
      this.status = { kind: this.state ? 'idle' : 'off', message: '', at: null };
      this.queue = Promise.resolve();
      this.pushTimer = null;
      this.pollTimer = null;
    }

    get enabled() {
      return !!this.url;
    }

    get code() {
      return this.state && this.state.code;
    }

    loadState() {
      try {
        const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
        return s && isValidCode(s.code) && Number.isInteger(s.version) ? s : null;
      } catch (e) {
        return null;
      }
    }

    saveState() {
      try {
        if (this.state) localStorage.setItem(STATE_KEY, JSON.stringify(this.state));
        else localStorage.removeItem(STATE_KEY);
      } catch (e) {
        /* stockage indisponible */
      }
    }

    setStatus(kind, message) {
      this.status = { kind, message: message || '', at: kind === 'idle' ? new Date() : this.status.at };
      this.onStatus(this.status);
    }

    start() {
      if (!this.enabled) return;
      this.store.onChange((data, source) => {
        if (source !== 'remote' && this.state) this.schedulePush();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.pull();
      });
      this.pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') this.pull();
      }, POLL_MS);
      this.onStatus(this.status);
      if (this.state) this.pull();
    }

    // Les opérations réseau sont sérialisées pour ne jamais se chevaucher.
    enqueue(fn) {
      const run = this.queue.then(fn, fn);
      this.queue = run.catch(() => {});
      return run;
    }

    async request(method, path, body) {
      const res = await fetch(`${this.url}/api/sync${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try {
        json = await res.json();
      } catch (e) {
        /* réponse vide */
      }
      return { status: res.status, json };
    }

    fail(err) {
      const message = err && err.status === 404
        ? 'Code inconnu ou expiré.'
        : 'Synchronisation impossible (hors ligne ?). Nouvel essai automatique.';
      this.setStatus('error', message);
      throw err;
    }

    isDirty() {
      return !this.state.base || stable(snapshot(this.store.data)) !== stable(this.state.base);
    }

    // Applique des données fusionnées sans déclencher de nouvelle poussée.
    apply(data) {
      if (stable(snapshot(this.store.data)) === stable(snapshot(data))) return;
      this.store.replaceAll(Object.assign({}, this.store.data, data), 'remote');
    }

    create() {
      return this.enqueue(async () => {
        this.setStatus('syncing');
        try {
          const res = await this.request('POST', '');
          if (res.status !== 201) throw res;
          this.state = { code: res.json.code, version: 0, base: null };
          this.saveState();
        } catch (err) {
          this.fail(err);
        }
        await this.pushNow();
        return this.state.code;
      });
    }

    join(rawCode) {
      const code = normalizeCode(rawCode);
      if (!isValidCode(code)) return Promise.reject(new Error('Code invalide : 8 caractères attendus.'));
      return this.enqueue(async () => {
        this.setStatus('syncing');
        let res;
        try {
          res = await this.request('GET', `/${code}`);
          if (res.status !== 200) throw res;
        } catch (err) {
          this.setStatus(this.state ? 'error' : 'off', err.status === 404 ? 'Code inconnu ou expiré.' : 'Connexion au cloud impossible.');
          throw new Error(err.status === 404 ? 'Code inconnu ou expiré.' : 'Connexion au cloud impossible.');
        }
        // Rejoindre fusionne les données de l'appareil avec celles du code.
        if (res.json.data) this.apply(merge(null, snapshot(this.store.data), res.json.data));
        this.state = { code, version: res.json.version, base: res.json.data };
        this.saveState();
        if (this.isDirty()) await this.pushNow();
        else this.setStatus('idle');
        return code;
      });
    }

    leave() {
      clearTimeout(this.pushTimer);
      this.state = null;
      this.saveState();
      this.setStatus('off');
    }

    schedulePush() {
      clearTimeout(this.pushTimer);
      this.setStatus('pending');
      this.pushTimer = setTimeout(() => this.enqueue(() => this.pushNow()).catch(() => {}), PUSH_DELAY_MS);
    }

    async pushNow() {
      if (!this.state) return;
      this.setStatus('syncing');
      for (let attempt = 0; attempt < 5; attempt++) {
        const data = snapshot(this.store.data);
        let res;
        try {
          await this.uploadNewImages(data);
          res = await this.request('PUT', `/${this.state.code}`, { baseVersion: this.state.version, data });
        } catch (err) {
          return this.fail(err);
        }
        if (res.status === 200) {
          this.state.version = res.json.version;
          this.state.base = res.json.data;
          this.saveState();
          // Une modification faite pendant l'envoi repartira au prochain tour.
          if (this.isDirty()) continue;
          if (this.warning) {
            this.setStatus('error', this.warning);
            this.warning = null;
          } else {
            this.setStatus('idle');
          }
          return;
        }
        if (res.status !== 409) return this.fail(res);
        this.apply(merge(this.state.base, data, res.json.data || {}));
        this.state.version = res.json.version;
        this.state.base = res.json.data;
        this.saveState();
      }
      this.fail(new Error('Trop de conflits'));
    }

    // Envoie les images des fonds absents de la dernière version connue du
    // serveur (celles qu'il a déjà sont conservées tant qu'elles sont référencées).
    async uploadNewImages(data) {
      const known = new Set(((this.state.base && this.state.base.backgrounds) || []).map((b) => b.hash));
      for (const bg of data.backgrounds || []) {
        if (known.has(bg.hash)) continue;
        known.add(bg.hash);
        const blob = this.hooks.getBlob ? await this.hooks.getBlob(bg.hash) : null;
        if (!blob) continue; // image d'un autre appareil pas encore reçue : elle est déjà dans le cloud
        const res = await fetch(`${this.url}/api/sync/${this.state.code}/blob/${bg.hash}`, {
          method: 'PUT',
          headers: { 'Content-Type': bg.type || blob.type || 'image/png' },
          body: blob,
        });
        if (res.status === 413) {
          this.warning = `Image « ${bg.name} » trop volumineuse pour le cloud (20 Mo max) : elle reste sur cet appareil.`;
          continue;
        }
        if (!res.ok) throw { status: res.status };
      }
    }

    // Télécharge l'image d'un fond depuis le cloud (Blob ou null si absente).
    async fetchBlob(hash) {
      if (!this.state) return null;
      const res = await fetch(`${this.url}/api/sync/${this.state.code}/blob/${hash}`);
      if (res.status === 404) return null;
      if (!res.ok) throw { status: res.status };
      return res.blob();
    }

    pull() {
      if (!this.state) return Promise.resolve();
      return this.enqueue(async () => {
        if (!this.state) return;
        let res;
        try {
          res = await this.request('GET', `/${this.state.code}`);
          if (res.status !== 200) throw res;
        } catch (err) {
          return this.fail(err);
        }
        if (res.json.version !== this.state.version) {
          this.apply(merge(this.state.base, snapshot(this.store.data), res.json.data || {}));
          this.state.version = res.json.version;
          this.state.base = res.json.data;
          this.saveState();
        }
        if (this.isDirty()) await this.pushNow();
        else this.setStatus('idle');
      }).catch(() => {});
    }
  }

  global.CloudSync = CloudSync;
  global.CloudSync.formatCode = formatCode;
  global.CloudSync.merge = merge;
})(window);
