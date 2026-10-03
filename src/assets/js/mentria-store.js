(function (global) {
  'use strict';

  const PREFIX = 'mentria.store.';
  const META_PREFIX = 'mentria.meta.';
  const LEGACY_PREFIX = 'mentria_';
  const EVENT_NAME = 'mentria:write';
  const PROBE_KEY = '__mentria_probe__';

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

  const isQuota = (err) => !!err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014);

  const lsAvailable = (() => {
    try {
      const ls = global.localStorage;
      if (!ls) return false;
      ls.getItem(PROBE_KEY);
      return true;
    } catch (_) { return false; }
  })();

  const failReason = (err) => {
    if (isQuota(err)) return 'full';
    if (err && err.name === 'SecurityError') return 'blocked';
    return 'error';
  };

  let writeState = lsAvailable ? 'ok' : 'blocked';
  if (lsAvailable) {
    try {
      global.localStorage.setItem(PROBE_KEY, PROBE_KEY);
      global.localStorage.removeItem(PROBE_KEY);
    } catch (err) {
      writeState = failReason(err) === 'full' ? 'full' : 'blocked';
    }
  }

  const noteWrite = (reason) => {
    if (reason === 'ok' || reason === 'full' || reason === 'blocked') writeState = reason;
  };

  const status = () => writeState;

  const storageError = (reason, cause) => {
    const detail = cause ? ': ' + String(cause.message || cause) : '';
    const err = new Error((reason === 'blocked' ? 'storage blocked' : reason === 'read' ? 'storage read failed' : 'write failed') + detail);
    err.reason = reason;
    return err;
  };

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

  const TOMB_KEY = 'mentria-sync-tombstones';
  const TOMB_CAP = 500;

  const tombWrite = (fn) => {
    try {
      const raw = global.localStorage.getItem(TOMB_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const tombs = (parsed && typeof parsed === 'object') ? parsed : {};
      if (!fn(tombs)) return;
      const keys = Object.keys(tombs);
      if (keys.length > TOMB_CAP) {
        keys.sort((a, b) => (Number(tombs[a]) || 0) - (Number(tombs[b]) || 0));
        keys.slice(0, keys.length - TOMB_CAP).forEach((k) => { delete tombs[k]; });
      }
      global.localStorage.setItem(TOMB_KEY, JSON.stringify(tombs));
    } catch (_) {}
  };

  const set = (ns, key, value, opts) => {
    opts = opts || {};
    if (!lsAvailable) {
      emit({ ns, key, op: 'error', reason: 'blocked', error: 'storage blocked', remote: !!opts.remote });
      return false;
    }
    try {
      const raw = JSON.stringify(value);
      const mtime = (opts && typeof opts.mtime === 'number') ? opts.mtime : Date.now();
      global.localStorage.setItem(fullKey(ns, key), raw);
      noteWrite('ok');
      writeMeta(ns, key, raw, mtime);
      tombWrite((tombs) => {
        const suffix = ns + '.' + key;
        if (!(suffix in tombs)) return false;
        delete tombs[suffix];
        return true;
      });
      emit({ ns, key, op: 'set', value, remote: !!opts.remote, mtime });
      if (persistCache !== true) tryPersist();
      return true;
    } catch (err) {
      const reason = failReason(err);
      noteWrite(reason);
      emit({ ns, key, op: 'error', reason, error: String(err && err.message || err), remote: !!opts.remote });
      return false;
    }
  };

  const remove = (ns, key, opts) => {
    if (!lsAvailable) return false;
    opts = opts || {};
    try {
      global.localStorage.removeItem(fullKey(ns, key));
      try { global.localStorage.removeItem(metaKey(ns, key)); } catch (_) {}
      if (!opts.remote) {
        tombWrite((tombs) => {
          const suffix = ns + '.' + key;
          const m = Date.now();
          if ((suffix in tombs) && tombs[suffix] >= m) return false;
          tombs[suffix] = m;
          return true;
        });
      }
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

  const LOCAL_KEYS = ['tools.ruler_calibration', 'tools.decibel_settings', 'tools.countdown_active', 'ui.mini', 'handoff.md', 'comms.ring_token', 'comms.selftest_token', 'comms.ring_announced'];
  const LOCAL_KEY_PREFIXES = ['ui.fullscreen.'];
  const LOCAL_LEGACY = ['mentria_lang', 'mentria_lang_redirected_at', 'mentria_seen', 'mentria_caps'];
  const VAULTS = ['totp.vault', 'identity.vault'];
  const NOTE_LISTS = ['quick_notes.blob', 'quick_notes.inbox'];
  const DELETE_MAPS = ['quick_notes.deleted', 'tools.color_picker_deleted'];

  const isLocalOnly = (suffix) => LOCAL_KEYS.indexOf(suffix) >= 0 || LOCAL_KEY_PREFIXES.some((p) => suffix.indexOf(p) === 0);
  const isLocalLegacy = (k) => LOCAL_LEGACY.indexOf(k) >= 0;

  const parseJson = (raw) => {
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  };

  const portable = (suffix, raw) => {
    if (suffix !== 'identity.vault') return raw;
    const v = parseJson(raw);
    if (!v || typeof v !== 'object' || !v.device) return raw;
    delete v.device;
    return JSON.stringify(v);
  };

  const adopt = (suffix, raw) => {
    if (suffix !== 'identity.vault') return raw;
    const incoming = parseJson(raw);
    if (!incoming || typeof incoming !== 'object') return raw;
    const local = lsAvailable ? parseJson(global.localStorage.getItem(PREFIX + suffix)) : null;
    if (local && local.device && local.kcv && local.kcv === incoming.kcv) incoming.device = local.device;
    else delete incoming.device;
    return JSON.stringify(incoming);
  };

  const mergeNotes = (localArr, incomingArr, deletedMap) => {
    const byId = new Map();
    const consider = (note) => {
      if (!note || typeof note !== 'object' || note.id == null) return;
      const id = String(note.id);
      const del = (deletedMap && typeof deletedMap[id] === 'number') ? deletedMap[id] : null;
      if (del != null && del > (Number(note.updatedAt) || 0)) return;
      const existing = byId.get(id);
      if (!existing || (Number(note.updatedAt) || 0) > (Number(existing.updatedAt) || 0)) byId.set(id, note);
    };
    (Array.isArray(localArr) ? localArr : []).forEach(consider);
    (Array.isArray(incomingArr) ? incomingArr : []).forEach(consider);
    return Array.from(byId.values()).sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  };

  const maxMergeMap = (a, b, cap) => {
    const out = {};
    [a, b].forEach((m) => {
      if (!m || typeof m !== 'object') return;
      Object.keys(m).forEach((k) => {
        const v = Number(m[k]);
        if (!isFinite(v)) return;
        if (!(k in out) || v > out[k]) out[k] = v;
      });
    });
    const keys = Object.keys(out);
    if (cap && keys.length > cap) {
      keys.sort((x, y) => out[x] - out[y]).slice(0, keys.length - cap).forEach((k) => { delete out[k]; });
    }
    return out;
  };

  const exportAll = () => {
    if (!lsAvailable) throw storageError('blocked');
    const store = {};
    const legacy = {};
    let found = 0;
    let read = 0;
    try {
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (!k) continue;
        const isStore = k.indexOf(PREFIX) === 0;
        if (isStore ? isLocalOnly(k.slice(PREFIX.length)) : (k.indexOf(LEGACY_PREFIX) !== 0 || isLocalLegacy(k))) continue;
        found++;
        const v = global.localStorage.getItem(k);
        if (v == null) continue;
        read++;
        if (isStore) store[k.slice(PREFIX.length)] = portable(k.slice(PREFIX.length), v);
        else legacy[k] = v;
      }
    } catch (err) {
      throw storageError(failReason(err) === 'blocked' ? 'blocked' : 'read', err);
    }
    if (found && !read) throw storageError('read');
    return { version: 1, exportedAt: new Date().toISOString(), store, legacy };
  };

  const planImport = (payload) => {
    if (!lsAvailable) throw storageError('blocked');
    const plan = { add: [], same: [], merge: [], replace: [], vaults: [] };
    const store = (payload && payload.store && typeof payload.store === 'object') ? payload.store : {};
    Object.keys(store).forEach((suffix) => {
      if (isLocalOnly(suffix)) return;
      const incoming = adopt(suffix, String(store[suffix]));
      const local = global.localStorage.getItem(PREFIX + suffix);
      if (local == null) { plan.add.push(suffix); return; }
      if (local === incoming) { plan.same.push(suffix); return; }
      if (NOTE_LISTS.indexOf(suffix) >= 0 || DELETE_MAPS.indexOf(suffix) >= 0) { plan.merge.push(suffix); return; }
      if (VAULTS.indexOf(suffix) >= 0) { plan.vaults.push(suffix); return; }
      plan.replace.push(suffix);
    });
    const legacy = (payload && payload.legacy && typeof payload.legacy === 'object') ? payload.legacy : {};
    Object.keys(legacy).forEach((k) => {
      if (k.indexOf(LEGACY_PREFIX) !== 0 || isLocalLegacy(k)) return;
      const local = global.localStorage.getItem(k);
      if (local == null) plan.add.push(k);
      else if (local === String(legacy[k])) plan.same.push(k);
      else plan.replace.push(k);
    });
    return plan;
  };

  const AREA_NAMES = {
    invoice: 'invoices', totp: 'TOTP accounts', identity: 'Comms identity', comms: 'Comms rooms and contacts',
    quick_notes: 'notes', packs: 'learning progress', games: 'game saves and scores', tools: 'tool settings',
    ui: 'layout settings', ai_chat: 'AI chat', ext: 'extensions', extdata: 'extension data', feed: 'feed progress'
  };

  const areaNames = (suffixes) => {
    const t = (key, fallback) => {
      try {
        const I = global.MentriaI18n;
        const v = I && typeof I.t === 'function' ? I.t(key) : null;
        if (typeof v === 'string' && v && v !== key) return v;
      } catch (_) {}
      return fallback;
    };
    const out = [];
    (suffixes || []).forEach((suffix) => {
      let ns = String(suffix).split('.')[0];
      if (ns.indexOf(LEGACY_PREFIX) === 0) ns = /^mentria_(chess|ludo|sudoku|msw)/.test(ns) ? 'games' : 'tools';
      if (ns === 'tool') ns = 'games';
      if (!(ns in AREA_NAMES)) ns = 'other';
      const name = t('common.data_areas.' + ns, AREA_NAMES[ns] || 'other saved data');
      if (out.indexOf(name) < 0) out.push(name);
    });
    return out;
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
    if (!lsAvailable) throw storageError('blocked');
    const store = (payload.store && typeof payload.store === 'object') ? payload.store : {};
    const legacy = (payload.legacy && typeof payload.legacy === 'object') ? payload.legacy : {};
    const skip = Array.isArray(opts.skip) ? opts.skip : [];
    const backupTime = Date.parse(payload.exportedAt);
    const restoredMtime = isFinite(backupTime) && backupTime <= Date.now() ? backupTime : Date.now();

    const writes = [];
    const deletedNotes = maxMergeMap(parseJson(global.localStorage.getItem(PREFIX + 'quick_notes.deleted')), parseJson(store['quick_notes.deleted']), 200);
    Object.keys(store).forEach((suffix) => {
      if (typeof suffix !== 'string' || isLocalOnly(suffix) || skip.indexOf(suffix) >= 0) return;
      let raw = adopt(suffix, String(store[suffix]));
      let mtime = restoredMtime;
      const local = mode === 'merge' ? global.localStorage.getItem(PREFIX + suffix) : null;
      if (local != null && local !== raw) {
        if (NOTE_LISTS.indexOf(suffix) >= 0) { raw = JSON.stringify(mergeNotes(parseJson(local), parseJson(raw), deletedNotes)); mtime = Date.now(); }
        else if (DELETE_MAPS.indexOf(suffix) >= 0) { raw = JSON.stringify(maxMergeMap(parseJson(local), parseJson(raw), 200)); mtime = Date.now(); }
      }
      if (local != null && local === raw) return;
      writes.push({ key: PREFIX + suffix, meta: META_PREFIX + suffix, raw, mtime });
    });
    Object.keys(legacy).forEach((k) => {
      if (typeof k !== 'string' || k.indexOf(LEGACY_PREFIX) !== 0 || isLocalLegacy(k) || skip.indexOf(k) >= 0) return;
      writes.push({ key: k, meta: null, raw: String(legacy[k]), mtime: restoredMtime });
    });

    const undo = [];
    const remember = (k) => { if (k) undo.push({ k, v: global.localStorage.getItem(k) }); };
    const rollback = () => {
      for (let i = undo.length - 1; i >= 0; i--) {
        try {
          if (undo[i].v == null) global.localStorage.removeItem(undo[i].k);
          else global.localStorage.setItem(undo[i].k, undo[i].v);
        } catch (_) {}
      }
    };

    try {
      if (mode === 'replace') {
        const victims = [];
        for (let i = 0; i < global.localStorage.length; i++) {
          const k = global.localStorage.key(i);
          if (!k) continue;
          if (k.indexOf(PREFIX) === 0 && isLocalOnly(k.slice(PREFIX.length))) continue;
          if (k.indexOf(META_PREFIX) === 0 && isLocalOnly(k.slice(META_PREFIX.length))) continue;
          if (k.indexOf(LEGACY_PREFIX) === 0 && isLocalLegacy(k)) continue;
          if (k.indexOf(PREFIX) === 0 || k.indexOf(LEGACY_PREFIX) === 0 || k.indexOf(META_PREFIX) === 0) victims.push(k);
        }
        victims.forEach((k) => { remember(k); global.localStorage.removeItem(k); });
      }
      writes.forEach((w) => {
        remember(w.key);
        global.localStorage.setItem(w.key, w.raw);
        if (w.meta) {
          remember(w.meta);
          global.localStorage.setItem(w.meta, JSON.stringify({ m: w.mtime, s: rawSize(w.raw) }));
        }
      });
    } catch (err) {
      rollback();
      const reason = failReason(err);
      noteWrite(reason);
      throw storageError(reason, err);
    }
    if (writes.length) noteWrite('ok');
    return { restored: writes.length };
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
    get, set, remove, list, clear: clearNs, status,
    getMeta, listNamespaces,
    exportAll, importAll, planImport, areaNames,
    isLocalOnly, isLocalLegacy, adopt, mergeNotes, maxMergeMap,
    requestPersist, estimate, persisted,
    EVENT_NAME
  };
})(typeof window !== 'undefined' ? window : globalThis);
