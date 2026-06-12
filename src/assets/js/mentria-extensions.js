const NS = 'ext';
const DATA_NS_PREFIX = 'extdata.';
const KNOWN_PERMISSIONS = ['storage', 'ai', 'bluetooth', 'usb', 'serial', 'network', 'notifications', 'share'];
const RESERVED_IDS = ['extensions', 'run', 'tools', 'feed', 'search', 'about', 'comms'];
const WARN_BYTES = 512 * 1024;
const REJECT_BYTES = 1536 * 1024;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const CMD_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function store() {
  if (!window.MentriaStore) throw new Error('MentriaStore unavailable');
  return window.MentriaStore;
}

export function parseManifest(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const el = doc.querySelector('script#mentria-ext[type="application/json"]');
  if (!el) throw new Error('no manifest block found (script#mentria-ext)');
  let m;
  try { m = JSON.parse(el.textContent); } catch (e) { throw new Error('manifest is not valid JSON'); }
  return m;
}

export function validateManifest(m, sizeBytes) {
  const fail = (msg) => { throw new Error(msg); };
  if (!m || typeof m !== 'object' || Array.isArray(m)) fail('manifest must be a JSON object');
  if (typeof m.id !== 'string' || !ID_RE.test(m.id) || m.id.length < 3 || m.id.length > 48) fail('id must be kebab-case, 3-48 chars');
  if (RESERVED_IDS.includes(m.id)) fail('id "' + m.id + '" is reserved');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40) fail('name is required (max 40 chars)');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) fail('version must be major.minor.patch');
  if (m.icon !== undefined) {
    const okEmoji = typeof m.icon === 'string' && m.icon.length <= 8 && !/^data:/.test(m.icon);
    const okData = typeof m.icon === 'string' && /^data:image\//.test(m.icon) && m.icon.length <= 8192;
    if (!okEmoji && !okData) fail('icon must be an emoji or a data:image/ URI up to 8 KB');
  }
  for (const k of ['author', 'description']) {
    if (m[k] !== undefined && (typeof m[k] !== 'string' || m[k].length > 200)) fail(k + ' must be a string up to 200 chars');
  }
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions) || m.permissions.some((p) => typeof p !== 'string' || p.length > 32)) fail('permissions must be an array of short strings');
    if (m.permissions.length > 16) fail('too many permissions');
  }
  if (m.mounts !== undefined) {
    if (typeof m.mounts !== 'object' || Array.isArray(m.mounts)) fail('mounts must be an object');
    if (m.mounts.commands !== undefined) {
      if (!Array.isArray(m.mounts.commands)) fail('mounts.commands must be an array');
      for (const c of m.mounts.commands) {
        if (!c || typeof c.name !== 'string' || !CMD_RE.test(c.name) || c.name.length < 2 || c.name.length > 16) fail('command names must be kebab-case, 2-16 chars');
        if (typeof c.description !== 'string' || !c.description) fail('each command needs a description');
      }
    }
  }
  if (sizeBytes > REJECT_BYTES) fail('file is ' + Math.round(sizeBytes / 1024) + ' KB — extensions are stored in local storage, keep them under 1536 KB');
  return true;
}

export function getRegistry() {
  return store().get(NS, 'registry') || [];
}

export function getEntry(id) {
  return getRegistry().find((e) => e.manifest.id === id) || null;
}

export function getSource(id) {
  return store().get(NS, 'src.' + id);
}

export function inspect(html) {
  const size = new Blob([html]).size;
  const manifest = parseManifest(html);
  validateManifest(manifest, size);
  return { manifest, size, warnLarge: size > WARN_BYTES, existing: getEntry(manifest.id) };
}

export function install(html, manifest) {
  const size = new Blob([html]).size;
  validateManifest(manifest, size);
  const prevSource = store().get(NS, 'src.' + manifest.id);
  const ok = store().set(NS, 'src.' + manifest.id, html);
  if (!ok) throw new Error('storage full — remove an extension or free space');
  const prev = getEntry(manifest.id);
  const registry = getRegistry().filter((e) => e.manifest.id !== manifest.id);
  const entry = {
    manifest,
    enabled: true,
    installedAt: prev ? prev.installedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    size
  };
  registry.push(entry);
  if (!store().set(NS, 'registry', registry)) {
    if (prevSource != null) store().set(NS, 'src.' + manifest.id, prevSource);
    else store().remove(NS, 'src.' + manifest.id);
    throw new Error('storage full — remove an extension or free space');
  }
  return entry;
}

export function setEnabled(id, enabled) {
  const registry = getRegistry();
  const entry = registry.find((e) => e.manifest.id === id);
  if (!entry) return false;
  entry.enabled = !!enabled;
  return store().set(NS, 'registry', registry);
}

export function remove(id) {
  if (!getEntry(id)) return false;
  const srcOk = store().remove(NS, 'src.' + id);
  store().clear(DATA_NS_PREFIX + id);
  const regOk = store().set(NS, 'registry', getRegistry().filter((e) => e.manifest.id !== id));
  return srcOk && regOk;
}

export function compareVersions(a, b) {
  if (!VERSION_RE.test(a) || !VERSION_RE.test(b)) throw new Error('invalid version');
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; }
  return 0;
}

export function dataApiFor(id) {
  const ns = DATA_NS_PREFIX + id;
  return {
    get: (key) => store().get(ns, key),
    set: (key, value) => store().set(ns, key, value),
    remove: (key) => store().remove(ns, key),
    list: () => store().list(ns)
  };
}

export { KNOWN_PERMISSIONS, WARN_BYTES, REJECT_BYTES };
