const CONNECT = 'mentria-engine-connect';
const PROXIED = ['generate', 'stream', 'encodeChat', 'encode', 'decode', 'swapAdapter', 'unloadAdapter', 'getStats', 'interrupt', 'prefillOnly', 'isDeviceLost'];

function stripSignal(args) {
  const out = args.slice();
  if (out[0] && typeof out[0] === 'object' && out[0].signal) {
    const { signal, ...rest } = out[0];
    out[0] = rest;
    return { args: out, signal };
  }
  return { args: out, signal: null };
}

export class RemoteEngine {
  constructor(port, info) {
    this.port = port;
    this.tier = info.tier;
    this.maxSeq = info.maxSeq;
    this.remote = true;
    this.onProgress = null;
    this.onDeviceLost = null;
    this.prefixCache = null;
    this.pending = new Map();
    this.nextId = 1;
    port.onmessage = (e) => this.handle(e.data);
    port.start && port.start();
  }
  handle(m) {
    if (!m) return;
    if (m.progress) { if (this.onProgress) this.onProgress(m.progress); return; }
    if (m.deviceLost) { if (this.onDeviceLost) this.onDeviceLost(m.deviceLost); return; }
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.event) { if (p.onEvent) { try { p.onEvent(m.event); } catch (_) {} } return; }
    this.pending.delete(m.id);
    if (m.error) { const err = new Error(m.error.message || 'remote engine error'); err.name = m.error.name || 'Error'; p.reject(err); }
    else p.resolve(m.result);
  }
  call(method, args, onEvent) {
    const id = this.nextId++;
    const { args: clean, signal } = stripSignal(args);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onEvent });
      if (signal) {
        if (signal.aborted) { this.port.postMessage({ abort: id }); }
        else signal.addEventListener('abort', () => this.port.postMessage({ abort: id }), { once: true });
      }
      try { this.port.postMessage({ id, method, args: clean }); }
      catch (err) { this.pending.delete(id); reject(err); }
    });
  }
  generate(params, cb) { return this.call('generate', [params], cb); }
  stream(params, cb) { return this.call('stream', [params], cb); }
  encodeChat(...a) { return this.call('encodeChat', a); }
  encode(...a) { return this.call('encode', a); }
  decode(...a) { return this.call('decode', a); }
  swapAdapter(...a) { return this.call('swapAdapter', a); }
  unloadAdapter(...a) { return this.call('unloadAdapter', a); }
  getStats(...a) { return this.call('getStats', a); }
  interrupt(...a) { return this.call('interrupt', a); }
  prefillOnly(...a) { return this.call('prefillOnly', a); }
  isDeviceLost() { return this.call('isDeviceLost', []); }
  createPrefixCache() { return Promise.resolve(null); }
  terminate() {}
  unload() { return Promise.resolve(); }
}

export function connectRemoteEngine({ timeoutMs = 1500, onProgress = null } = {}) {
  if (typeof window === 'undefined' || window.parent === window) return Promise.resolve(null);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => { if (!settled) { ch.port1.onmessage = null; finish(null); } }, timeoutMs);
    ch.port1.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'none') { clearTimeout(timer); finish(null); return; }
      if (m.type === 'loading') { clearTimeout(timer); if (m.progress && onProgress) onProgress(m.progress); return; }
      if (m.type === 'ready') { clearTimeout(timer); finish(new RemoteEngine(ch.port1, m)); }
    };
    ch.port1.start && ch.port1.start();
    try { window.parent.postMessage({ type: CONNECT }, location.origin, [ch.port2]); }
    catch (_) { clearTimeout(timer); finish(null); }
  });
}

export function serveEngine(getEngine) {
  const ports = new Set();
  let ready = null;
  const broadcast = (m) => { for (const p of ports) { try { p.postMessage(m); } catch (_) {} } };
  const attach = (port) => {
    ports.add(port);
    const aborts = new Map();
    port.onmessage = async (e) => {
      const m = e.data || {};
      if (m.abort) { const c = aborts.get(m.abort); if (c) c.abort(); return; }
      if (!m.id || !PROXIED.includes(m.method)) { if (m.id) port.postMessage({ id: m.id, error: { message: 'method not allowed: ' + m.method } }); return; }
      const engine = ready && ready.engine;
      if (!engine) { port.postMessage({ id: m.id, error: { message: 'engine not ready' } }); return; }
      const args = m.args || [];
      const cb = (ev) => { try { port.postMessage({ id: m.id, event: ev }); } catch (_) {} };
      try {
        let result;
        if (m.method === 'generate' || m.method === 'stream') {
          const ctrl = new AbortController();
          aborts.set(m.id, ctrl);
          const params = Object.assign({}, args[0] || {}, { signal: ctrl.signal });
          try { result = await engine[m.method](params, cb); } finally { aborts.delete(m.id); }
        } else {
          result = await engine[m.method](...args);
        }
        port.postMessage({ id: m.id, result: result === undefined ? null : result });
      } catch (err) {
        port.postMessage({ id: m.id, error: { name: err && err.name, message: String(err && err.message || err) } });
      }
    };
    port.start && port.start();
  };
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== CONNECT || !e.ports || !e.ports[0]) return;
    const port = e.ports[0];
    attach(port);
    if (ready) port.postMessage({ type: 'ready', tier: ready.tier, maxSeq: ready.maxSeq });
    else port.postMessage({ type: 'loading' });
  });
  return {
    setReady(res) {
      ready = res;
      if (res.engine) {
        const prev = res.engine.onProgress;
        res.engine.onProgress = (p) => { broadcast({ progress: p }); if (prev) prev(p); };
        const prevLost = res.engine.onDeviceLost;
        res.engine.onDeviceLost = (info) => { broadcast({ deviceLost: info }); if (prevLost) prevLost(info); };
      }
      broadcast({ type: 'ready', tier: res.tier, maxSeq: res.maxSeq });
    },
    progress(p) { broadcast({ type: 'loading', progress: p }); },
    get clients() { return ports.size; }
  };
}
