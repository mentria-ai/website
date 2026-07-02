(function (global) {
  'use strict';

  const PREFIX = 'mentria.store.';
  const META_PREFIX = 'mentria.meta.';
  const LEGACY_PREFIX = 'mentria_';
  const EVENT_NAME = 'mentria:write';

  let persistCache = null;

  const fullKey = (ns, key) => PREFIX + ns + '.' + key;
  const metaKey = (ns, key) => META_PREFIX + ns + '.' + key;

  const rawSize = (raw) => {
    try { return new Blob([raw]).size; } catch (_) { return raw.length * 2; }
  };

  const writeMeta = (ns, key, raw, mtime) => {
    try {
      global.localStorage.setItem(metaKey(ns, key), JSON.stringify({ m: mtime, s: rawSize(raw) }));
    } catch (_) {}
  };

  const emit = (detail) => {
    try { global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail })); } catch (_) {}
  };

  const lsAvailable = (() => {
    try {
      const t = '__mentria_probe__';
      global.localStorage.setItem(t, t);
      global.localStorage.removeItem(t);
      return true;
    } catch (_) { return false; }
  })();

  const get = (ns, key) => {
    if (!lsAvailable) return null;
    try {
      const raw = global.localStorage.getItem(fullKey(ns, key));
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch (_) { return raw; }
    } catch (_) { return null; }
  };

  const getMeta = (ns, key) => {
    if (!lsAvailable) return null;
    try {
      const raw = global.localStorage.getItem(metaKey(ns, key));
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.m !== 'number' || typeof parsed.s !== 'number') return null;
      return { mtime: parsed.m, size: parsed.s };
    } catch (_) { return null; }
  };

  const set = (ns, key, value, opts) => {
    if (!lsAvailable) return false;
    opts = opts || {};
    try {
      const raw = JSON.stringify(value);
      const mtime = (opts && typeof opts.mtime === 'number') ? opts.mtime : Date.now();
      global.localStorage.setItem(fullKey(ns, key), raw);
      writeMeta(ns, key, raw, mtime);
      emit({ ns, key, op: 'set', value, remote: !!opts.remote, mtime });
      if (persistCache !== true) tryPersist();
      return true;
    } catch (err) {
      emit({ ns, key, op: 'error', error: String(err && err.message || err), remote: !!opts.remote });
      return false;
    }
  };

  const remove = (ns, key, opts) => {
    if (!lsAvailable) return false;
    opts = opts || {};
    try {
      global.localStorage.removeItem(fullKey(ns, key));
      try { global.localStorage.removeItem(metaKey(ns, key)); } catch (_) {}
      emit({ ns, key, op: 'remove', remote: !!opts.remote });
      return true;
    } catch (_) { return false; }
  };

  const list = (ns) => {
    if (!lsAvailable) return [];
    const out = [];
    const nsPrefix = PREFIX + ns + '.';
    try {
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (k && k.indexOf(nsPrefix) === 0) out.push(k.slice(nsPrefix.length));
      }
    } catch (_) {}
    return out;
  };

  const listNamespaces = () => {
    if (!lsAvailable) return [];
    const seen = new Set();
    try {
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (!k || k.indexOf(PREFIX) !== 0) continue;
        const parts = k.slice(PREFIX.length).split('.');
        if (!parts.length || !parts[0]) continue;
        let ns = parts[0];
        if (parts[0] === 'extdata' && parts.length > 1 && parts[1]) ns = parts[0] + '.' + parts[1];
        seen.add(ns);
      }
    } catch (_) {}
    return Array.from(seen).sort();
  };

  const clearNs = (ns) => {
    if (!lsAvailable) return 0;
    const nsPrefix = PREFIX + ns + '.';
    const metaNsPrefix = META_PREFIX + ns + '.';
    const victims = [];
    const metaVictims = [];
    try {
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (!k) continue;
        if (k.indexOf(nsPrefix) === 0) victims.push(k);
        else if (k.indexOf(metaNsPrefix) === 0) metaVictims.push(k);
      }
      victims.forEach((k) => global.localStorage.removeItem(k));
      metaVictims.forEach((k) => global.localStorage.removeItem(k));
    } catch (_) {}
    victims.forEach((k) => emit({ ns, key: k.slice(nsPrefix.length), op: 'remove' }));
    return victims.length;
  };

  const exportAll = () => {
    const store = {};
    const legacy = {};
    if (!lsAvailable) return { version: 1, exportedAt: new Date().toISOString(), store, legacy };
    try {
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (!k) continue;
        const v = global.localStorage.getItem(k);
        if (k.indexOf(PREFIX) === 0) {
          store[k.slice(PREFIX.length)] = v;
        } else if (k.indexOf(LEGACY_PREFIX) === 0) {
          legacy[k] = v;
        }
      }
    } catch (_) {}
    return { version: 1, exportedAt: new Date().toISOString(), store, legacy };
  };

  const importAll = (payload, opts) => {
    opts = opts || {};
    const mode = opts.mode === 'replace' ? 'replace' : 'merge';
    if (!payload || typeof payload !== 'object') {
      throw new Error('invalid payload');
    }
    if (payload.version !== 1) {
      throw new Error('unknown backup version: ' + payload.version);
    }
    const store = (payload.store && typeof payload.store === 'object') ? payload.store : {};
    const legacy = (payload.legacy && typeof payload.legacy === 'object') ? payload.legacy : {};

    if (mode === 'replace') {
      const victims = [];
      try {
        for (let i = 0; i < global.localStorage.length; i++) {
          const k = global.localStorage.key(i);
          if (!k) continue;
          if (k.indexOf(PREFIX) === 0 || k.indexOf(LEGACY_PREFIX) === 0 || k.indexOf(META_PREFIX) === 0) victims.push(k);
        }
        victims.forEach((k) => global.localStorage.removeItem(k));
      } catch (_) {}
    }

    let restored = 0;
    try {
      Object.keys(store).forEach((suffix) => {
        if (typeof suffix !== 'string') return;
        global.localStorage.setItem(PREFIX + suffix, String(store[suffix]));
        restored++;
      });
      Object.keys(legacy).forEach((k) => {
        if (typeof k !== 'string' || k.indexOf(LEGACY_PREFIX) !== 0) return;
        global.localStorage.setItem(k, String(legacy[k]));
        restored++;
      });
    } catch (err) {
      throw new Error('write failed: ' + (err && err.message || err));
    }
    Object.keys(store).forEach((suffix) => {
      if (typeof suffix !== 'string') return;
      try {
        global.localStorage.setItem(META_PREFIX + suffix, JSON.stringify({ m: Date.now(), s: rawSize(String(store[suffix])) }));
      } catch (_) {}
    });
    return { restored };
  };

  const tryPersist = async () => {
    if (persistCache !== null) return persistCache;
    if (!global.navigator || !global.navigator.storage || !global.navigator.storage.persist) {
      persistCache = false;
      return false;
    }
    try {
      const already = global.navigator.storage.persisted ? await global.navigator.storage.persisted() : false;
      if (already) { persistCache = true; return true; }
      const granted = await global.navigator.storage.persist();
      persistCache = !!granted;
      return persistCache;
    } catch (_) {
      persistCache = false;
      return false;
    }
  };

  const requestPersist = tryPersist;

  const estimate = async () => {
    if (!global.navigator || !global.navigator.storage || !global.navigator.storage.estimate) {
      return { usage: null, quota: null };
    }
    try {
      const e = await global.navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    } catch (_) {
      return { usage: null, quota: null };
    }
  };

  const persisted = async () => {
    if (!global.navigator || !global.navigator.storage || !global.navigator.storage.persisted) return false;
    try { return !!(await global.navigator.storage.persisted()); } catch (_) { return false; }
  };

  global.MentriaStore = {
    get, set, remove, list, clear: clearNs,
    getMeta, listNamespaces,
    exportAll, importAll,
    requestPersist, estimate, persisted,
    EVENT_NAME
  };
})(typeof window !== 'undefined' ? window : globalThis);
