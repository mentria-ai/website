(function (global) {
  'use strict';

  const ITER = 600000;
  const HASH = 'SHA-256';
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const KEY_LENGTH = 256;
  const ENVELOPE_VERSION = 2;
  const FILE_VERSION = 3;
  const ARCHIVE_VERSION = 2;
  const ARCHIVE_FORMAT = 'mentria-backup';
  const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
  const MEMORY_FILE_BYTES = 256 * 1024 * 1024;
  const MAX_JSON_FRAME = 256 * 1024 * 1024;
  const CHUNK_BYTES = 4 * 1024 * 1024;
  const READ_SLICE = 8 * 1024 * 1024;
  const LARGE_BYTES = 100 * 1024 * 1024;
  const FRAME_JSON = 0x4a;
  const FRAME_BIN = 0x42;
  const CT_OPEN = ',"ct":[';
  const CAN_GZIP = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  const toUtf8 = new TextEncoder();
  const fromUtf8 = new TextDecoder();

  const pipeBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  const isGzip = (bytes) => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

  const b64uEncode = (bytes) => {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const b64uDecode = (str) => {
    if (typeof str !== 'string') throw new Error('expected base64url string');
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (b64.length % 4)) % 4;
    const decoded = atob(b64 + '='.repeat(pad));
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
    return out;
  };

  const deriveFrom = async (passphrase, saltBytes, iterations, usages) => {
    const baseKey = await crypto.subtle.importKey('raw', toUtf8.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: HASH },
      baseKey,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      usages
    );
  };

  const deriveKey = async (passphrase, saltBytes) => {
    if (typeof passphrase !== 'string' || passphrase.length < 8) {
      throw new Error('passphrase must be at least 8 characters');
    }
    return deriveFrom(passphrase, saltBytes, ITER, ['encrypt', 'decrypt']);
  };

  const encryptBackup = async (data, passphrase) => {
    const json = JSON.stringify(data);
    const plaintext = new TextEncoder().encode(json);
    if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
      throw new Error('payload too large');
    }
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(passphrase, salt);
    const body = CAN_GZIP ? await pipeBytes(plaintext, new CompressionStream('gzip')) : plaintext;
    const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, body);
    return {
      v: CAN_GZIP ? ENVELOPE_VERSION : 1,
      kdf: 'PBKDF2',
      iter: ITER,
      hash: HASH,
      salt: b64uEncode(salt),
      iv: b64uEncode(iv),
      ct: b64uEncode(new Uint8Array(ctBuf))
    };
  };

  const validateEnvelope = (env) => {
    if (!env || typeof env !== 'object') throw new Error('not an envelope');
    if (env.v !== 1 && env.v !== ENVELOPE_VERSION) throw new Error('unsupported envelope version: ' + env.v);
    if (env.kdf !== 'PBKDF2') throw new Error('unsupported kdf: ' + env.kdf);
    if (env.hash !== 'SHA-256') throw new Error('unsupported hash: ' + env.hash);
    if (typeof env.iter !== 'number' || env.iter < 100000 || env.iter > 10000000) {
      throw new Error('iteration count out of range');
    }
    for (const k of ['salt', 'iv', 'ct']) {
      if (typeof env[k] !== 'string' || env[k].length === 0 || env[k].length > 8 * 1024 * 1024) {
        throw new Error('missing or oversized field: ' + k);
      }
    }
  };

  const decryptBackup = async (envelope, passphrase) => {
    validateEnvelope(envelope);
    const salt = b64uDecode(envelope.salt);
    const iv = b64uDecode(envelope.iv);
    const ct = b64uDecode(envelope.ct);
    if (salt.byteLength !== SALT_BYTES) throw new Error('bad salt length');
    if (iv.byteLength !== IV_BYTES) throw new Error('bad iv length');

    const key = await deriveFrom(passphrase, salt, envelope.iter, ['decrypt']);

    let ptBuf;
    try {
      ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    } catch (_) {
      throw new Error('wrong passphrase or corrupted file');
    }
    let pt = new Uint8Array(ptBuf);
    if (isGzip(pt)) {
      if (!CAN_GZIP) throw new Error('this browser cannot open compressed backups');
      pt = await pipeBytes(pt, new DecompressionStream('gzip'));
      if (pt.byteLength > MAX_PAYLOAD_BYTES * 2) throw new Error('payload too large');
    }
    const text = new TextDecoder().decode(pt);
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error('decrypted payload is not valid JSON'); }
    if (!parsed || typeof parsed !== 'object') throw new Error('decrypted payload is not an object');
    return parsed;
  };

  const localDay = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const backupName = (stem) => (stem || 'mentria-backup') + '-' + localDay() + '.json';

  const listJoin = (items) => {
    const list = Array.from(items || [], String);
    try {
      return new Intl.ListFormat(document.documentElement.lang || undefined, { style: 'long', type: 'conjunction' }).format(list);
    } catch (_) {
      return list.join(', ');
    }
  };

  const downloadBlob = (blob, filenameStem) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupName(filenameStem);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const downloadBackupJson = (envelope, filenameStem) => {
    const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupName(filenameStem);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const scorePassphrase = (s) => {
    if (typeof s !== 'string' || s.length === 0) return { score: 0, label: 'weak' };
    let score = 0;
    if (s.length >= 8) score++;
    if (s.length >= 12) score++;
    if (s.length >= 16) score++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
    if (/\d/.test(s)) score++;
    if (/[^A-Za-z0-9]/.test(s)) score++;
    if (/(.)\1{2,}/.test(s)) score = Math.max(0, score - 1);
    if (score <= 2) return { score, label: 'weak' };
    if (score <= 4) return { score, label: 'medium' };
    return { score, label: 'strong' };
  };

  const storageErr = (reason, cause) => {
    const detail = cause ? ': ' + String((cause && (cause.message || cause.name)) || cause) : '';
    const err = new Error((reason === 'blocked' ? 'storage blocked' : reason === 'read' ? 'storage read failed' : 'write failed') + detail);
    err.reason = reason;
    return err;
  };
  const damaged = () => new Error('wrong passphrase or corrupted file');
  const newer = (what) => new Error('unknown backup version: ' + what);
  const notBackup = () => new Error('not an envelope');

  const SKIP = {};
  const FIN_LOCAL = ['push_ids', 'push_at'];
  const FIN_DEVICE = ['device_id', 'device_name', 'local'].concat(FIN_LOCAL);
  const FIN_ID = /^[0-9a-f]{16}$/;
  const financeMeta = (store, key, value) => {
    if (store !== 'meta') return value;
    if (FIN_LOCAL.indexOf(key) >= 0) return SKIP;
    if (key === 'wraps' && value && typeof value === 'object' && value.device) {
      const portable = Object.assign({}, value);
      delete portable.device;
      return portable;
    }
    return value;
  };
  const financeAdopt = (store, device, incoming) => {
    if (store !== 'meta') return null;
    const mine = new Map(device.map((e) => [e.key, e.value]));
    const theirs = new Map(incoming.map((r) => [r.k, r.v]));
    const carry = [];
    const keep = (key) => { if (mine.has(key)) carry.push({ key, value: mine.get(key) }); };
    const id = mine.get('device_id');
    if (typeof id !== 'string' || !FIN_ID.test(id)) {
      FIN_LOCAL.forEach(keep);
      return { drop: FIN_LOCAL, carry };
    }
    const same = typeof mine.get('kcv') === 'string' && mine.get('kcv') === theirs.get('kcv');
    FIN_DEVICE.forEach(keep);
    if (same) keep('last_sync_at');
    const own = Number(mine.get('seq')) || 0;
    const backed = theirs.get('device_id') === id ? Number(theirs.get('seq')) || 0 : 0;
    carry.push({ key: 'seq', value: same ? Math.max(own, backed) : backed });
    const drop = FIN_DEVICE.concat(['seq', 'last_sync_at']);
    const wraps = theirs.get('wraps');
    if (wraps && typeof wraps === 'object') {
      const mineWraps = mine.get('wraps') || {};
      const next = Object.assign({}, wraps, { prf: same && Array.isArray(mineWraps.prf) ? mineWraps.prf : [] });
      delete next.device;
      if (same && mineWraps.device) next.device = mineWraps.device;
      carry.push({ key: 'wraps', value: next });
      drop.push('wraps');
    }
    return { drop, carry };
  };
  const DB_RULES = {
    'mentria-packs': { area: 'packs_lib' },
    'mentria-radio': { area: 'radio' },
    'mentria-ext-db': { area: 'extdata' },
    'mentria-ext-story-studio': { area: 'extdata' },
    'mentria-ext-finance': { area: 'finance', whole: true, prep: financeMeta, adopt: financeAdopt }
  };
  const EXT_DB = 'mentria-ext-';
  const hasRule = (name) => Object.prototype.hasOwnProperty.call(DB_RULES, name);
  const backedUp = (name) => typeof name === 'string' && (hasRule(name) || (name.indexOf(EXT_DB) === 0 && name.length > EXT_DB.length));
  const ruleFor = (name) => (hasRule(name) ? DB_RULES[name] : { area: 'extdata' });
  const prepare = (rule, store, key, value) => (rule.prep ? rule.prep(store, key, value) : value);

  const AREA_FALLBACK = {
    local: 'notes, settings and progress', packs_lib: 'imported learning packs', finance: 'Finance ledger',
    radio: 'radio likes and skips', extdata: 'extension data', other: 'other saved data'
  };
  const areaLabel = (area, names) => {
    if (names && typeof names[area] === 'string' && names[area]) return names[area];
    try {
      const I = global.MentriaI18n;
      const v = I && typeof I.t === 'function' ? I.t('common.data_areas.' + area) : null;
      if (typeof v === 'string' && v) return v;
    } catch (_) {}
    return AREA_FALLBACK[area] || AREA_FALLBACK.other;
  };

  const idbFactory = () => {
    try { return global.indexedDB || null; } catch (_) { return null; }
  };
  const req = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const txDone = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e && e.target && e.target.error) || tx.error || new Error('transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });

  const openExisting = (name) => new Promise((resolve, reject) => {
    const idb = idbFactory();
    if (!idb) { resolve(null); return; }
    let r;
    try { r = idb.open(name); } catch (err) { reject(err); return; }
    let fresh = false;
    r.onupgradeneeded = () => { fresh = true; try { r.transaction.abort(); } catch (_) {} };
    r.onsuccess = () => {
      const db = r.result;
      if (fresh) { db.close(); resolve(null); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    r.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (fresh) resolve(null); else reject(r.error);
    };
  });

  const removeDb = (name) => new Promise((resolve) => {
    let r;
    try { r = idbFactory().deleteDatabase(name); } catch (_) { resolve(); return; }
    const timer = setTimeout(resolve, 4000);
    r.onsuccess = r.onerror = () => { clearTimeout(timer); resolve(); };
  });

  const databaseNames = async () => {
    const idb = idbFactory();
    if (!idb) return [];
    if (typeof idb.databases === 'function') {
      try {
        const list = await idb.databases();
        return Array.from(new Set(list.map((d) => d && d.name).filter(backedUp))).sort();
      } catch (_) {}
    }
    const guesses = Object.keys(DB_RULES);
    try {
      const reg = global.MentriaStore ? global.MentriaStore.get('ext', 'registry') : null;
      (Array.isArray(reg) ? reg : []).forEach((e) => {
        const id = e && e.manifest && e.manifest.id;
        if (typeof id === 'string' && id) guesses.push(EXT_DB + id);
      });
    } catch (_) {}
    const out = [];
    for (const name of Array.from(new Set(guesses)).filter(backedUp).sort()) {
      const db = await openExisting(name).catch(() => null);
      if (db) { out.push(name); db.close(); }
    }
    return out;
  };

  const plainPath = (kp) => (kp == null ? null : typeof kp === 'string' ? kp : Array.from(kp, String));
  const describe = (st) => ({
    name: st.name,
    keyPath: plainPath(st.keyPath),
    autoIncrement: !!st.autoIncrement,
    indexes: Array.from(st.indexNames).map((n) => {
      const ix = st.index(n);
      return { name: ix.name, keyPath: plainPath(ix.keyPath), unique: !!ix.unique, multiEntry: !!ix.multiEntry };
    })
  });

  const readStores = async (db, names) => {
    const out = {};
    if (!names.length) return out;
    const tx = db.transaction(names, 'readonly');
    await Promise.all(names.map((n) => {
      const st = tx.objectStore(n);
      const entry = describe(st);
      out[n] = entry;
      return Promise.all([req(st.getAllKeys()), req(st.getAll())]).then((r) => { entry.keys = r[0]; entry.values = r[1]; });
    }));
    return out;
  };

  const VIEWS = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'DataView'];
  const unsupported = () => {
    const err = new Error('value cannot be backed up');
    err.unsupported = true;
    return err;
  };
  const setOwn = (o, k, v) => {
    if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, configurable: true, writable: true });
    else o[k] = v;
  };
  const binary = (bytes, tag, view, bins) => {
    const out = { $t: tag };
    if (view) out.k = view;
    if (bins) {
      bins.push({ blob: new Blob([bytes]), kind: 'a' });
      out.b = bins.length - 1;
    } else {
      out.v = b64uEncode(bytes);
    }
    return out;
  };

  const encodeValue = (v, bins, stack) => {
    if (v === null) return null;
    switch (typeof v) {
      case 'string':
      case 'boolean':
        return v;
      case 'number':
        if (Number.isNaN(v)) return { $t: 'num', v: 'NaN' };
        if (!isFinite(v)) return { $t: 'num', v: v > 0 ? 'Infinity' : '-Infinity' };
        if (v === 0 && 1 / v < 0) return { $t: 'num', v: '-0' };
        return v;
      case 'undefined':
        return { $t: 'undef' };
      case 'bigint':
        return { $t: 'bigint', v: v.toString() };
      case 'object':
        break;
      default:
        throw unsupported();
    }
    if (v instanceof Date) {
      const time = v.getTime();
      return { $t: 'date', v: isNaN(time) ? 'NaN' : time };
    }
    if (v instanceof RegExp) return { $t: 'regexp', s: v.source, f: v.flags };
    if (typeof Blob === 'function' && v instanceof Blob) {
      if (!bins) throw unsupported();
      bins.push({ blob: v, kind: 'b' });
      const out = { $t: 'blob', b: bins.length - 1, type: v.type || '' };
      if (typeof File === 'function' && v instanceof File) {
        out.$t = 'file';
        out.name = v.name;
        out.lm = v.lastModified;
      }
      return out;
    }
    if (v instanceof ArrayBuffer) return binary(new Uint8Array(v), 'ab', null, bins);
    if (ArrayBuffer.isView(v)) {
      const name = v.constructor && v.constructor.name;
      if (VIEWS.indexOf(name) < 0) throw unsupported();
      return binary(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), 'view', name, bins);
    }
    if (stack.indexOf(v) >= 0) throw unsupported();
    stack.push(v);
    try {
      if (Array.isArray(v)) {
        const out = new Array(v.length);
        for (let i = 0; i < v.length; i++) out[i] = encodeValue(v[i], bins, stack);
        return out;
      }
      if (v instanceof Map) return { $t: 'map', v: Array.from(v, (e) => [encodeValue(e[0], bins, stack), encodeValue(e[1], bins, stack)]) };
      if (v instanceof Set) return { $t: 'set', v: Array.from(v, (e) => encodeValue(e, bins, stack)) };
      if (v instanceof Boolean || v instanceof Number || v instanceof String) return encodeValue(v.valueOf(), bins, stack);
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw unsupported();
      const out = {};
      for (const k of Object.keys(v)) setOwn(out, k, encodeValue(v[k], bins, stack));
      return Object.prototype.hasOwnProperty.call(out, '$t') ? { $t: 'obj', v: out } : out;
    } finally {
      stack.pop();
    }
  };

  const binAt = (bins, i, kind) => {
    const b = bins && Number.isInteger(i) ? bins[i] : undefined;
    if (kind === 'b' ? !(b instanceof Blob) : !(b instanceof Uint8Array)) throw damaged();
    return b;
  };
  const bytesOf = (e, bins) => (typeof e.v === 'string' ? b64uDecode(e.v) : binAt(bins, e.b, 'a'));
  const decodeObject = (o, bins) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw damaged();
    const out = {};
    for (const k of Object.keys(o)) setOwn(out, k, decodeValue(o[k], bins));
    return out;
  };
  const decodeValue = (e, bins) => {
    if (e === null || typeof e !== 'object') return e;
    if (Array.isArray(e)) return e.map((x) => decodeValue(x, bins));
    if (typeof e.$t !== 'string') return decodeObject(e, bins);
    switch (e.$t) {
      case 'undef': return undefined;
      case 'num': return Number(e.v);
      case 'bigint': return BigInt(e.v);
      case 'date': return new Date(e.v === 'NaN' ? NaN : e.v);
      case 'regexp': return new RegExp(e.s, e.f);
      case 'blob': {
        const b = binAt(bins, e.b, 'b');
        return b.type === (e.type || '') ? b : new Blob([b], { type: e.type || '' });
      }
      case 'file':
        return new File([binAt(bins, e.b, 'b')], String(e.name || ''), { type: e.type || '', lastModified: e.lm });
      case 'ab':
        return bytesOf(e, bins).buffer;
      case 'view': {
        const View = VIEWS.indexOf(e.k) >= 0 ? global[e.k] : null;
        if (typeof View !== 'function') throw damaged();
        return new View(bytesOf(e, bins).buffer);
      }
      case 'map': return new Map(e.v.map((p) => [decodeValue(p[0], bins), decodeValue(p[1], bins)]));
      case 'set': return new Set(e.v.map((x) => decodeValue(x, bins)));
      case 'obj': return decodeObject(e.v, bins);
      default: throw damaged();
    }
  };

  const keyId = (k) => JSON.stringify(encodeValue(k, null, []));
  const keyFromValue = (v, kp) => {
    if (Array.isArray(kp)) {
      const out = [];
      for (const p of kp) {
        const k = keyFromValue(v, p);
        if (k === undefined) return undefined;
        out.push(k);
      }
      return out;
    }
    if (kp === '') return v;
    let cur = v;
    for (const part of String(kp).split('.')) {
      if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
      cur = cur[part];
    }
    return cur;
  };
  const sameKeyPath = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

  const joinBytes = (parts) => {
    let n = 0;
    parts.forEach((p) => { n += p.byteLength; });
    const out = new Uint8Array(n);
    let o = 0;
    parts.forEach((p) => { out.set(p, o); o += p.byteLength; });
    return out;
  };

  const sameBytes = async (a, b) => {
    for (let o = 0; o < a.size; o += CHUNK_BYTES) {
      const x = new Uint8Array(await a.slice(o, o + CHUNK_BYTES).arrayBuffer());
      const y = new Uint8Array(await b.slice(o, o + CHUNK_BYTES).arrayBuffer());
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    }
    return true;
  };

  const sameValue = async (a, b) => {
    const ba = [];
    const bb = [];
    let ea;
    let eb;
    try {
      ea = JSON.stringify(encodeValue(a, ba, []));
      eb = JSON.stringify(encodeValue(b, bb, []));
    } catch (_) { return false; }
    if (ea !== eb || ba.length !== bb.length) return false;
    for (let i = 0; i < ba.length; i++) {
      if (ba[i].blob.size !== bb[i].blob.size || ba[i].blob.type !== bb[i].blob.type) return false;
    }
    for (let i = 0; i < ba.length; i++) {
      if (!(await sameBytes(ba[i].blob, bb[i].blob))) return false;
    }
    return true;
  };

  const detach = async (v, seen) => {
    if (typeof Blob === 'function' && v instanceof Blob) {
      const copy = new Blob([await v.arrayBuffer()], { type: v.type });
      return (typeof File === 'function' && v instanceof File) ? new File([copy], v.name, { type: v.type, lastModified: v.lastModified }) : copy;
    }
    if (!v || typeof v !== 'object' || seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = await detach(v[i], seen);
    } else if (Object.getPrototypeOf(v) === Object.prototype) {
      for (const k of Object.keys(v)) setOwn(v, k, await detach(v[k], seen));
    }
    return v;
  };

  const snapshot = async () => {
    const S = global.MentriaStore;
    if (!S) throw storageErr('blocked');
    const local = S.exportAll();
    const dbs = [];
    let names;
    try { names = await databaseNames(); } catch (err) { throw storageErr(isBlockedError(err) ? 'blocked' : 'read', err); }
    for (const name of names) {
      let db;
      try { db = await openExisting(name); } catch (err) { throw storageErr(isBlockedError(err) ? 'blocked' : 'read', err); }
      if (!db) continue;
      try {
        const stores = await readStores(db, Array.from(db.objectStoreNames));
        dbs.push({ name, version: db.version, stores: Object.keys(stores).sort().map((n) => stores[n]) });
      } catch (err) {
        throw storageErr('read', err);
      } finally {
        db.close();
      }
    }
    return { local, dbs };
  };

  const frameHead = (type, len) => new Uint8Array([type, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255]);
  const pushJson = (parts, obj) => {
    const body = toUtf8.encode(JSON.stringify(obj));
    parts.push(frameHead(FRAME_JSON, body.length), body);
    return body.length + 5;
  };
  const estimate = (json, bin) => Math.round((json / 3 + bin) * 4 / 3);

  const localSizes = (local) => {
    const S = global.MentriaStore;
    const out = new Map();
    const add = (key, raw) => {
      const area = S && typeof S.areaOf === 'function' ? S.areaOf(key) : 'other';
      out.set(area, (out.get(area) || 0) + toUtf8.encode(JSON.stringify(key) + ':' + JSON.stringify(raw) + ',').length);
    };
    const store = local && local.store && typeof local.store === 'object' ? local.store : {};
    const legacy = local && local.legacy && typeof local.legacy === 'object' ? local.legacy : {};
    Object.keys(store).forEach((k) => add(k, store[k]));
    Object.keys(legacy).forEach((k) => add(k, legacy[k]));
    return out;
  };

  const buildArchive = (snap) => {
    const parts = [];
    const sizes = new Map();
    const tally = (area, json, bin) => {
      const s = sizes.get(area) || { area, json: 0, bin: 0 };
      s.json += json;
      s.bin += bin;
      sizes.set(area, s);
    };
    let rest = pushJson(parts, {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: snap.local.exportedAt,
      local: snap.local,
      dbs: snap.dbs.map((d) => ({
        name: d.name,
        version: d.version,
        stores: d.stores.map((s) => ({ name: s.name, keyPath: s.keyPath, autoIncrement: s.autoIncrement, indexes: s.indexes }))
      }))
    });
    localSizes(snap.local).forEach((bytes, area) => {
      const n = Math.min(bytes, rest);
      if (n > 0) tally(area, n, 0);
      rest -= n;
    });
    let records = 0;
    let skipped = 0;
    snap.dbs.forEach((d, di) => {
      const rule = ruleFor(d.name);
      d.stores.forEach((s, si) => {
        for (let i = 0; i < s.values.length; i++) {
          const value = prepare(rule, s.name, s.keys[i], s.values[i]);
          if (value === SKIP) continue;
          const bins = [];
          const rec = { d: di, s: si };
          try {
            if (s.keyPath == null) rec.k = encodeValue(s.keys[i], null, []);
            rec.v = encodeValue(value, bins, []);
          } catch (err) {
            if (err && err.unsupported) { skipped++; continue; }
            throw err;
          }
          rec.b = bins.map((x) => x.kind);
          const json = pushJson(parts, rec);
          let bin = 0;
          bins.forEach((x) => {
            parts.push(frameHead(FRAME_BIN, x.blob.size), x.blob);
            bin += x.blob.size + 5;
          });
          tally(rule.area, json, bin);
          records++;
        }
      });
    });
    pushJson(parts, { end: true, records });
    if (rest > 0) {
      let top = null;
      sizes.forEach((v) => { if (!top || estimate(v.json, v.bin) > estimate(top.json, top.bin)) top = v; });
      tally(top ? top.area : 'other', rest, 0);
    }
    const areas = Array.from(sizes.values()).map((s) => ({ area: s.area, bytes: estimate(s.json, s.bin) }));
    return {
      archive: new Blob(parts),
      records,
      skipped,
      areas,
      total: areas.reduce((n, a) => n + a.bytes, 0)
    };
  };

  const prepareBackup = async () => buildArchive(await snapshot());

  const chunkIv = (base, i) => {
    const iv = new Uint8Array(base);
    iv[8] ^= (i >>> 24) & 255;
    iv[9] ^= (i >>> 16) & 255;
    iv[10] ^= (i >>> 8) & 255;
    iv[11] ^= i & 255;
    return iv;
  };
  const chunkAad = (i, last) => toUtf8.encode(ARCHIVE_FORMAT + '/' + FILE_VERSION + '/' + i + '/' + (last ? 1 : 0));

  const sealBackup = async (prepared, passphrase, opts) => {
    const onProgress = opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const base = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(passphrase, salt);
    const total = prepared.archive.size || 1;
    let seen = 0;
    let source = prepared.archive.stream();
    if (onProgress) {
      source = source.pipeThrough(new TransformStream({
        transform(chunk, ctl) {
          seen += chunk.byteLength;
          onProgress(Math.min(0.99, seen / total));
          ctl.enqueue(chunk);
        }
      }));
    }
    const reader = (CAN_GZIP ? source.pipeThrough(new CompressionStream('gzip')) : source).getReader();
    const lines = [];
    let index = 0;
    const seal = async (bytes, last) => {
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkIv(base, index), additionalData: chunkAad(index, last) }, key, bytes);
      lines.push(new Blob(['"' + b64uEncode(new Uint8Array(ct)) + '"' + (last ? '' : ',') + '\n']));
      index++;
    };
    let buf = new Uint8Array(CHUNK_BYTES);
    let fill = 0;
    let pending = null;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      const chunk = r.value;
      let off = 0;
      while (off < chunk.length) {
        const take = Math.min(CHUNK_BYTES - fill, chunk.length - off);
        buf.set(chunk.subarray(off, off + take), fill);
        fill += take;
        off += take;
        if (fill === CHUNK_BYTES) {
          if (pending) await seal(pending, false);
          pending = buf;
          buf = new Uint8Array(CHUNK_BYTES);
          fill = 0;
        }
      }
    }
    if (fill || !pending) {
      if (pending) await seal(pending, false);
      await seal(buf.subarray(0, fill), true);
    } else {
      await seal(pending, true);
    }
    const head = JSON.stringify({ v: FILE_VERSION, kdf: 'PBKDF2', iter: ITER, hash: HASH, salt: b64uEncode(salt), iv: b64uEncode(base), z: CAN_GZIP ? 1 : 0, n: index });
    const blob = new Blob([head.slice(0, -1) + CT_OPEN + '\n'].concat(lines, [']}\n']), { type: 'application/json' });
    if (onProgress) onProgress(1);
    return { blob, size: blob.size, records: prepared.records, skipped: prepared.skipped };
  };

  const exportFull = async (passphrase, opts) => sealBackup(await prepareBackup(), passphrase, opts);

  const lineReader = (file, start) => {
    let pos = start;
    let carry = '';
    return async () => {
      for (;;) {
        const nl = carry.indexOf('\n');
        if (nl >= 0) {
          const line = carry.slice(0, nl);
          carry = carry.slice(nl + 1);
          return line;
        }
        if (pos >= file.size) {
          if (!carry) return null;
          const rest = carry;
          carry = '';
          return rest;
        }
        carry += await file.slice(pos, pos + READ_SLICE).text();
        pos += READ_SLICE;
      }
    };
  };

  const streamChunks = (file, start) => {
    const next = lineReader(file, start);
    let ended = false;
    return async () => {
      if (ended) return null;
      const raw = await next();
      if (raw == null) throw damaged();
      const line = raw.trim();
      if (line === ']}') {
        ended = true;
        for (;;) {
          const tail = await next();
          if (tail == null) return null;
          if (tail.trim()) throw damaged();
        }
      }
      const last = line.charAt(line.length - 1) !== ',';
      const body = last ? line : line.slice(0, -1);
      if (body.length < 2 || body.charAt(0) !== '"' || body.charAt(body.length - 1) !== '"') throw damaged();
      return { b64: body.slice(1, -1), last };
    };
  };

  const arrayChunks = (list) => {
    let i = 0;
    return async () => {
      if (i >= list.length) return null;
      const s = list[i++];
      if (typeof s !== 'string') throw damaged();
      return { b64: s, last: i === list.length };
    };
  };

  const archiveReader = () => {
    const head = new Uint8Array(5);
    let headFill = 0;
    let type = 0;
    let remain = 0;
    let pieces = [];
    let manifest = null;
    let current = null;
    let ended = false;
    let records = 0;
    let bytes = 0;
    const dbs = [];
    const bad = (version) => {
      const err = version ? newer(version) : damaged();
      err.archive = true;
      return err;
    };
    const finishRecord = () => {
      const c = current;
      current = null;
      const rec = c.rec;
      dbs[rec.d].stores[rec.s].records.push({
        k: Object.prototype.hasOwnProperty.call(rec, 'k') ? decodeValue(rec.k, null) : undefined,
        v: decodeValue(rec.v, c.bins),
        size: c.size
      });
      bytes += c.size;
      records++;
    };
    const takeManifest = (obj) => {
      if (!obj || obj.format !== ARCHIVE_FORMAT || typeof obj.version !== 'number') throw bad();
      if (obj.version > ARCHIVE_VERSION) throw bad('archive ' + obj.version);
      if (!obj.local || typeof obj.local !== 'object' || !Array.isArray(obj.dbs)) throw bad();
      obj.dbs.forEach((d) => {
        if (!d || typeof d.name !== 'string' || !Number.isInteger(d.version) || d.version < 1 || !Array.isArray(d.stores)) throw bad();
        dbs.push({
          name: d.name,
          version: d.version,
          stores: d.stores.map((s) => {
            if (!s || typeof s.name !== 'string') throw bad();
            return { name: s.name, keyPath: s.keyPath == null ? null : s.keyPath, autoIncrement: !!s.autoIncrement, indexes: Array.isArray(s.indexes) ? s.indexes : [], records: [] };
          })
        });
      });
      manifest = obj;
    };
    const frame = (t, parts, size) => {
      if (ended) throw bad();
      if (t === FRAME_BIN) {
        if (!current || current.bins.length >= current.rec.b.length) throw bad();
        const kind = current.rec.b[current.bins.length];
        current.bins.push(kind === 'a' ? joinBytes(parts) : new Blob(parts));
        current.size += size;
        if (current.bins.length === current.rec.b.length) finishRecord();
        return;
      }
      if (t !== FRAME_JSON) throw bad();
      let obj;
      try { obj = JSON.parse(fromUtf8.decode(joinBytes(parts))); } catch (_) { throw bad(); }
      if (!manifest) { takeManifest(obj); return; }
      if (current) throw bad();
      if (obj && obj.end === true) {
        if (obj.records !== records) throw bad();
        ended = true;
        return;
      }
      if (!obj || !dbs[obj.d] || !dbs[obj.d].stores[obj.s] || !Array.isArray(obj.b) || obj.b.some((x) => x !== 'a' && x !== 'b')) throw bad();
      current = { rec: obj, bins: [], size };
      if (!obj.b.length) finishRecord();
    };
    const push = (chunk) => {
      let off = 0;
      while (off < chunk.length) {
        if (headFill < 5) {
          const take = Math.min(5 - headFill, chunk.length - off);
          head.set(chunk.subarray(off, off + take), headFill);
          headFill += take;
          off += take;
          if (headFill < 5) break;
          type = head[0];
          remain = ((head[1] << 24) | (head[2] << 16) | (head[3] << 8) | head[4]) >>> 0;
          if (type === FRAME_JSON && remain > MAX_JSON_FRAME) throw bad();
          pieces = [];
          if (remain === 0) {
            headFill = 0;
            frame(type, [], 5);
          }
          continue;
        }
        const take = Math.min(remain, chunk.length - off);
        pieces.push(chunk.subarray(off, off + take));
        off += take;
        remain -= take;
        if (remain === 0) {
          const done = pieces;
          let size = 5;
          done.forEach((p) => { size += p.byteLength; });
          pieces = [];
          headFill = 0;
          frame(type, done, size);
        }
      }
    };
    const finish = () => {
      if (!manifest || !ended || current || headFill) throw bad();
      return { format: ARCHIVE_FORMAT, version: manifest.version, exportedAt: manifest.exportedAt, local: manifest.local, dbs, bytes };
    };
    return { push, finish };
  };

  const gunzipInto = (push) => {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    let failure = null;
    const fail = (err) => { if (!failure) failure = err || damaged(); };
    const pump = (async () => {
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) return;
          push(r.value);
        }
      } catch (err) {
        fail(err);
        reader.cancel(err).catch(() => {});
      }
    })();
    const check = () => {
      if (failure) throw (failure.archive ? failure : damaged());
    };
    return {
      write: async (bytes) => {
        check();
        try { await writer.write(bytes); } catch (err) { fail(err); }
        check();
      },
      close: async () => {
        try { await writer.close(); } catch (err) { fail(err); }
        await pump;
        check();
      },
      abort: (err) => {
        writer.abort(err).catch(() => {});
        reader.cancel(err).catch(() => {});
      }
    };
  };

  const readV3 = async (env, nextChunk, passphrase, onProgress) => {
    if (env.kdf !== 'PBKDF2' || env.hash !== HASH) throw notBackup();
    if (typeof env.iter !== 'number' || env.iter < 100000 || env.iter > 10000000) throw notBackup();
    if (!Number.isInteger(env.n) || env.n < 1 || (env.z !== 0 && env.z !== 1)) throw notBackup();
    const salt = b64uDecode(env.salt);
    const base = b64uDecode(env.iv);
    if (salt.byteLength !== SALT_BYTES || base.byteLength !== IV_BYTES) throw notBackup();
    if (env.z && !CAN_GZIP) throw new Error('this browser cannot open compressed backups');
    const key = await deriveFrom(String(passphrase), salt, env.iter, ['decrypt']);
    const archive = archiveReader();
    const sink = env.z ? gunzipInto(archive.push) : {
      write: async (bytes) => archive.push(bytes),
      close: async () => {},
      abort: () => {}
    };
    let i = 0;
    try {
      for (;;) {
        const c = await nextChunk();
        if (!c) break;
        const last = i === env.n - 1;
        if (i >= env.n || c.last !== last) throw damaged();
        let plain;
        try {
          plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkIv(base, i), additionalData: chunkAad(i, last) }, key, b64uDecode(c.b64)));
        } catch (_) {
          throw damaged();
        }
        await sink.write(plain);
        i++;
        if (onProgress) onProgress(i / env.n);
      }
      if (i !== env.n) throw damaged();
      await sink.close();
    } catch (err) {
      sink.abort(err);
      throw err;
    }
    return archive.finish();
  };

  const readBackupFile = async (file, passphrase, opts) => {
    const onProgress = opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;
    if (!file || typeof file.slice !== 'function' || typeof file.size !== 'number') throw notBackup();
    const head = await file.slice(0, Math.min(file.size, 4096)).text();
    const nl = head.indexOf('\n');
    const first = nl >= 0 ? head.slice(0, nl).trim() : '';
    if (first.charAt(0) === '{' && first.slice(-CT_OPEN.length) === CT_OPEN) {
      let env;
      try { env = JSON.parse(first.slice(0, -CT_OPEN.length) + '}'); } catch (_) { throw notBackup(); }
      if (!env || typeof env.v !== 'number') throw notBackup();
      if (env.v > FILE_VERSION) throw newer(env.v);
      if (env.v !== FILE_VERSION) throw notBackup();
      return readV3(env, streamChunks(file, toUtf8.encode(head.slice(0, nl + 1)).length), passphrase, onProgress);
    }
    if (file.size > MEMORY_FILE_BYTES) throw notBackup();
    const env = JSON.parse(await file.text());
    if (env && typeof env.v === 'number' && env.v > FILE_VERSION) throw newer(env.v);
    if (env && env.v === FILE_VERSION) {
      if (!Array.isArray(env.ct)) throw notBackup();
      return readV3(env, arrayChunks(env.ct), passphrase, onProgress);
    }
    return decryptBackup(env, passphrase);
  };

  const planDatabases = async (dbs) => {
    const plans = [];
    for (const d of dbs || []) {
      if (!backedUp(d.name)) continue;
      const rule = ruleFor(d.name);
      let dev = null;
      try { dev = await openExisting(d.name); } catch (err) { throw isBlockedError(err) ? storageErr('blocked', err) : err; }
      try {
        if (dev && dev.version < d.version) throw newer(d.name + ' ' + d.version);
        const devStores = dev ? await readStores(dev, d.stores.map((s) => s.name).filter((n) => dev.objectStoreNames.contains(n))) : {};
        const plan = {
          name: d.name, version: d.version, rule, whole: !!rule.whole, exists: !!dev,
          schemas: d.stores, stores: [], records: 0, adds: 0, replaces: 0, skipped: 0,
          conflict: false, keep: false, keepReplaced: false
        };
        let deviceRecords = 0;
        let extra = false;
        for (const s of d.stores) {
          const ds = devStores[s.name] || null;
          if (dev && (!ds || !sameKeyPath(ds.keyPath, s.keyPath) || ds.autoIncrement !== s.autoIncrement)) {
            plan.skipped += s.records.length;
            continue;
          }
          const recKey = (rec) => (s.keyPath == null ? rec.k : keyFromValue(rec.v, s.keyPath));
          const recs = s.records.filter((rec) => prepare(rule, s.name, recKey(rec), rec.v) !== SKIP);
          const sp = { name: s.name, inline: s.keyPath != null, all: recs, adds: [], replaces: [], device: [] };
          const byKey = new Map();
          if (ds) {
            for (let i = 0; i < ds.keys.length; i++) {
              const entry = { key: ds.keys[i], value: ds.values[i], prepped: prepare(rule, s.name, ds.keys[i], ds.values[i]) };
              sp.device.push(entry);
              if (entry.prepped === SKIP) continue;
              byKey.set(keyId(entry.key), entry);
              deviceRecords++;
            }
          }
          const matched = new Set();
          for (const rec of recs) {
            plan.records++;
            const key = recKey(rec);
            const id = key === undefined ? null : keyId(key);
            const prev = id == null ? undefined : byKey.get(id);
            if (!prev) { sp.adds.push(rec); continue; }
            matched.add(id);
            if (!(await sameValue(prev.prepped, rec.v))) sp.replaces.push({ rec, prev });
          }
          if (byKey.size > matched.size) extra = true;
          plan.adds += sp.adds.length;
          plan.replaces += sp.replaces.length;
          plan.stores.push(sp);
        }
        if (plan.whole) plan.conflict = deviceRecords > 0 && (extra || plan.adds > 0 || plan.replaces > 0);
        plans.push(plan);
      } finally {
        if (dev) dev.close();
      }
    }
    return plans;
  };

  const writePlan = (p) => {
    const jobs = [];
    if (p.whole && p.conflict) {
      if (p.keep) return jobs;
      p.stores.forEach((sp) => {
        const own = p.rule.adopt ? p.rule.adopt(sp.name, sp.device, sp.all) : null;
        const drop = own ? own.drop : [];
        const puts = drop.length ? sp.all.filter((rec) => sp.inline || drop.indexOf(rec.k) < 0) : sp.all;
        jobs.push({ sp, clear: true, puts, carry: own ? own.carry : [], previous: sp.device });
      });
      return jobs;
    }
    p.stores.forEach((sp) => {
      const replacing = p.keepReplaced ? [] : sp.replaces;
      const puts = sp.adds.concat(replacing.map((r) => r.rec));
      if (puts.length) jobs.push({ sp, clear: false, puts, carry: [], previous: replacing.map((r) => r.prev) });
    });
    return jobs;
  };

  const openForWrite = (p) => new Promise((resolve, reject) => {
    const idb = idbFactory();
    if (!idb) { reject(storageErr('blocked')); return; }
    let created = false;
    let r;
    try { r = p.exists ? idb.open(p.name) : idb.open(p.name, p.version); } catch (err) { reject(err); return; }
    r.onupgradeneeded = (e) => {
      created = e.oldVersion === 0;
      const db = r.result;
      p.schemas.forEach((s) => {
        if (db.objectStoreNames.contains(s.name)) return;
        const st = db.createObjectStore(s.name, s.keyPath == null ? { autoIncrement: s.autoIncrement } : { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
        (s.indexes || []).forEach((ix) => {
          if (ix && typeof ix.name === 'string' && ix.keyPath != null) st.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry });
        });
      });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      resolve({ db, created });
    };
    r.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      reject(r.error);
    };
  });

  const writeDatabase = async (p, jobs) => {
    for (const j of jobs) {
      for (const e of j.previous) e.value = await detach(e.value, new Set());
    }
    const opened = await openForWrite(p);
    const db = opened.db;
    const undo = { name: p.name, created: opened.created, stores: [], written: 0 };
    try {
      const tx = db.transaction(jobs.map((j) => j.sp.name), 'readwrite');
      const finished = txDone(tx);
      try {
        jobs.forEach((j) => {
          const st = tx.objectStore(j.sp.name);
          const u = { name: j.sp.name, inline: j.sp.inline, clear: j.clear, previous: j.previous, added: [] };
          undo.stores.push(u);
          if (j.clear) st.clear();
          j.puts.forEach((rec) => {
            const r = j.sp.inline ? st.put(rec.v) : st.put(rec.v, rec.k);
            if (!j.clear) r.onsuccess = () => { u.added.push(r.result); };
            undo.written++;
          });
          j.carry.forEach((e) => { if (j.sp.inline) st.put(e.value); else st.put(e.value, e.key); });
        });
      } catch (err) {
        try { tx.abort(); } catch (_) {}
        finished.catch(() => {});
        throw err;
      }
      await finished;
    } catch (err) {
      db.close();
      if (opened.created) await removeDb(p.name);
      throw err;
    }
    db.close();
    return undo;
  };

  const rollbackDatabases = async (done) => {
    for (const u of done.slice().reverse()) {
      try {
        if (u.created) { await removeDb(u.name); continue; }
        const db = await openExisting(u.name);
        if (!db) continue;
        try {
          const tx = db.transaction(u.stores.map((s) => s.name), 'readwrite');
          const finished = txDone(tx);
          u.stores.forEach((s) => {
            const st = tx.objectStore(s.name);
            if (s.clear) st.clear();
            else s.added.forEach((k) => st.delete(k));
            s.previous.forEach((e) => { if (s.inline) st.put(e.value); else st.put(e.value, e.key); });
          });
          await finished;
        } finally {
          db.close();
        }
      } catch (_) {}
    }
  };

  const dbError = (err) => {
    if (err && err.name === 'QuotaExceededError') return storageErr('full', err);
    if (isBlockedError(err)) return storageErr('blocked', err);
    if (err && /unknown backup version/.test(String(err.message))) return err;
    return new Error('database error: ' + String((err && (err.name || err.message)) || err));
  };

  const commitDatabases = async (plans) => {
    const done = [];
    try {
      for (const p of plans) {
        const jobs = writePlan(p);
        if (jobs.length) done.push(await writeDatabase(p, jobs));
      }
    } catch (err) {
      await rollbackDatabases(done);
      throw dbError(err);
    }
    return done;
  };

  const checkSpace = async (plans) => {
    let need = 0;
    plans.forEach((p) => writePlan(p).forEach((j) => j.puts.forEach((rec) => { need += rec.size || 0; })));
    const st = global.navigator && global.navigator.storage;
    if (!need || !st || typeof st.estimate !== 'function') return;
    let est = null;
    try { est = await st.estimate(); } catch (_) { return; }
    if (est && est.quota > 0 && typeof est.usage === 'number' && need > est.quota - est.usage) throw storageErr('full', 'quota');
  };

  const formatWhen = (iso) => {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '—';
    try {
      return new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    } catch (_) {
      return d.toISOString().slice(0, 10);
    }
  };

  const contentAreas = (S, local, plans, names) => {
    const suffixes = Object.keys(local.store && typeof local.store === 'object' ? local.store : {}).filter((s) => !S.isLocalOnly(s))
      .concat(Object.keys(local.legacy && typeof local.legacy === 'object' ? local.legacy : {}).filter((k) => k.indexOf('mentria_') === 0 && !S.isLocalLegacy(k)));
    const out = suffixes.length ? S.areaNames(suffixes, names) : [];
    plans.forEach((p) => {
      if (!p.records) return;
      const label = areaLabel(p.rule.area, names);
      if (out.indexOf(label) < 0) out.push(label);
    });
    if (!out.length) out.push(areaLabel('other', names));
    return out;
  };

  async function applyRestore(data, copy) {
    const S = global.MentriaStore;
    copy = copy || {};
    const ask = (msg, danger) => (typeof global.mentriaConfirm === 'function' ? global.mentriaConfirm(msg, { danger: danger !== false }) : Promise.resolve(false));
    const full = !!(data && data.format === ARCHIVE_FORMAT);
    const local = full ? data.local : data;
    if (local && local.format === 'mentria-finance') throw new Error('finance backup file');
    if (!local || typeof local !== 'object') throw new Error('invalid payload');
    if (local.version !== 1) throw newer(local.version);
    const plan = S.planImport(local);
    const dbPlans = full ? await planDatabases(data.dbs) : [];
    if (copy.summary) {
      const msg = copy.summary
        .replace('{date}', formatWhen(local.exportedAt || data.exportedAt))
        .replace('{areas}', listJoin(contentAreas(S, local, dbPlans, copy.areas)));
      if (!(await ask(msg, false))) return { restored: 0, cancelled: true };
    }
    const skip = [];
    for (const suffix of plan.vaults) {
      if (!(await ask(suffix === 'totp.vault' ? copy.totpVault : copy.identityVault))) skip.push(suffix);
    }
    for (const p of dbPlans) {
      if (!p.whole || !p.conflict) continue;
      const msg = p.rule.area === 'finance' && copy.finance ? copy.finance : copy.replace.replace('{areas}', areaLabel(p.rule.area, copy.areas));
      if (!(await ask(msg))) p.keep = true;
    }
    const merging = dbPlans.filter((p) => !p.whole && p.replaces > 0);
    const names = S.areaNames(plan.replace, copy.areas);
    merging.forEach((p) => {
      const label = areaLabel(p.rule.area, copy.areas);
      if (names.indexOf(label) < 0) names.push(label);
    });
    if (names.length && !(await ask(copy.replace.replace('{areas}', listJoin(names))))) {
      skip.push.apply(skip, plan.replace);
      merging.forEach((p) => { p.keepReplaced = true; });
    }
    await checkSpace(dbPlans);
    const done = await commitDatabases(dbPlans);
    let result;
    try {
      result = S.importAll(local, { mode: 'merge', skip });
    } catch (err) {
      await rollbackDatabases(done);
      throw err;
    }
    return { restored: result.restored + done.reduce((n, u) => n + u.written, 0) };
  }

  function isBlockedError(err) {
    if (!err) return false;
    if (err.reason === 'blocked' || err.name === 'SecurityError') return true;
    return /storage blocked|SecurityError|access is denied|operation is insecure/i.test(String(err.message || err));
  }

  function restoreErrorCode(err) {
    const m = String(err && err.message || err);
    if (/wrong passphrase/.test(m)) return 'pass';
    if (/unknown backup version/.test(m)) return 'newer';
    if (/finance backup file/.test(m)) return 'finance';
    if (isBlockedError(err)) return 'blocked';
    if (/write failed|quota/i.test(m)) return 'space';
    if (/database error/.test(m)) return 'db';
    if ((err && err.name === 'SyntaxError') || /envelope|unsupported kdf|unsupported hash|missing or oversized|bad salt|bad iv|iteration count|invalid payload|expected base64url/.test(m)) return 'file';
    return null;
  }

  function exportErrorCode(err) {
    if (isBlockedError(err)) return 'blocked';
    if (err && err.reason === 'read') return 'read';
    return null;
  }

  global.MentriaBackup = {
    encryptBackup, decryptBackup, validateEnvelope,
    downloadBackupJson, downloadBlob, scorePassphrase, backupName, listJoin,
    prepareBackup, sealBackup, exportFull, readBackupFile,
    applyRestore, restoreErrorCode, exportErrorCode, financeAdopt,
    ITER, ENVELOPE_VERSION, FILE_VERSION, LARGE_BYTES
  };
})(typeof window !== 'undefined' ? window : globalThis);
