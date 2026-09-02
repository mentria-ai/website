const CHANNEL = 'mentria-bus';
const PING_TIMEOUT = 1200;
const INVOKE_TIMEOUT = 8000;

class NoProviderError extends Error { constructor(name) { super('no provider for "' + name + '"'); this.name = 'NoProviderError'; this.capability = name; } }
class BadArgsError extends Error { constructor(name, field) { super('missing required field "' + field + '" for "' + name + '"'); this.name = 'BadArgsError'; } }
class TimeoutError extends Error { constructor(name) { super('timed out invoking "' + name + '"'); this.name = 'TimeoutError'; } }

function toolName(name) { return name.replace(/\./g, '__'); }
function canonical(name) { return name.indexOf('.') === -1 ? name.replace(/__/g, '.') : name; }
function rid() { try { return crypto.randomUUID(); } catch (e) { return 'r' + Date.now() + '-' + (performance.now() | 0); } }

const providers = new Map();
const remote = new Map();
const pending = new Map();
let bc = null;

const lazy = new Map([
  ['extensions.inspect', {
    load: () => import('/assets/js/mentria-extensions.js').then((m) => (p) => m.inspect(p.html)),
    descriptor: { description: 'Validate an extension .html and read its manifest.', parameters: { type: 'object', properties: { html: { type: 'string' } }, required: ['html'] }, ai: false }
  }],
  ['extensions.list', {
    load: () => import('/assets/js/mentria-extensions.js').then((m) => () => m.getRegistry().map((e) => ({ id: e.manifest.id, name: e.manifest.name, version: e.manifest.version, icon: e.manifest.icon, size: e.size, enabled: e.enabled }))),
    descriptor: { description: 'List installed extensions.', parameters: { type: 'object', properties: {} }, ai: false }
  }],
  ['extensions.getSource', {
    load: () => import('/assets/js/mentria-extensions.js').then((m) => (p) => m.getSource(p.id)),
    descriptor: { description: 'Get the stored .html source of an installed extension.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, ai: false }
  }]
]);

function channel() {
  if (bc || typeof BroadcastChannel === 'undefined') return bc;
  bc = new BroadcastChannel(CHANNEL);
  bc.onmessage = (ev) => {
    const d = ev.data || {};
    if (d.t === 'res') { const w = pending.get(d.id); if (w) { pending.delete(d.id); clearTimeout(w.timer); d.ok ? w.resolve(d.value) : w.reject(Object.assign(new Error(d.error && d.error.message || 'remote error'), { name: d.error && d.error.name || 'Error' })); } return; }
    if (d.t === 'pong') { const w = pending.get(d.id); if (w) { pending.delete(d.id); clearTimeout(w.timer); w.resolve(true); } return; }
    if (d.t === 'ping') { if (providers.has(canonical(d.name))) bc.postMessage({ t: 'pong', id: d.id }); return; }
    if (d.t === 'announce') {
      const n = canonical(d.name);
      if (!providers.has(n)) {
        remote.set(n, d.descriptor || null);
        try { window.dispatchEvent(new CustomEvent('mentria:bus:provide', { detail: { name: d.name, remote: true } })); } catch (_) {}
      }
      return;
    }
    if (d.t === 'retract') { remote.delete(canonical(d.name)); return; }
    if (d.t === 'who') {
      for (const [n, e] of providers) {
        if (e.descriptor && (e.descriptor.ai === true || e.descriptor.ai === 'confirm')) bc.postMessage({ t: 'announce', name: n, descriptor: e.descriptor });
      }
      return;
    }
    if (d.t === 'req') {
      const name = canonical(d.name);
      const local = providers.get(name);
      if (!local) return;
      Promise.resolve().then(() => local.handler(d.payload)).then(
        (value) => bc.postMessage({ t: 'res', id: d.id, ok: true, value }),
        (err) => bc.postMessage({ t: 'res', id: d.id, ok: false, error: { name: err.name, message: err.message } })
      );
    }
  };
  return bc;
}

function checkArgs(name, descriptor, payload) {
  const req = descriptor && descriptor.parameters && descriptor.parameters.required;
  if (!req) return;
  const p = payload || {};
  for (const f of req) if (!(f in p)) throw new BadArgsError(name, f);
}

function provide(name, handler, descriptor) {
  providers.set(name, { handler, descriptor: descriptor || null });
  try { window.dispatchEvent(new CustomEvent('mentria:bus:provide', { detail: { name } })); } catch (_) {}
  const ch = channel();
  if (ch && descriptor && (descriptor.ai === true || descriptor.ai === 'confirm')) ch.postMessage({ t: 'announce', name, descriptor });
  return () => { if ((providers.get(name) || {}).handler === handler) providers.delete(name); };
}

function unprovide(name) { providers.delete(name); const ch = channel(); if (ch) ch.postMessage({ t: 'retract', name }); }

function describe(name) {
  const n = canonical(name);
  if (providers.has(n)) return providers.get(n).descriptor;
  if (lazy.has(n)) return lazy.get(n).descriptor;
  if (remote.has(n)) return remote.get(n);
  return null;
}

function listTools(opts) {
  const ai = opts && opts.ai;
  const out = [];
  const add = (n, d) => { if (!d) return; if (ai && !(d.ai === true || d.ai === 'confirm')) return; out.push({ name: toolName(n), description: d.description, parameters: d.parameters || { type: 'object', properties: {} }, readonly: d.readonly === true }); };
  for (const [n, e] of providers) add(n, e.descriptor);
  for (const [n, e] of lazy) if (!providers.has(n)) add(n, e.descriptor);
  for (const [n, d] of remote) if (!providers.has(n) && !lazy.has(n)) add(n, d);
  return out;
}

function has(name) {
  const n = canonical(name);
  if (providers.has(n) || lazy.has(n)) return Promise.resolve(true);
  const ch = channel();
  if (!ch) return Promise.resolve(false);
  const id = rid();
  return new Promise((resolve) => {
    pending.set(id, { resolve, reject: () => resolve(false), timer: setTimeout(() => { pending.delete(id); resolve(false); }, PING_TIMEOUT) });
    ch.postMessage({ t: 'ping', id, name: n });
  });
}

async function invoke(name, payload, opts) {
  const n = canonical(name);
  const local = providers.get(n);
  if (local) { checkArgs(n, local.descriptor, payload); return local.handler(payload); }
  const lz = lazy.get(n);
  if (lz) { checkArgs(n, lz.descriptor, payload); const fn = await lz.load(); return fn(payload); }
  const ch = channel();
  if (!ch || !(await has(n))) throw new NoProviderError(n);
  const id = rid();
  const d = describe(n);
  const timeout = (opts && opts.timeout) || (d && d.timeoutMs) || INVOKE_TIMEOUT;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, timer: setTimeout(() => { pending.delete(id); reject(new TimeoutError(n)); }, timeout) });
    ch.postMessage({ t: 'req', id, name: n, payload });
  });
}

export const MentriaBus = { provide, unprovide, invoke, has, describe, listTools, NoProviderError, BadArgsError, TimeoutError };
export default MentriaBus;
if (typeof window !== 'undefined') {
  window.MentriaBus = MentriaBus;
  const ch = channel();
  if (ch) ch.postMessage({ t: 'who' });
  window.addEventListener('pagehide', () => {
    const c = channel();
    if (!c) return;
    for (const [n, e] of providers) {
      if (e.descriptor && (e.descriptor.ai === true || e.descriptor.ai === 'confirm')) c.postMessage({ t: 'retract', name: n });
    }
  });
}
