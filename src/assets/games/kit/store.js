const GAMES_NS = 'games';
const GHOST_MAX_CHARS = 60000;
const memoryFallback = new Map();

function backend() {
  try {
    if (typeof window !== 'undefined' && window.MentriaStore && typeof window.MentriaStore.get === 'function') return window.MentriaStore;
  } catch (_) {}
  return null;
}

function readKey(key) {
  const s = backend();
  if (s) {
    try {
      const v = s.get(GAMES_NS, key);
      return v == null ? null : v;
    } catch (_) {
      return null;
    }
  }
  return memoryFallback.has(key) ? memoryFallback.get(key) : null;
}

function writeKey(key, value) {
  const s = backend();
  if (s) {
    try { return s.set(GAMES_NS, key, value) !== false; } catch (_) { return false; }
  }
  memoryFallback.set(key, value);
  return true;
}

function removeKey(key) {
  const s = backend();
  if (s) {
    try { return s.remove(GAMES_NS, key) !== false; } catch (_) { return false; }
  }
  return memoryFallback.delete(key);
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function cleanId(id) {
  return String(id == null ? '' : id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'default';
}

const MEDAL_RANK = { gold: 3, silver: 2, bronze: 1 };

export function gameStore(slug, opts = {}) {
  const base = cleanId(slug);
  const defaults = isPlainObject(opts.defaults) ? opts.defaults : {};
  const settingsKey = base + '.settings';
  const recordsKey = base + '.records';
  const ghostKey = function (courseId) { return base + '.ghost.' + cleanId(courseId); };

  function settings(extraDefaults) {
    const stored = readKey(settingsKey);
    return Object.assign({}, defaults, isPlainObject(extraDefaults) ? extraDefaults : null, isPlainObject(stored) ? stored : null);
  }

  function saveSettings(patch) {
    const stored = readKey(settingsKey);
    const next = Object.assign({}, isPlainObject(stored) ? stored : null, isPlainObject(patch) ? patch : null);
    writeKey(settingsKey, next);
    return Object.assign({}, defaults, next);
  }

  function records() {
    const r = readKey(recordsKey);
    return isPlainObject(r) ? r : {};
  }

  function record(courseId) {
    const r = records()[cleanId(courseId)];
    return isPlainObject(r) ? r : null;
  }

  function saveRecord(courseId, rec, force) {
    const id = cleanId(courseId);
    const all = records();
    const prev = isPlainObject(all[id]) ? all[id] : null;
    const time = rec && typeof rec.time === 'number' && isFinite(rec.time) ? rec.time : null;
    if (time == null) return { isBest: false, previous: prev, record: prev };
    const prevTime = prev && typeof prev.time === 'number' ? prev.time : Infinity;
    const isBest = force === true || time < prevTime;
    const prevMedal = prev && MEDAL_RANK[prev.medal] ? prev.medal : null;
    const newMedal = rec.medal && MEDAL_RANK[rec.medal] ? rec.medal : null;
    const bestMedal = (MEDAL_RANK[newMedal] || 0) >= (MEDAL_RANK[prevMedal] || 0) ? newMedal : prevMedal;
    let next;
    if (isBest) {
      next = Object.assign({}, rec, { time, medal: bestMedal, date: rec.date || Date.now(), runs: ((prev && prev.runs) || 0) + 1 });
    } else {
      next = Object.assign({}, prev, { medal: bestMedal, runs: ((prev && prev.runs) || 0) + 1 });
    }
    all[id] = next;
    writeKey(recordsKey, all);
    return { isBest, previous: prev, record: next };
  }

  function ghost(courseId) {
    const g = readKey(ghostKey(courseId));
    return typeof g === 'string' && g.length ? g : null;
  }

  function saveGhost(courseId, str) {
    if (typeof str !== 'string' || !str.length || str.length > GHOST_MAX_CHARS) return false;
    return writeKey(ghostKey(courseId), str);
  }

  function clearGhost(courseId) {
    return removeKey(ghostKey(courseId));
  }

  function clearRecords() {
    removeKey(recordsKey);
    return true;
  }

  return {
    slug: base,
    settings,
    saveSettings,
    records,
    record,
    saveRecord,
    ghost,
    saveGhost,
    clearGhost,
    clearRecords,
    persistent: !!backend(),
    dispose: function () {}
  };
}
