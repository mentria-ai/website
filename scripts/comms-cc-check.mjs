import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const CC = process.env.MENTRIA_CC ? resolve(process.env.MENTRIA_CC) : '';
const hasCC = !!CC && existsSync(join(CC, 'plugins/mentria/lib/pairing.js'));
const tmp = mkdtempSync(join(tmpdir(), 'comms-cc-check-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const hooksPath = join(tmp, 'hooks.mjs');
writeFileSync(hooksPath, [
  "let root = '';",
  'export async function initialize(data) { root = data.root; }',
  'export async function resolve(specifier, context, next) {',
  "  if (specifier.startsWith('/assets/')) return { url: root + specifier, format: 'module', shortCircuit: true };",
  '  return next(specifier, context);',
  '}'
].join('\n'));
register(pathToFileURL(hooksPath).href, import.meta.url, { data: { root: pathToFileURL(join(repo, 'src')).href } });

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { const k = Array.from(this.map.keys())[i]; return k === undefined ? null : k; }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
globalThis.window = globalThis;
const memStore = () => { const m = new Map(); return { get: (ns, k) => (m.has(ns + '.' + k) ? structuredClone(m.get(ns + '.' + k)) : null), set: (ns, k, v) => { m.set(ns + '.' + k, structuredClone(v)); return true; }, remove: (ns, k) => m.delete(ns + '.' + k) }; };
let secret = new Uint8Array(32).fill(5);
window.MentriaIdentity = { isSetUp: () => true, isUnlocked: () => true, getSecret: () => secret };

const eq = (a, b) => assert.equal(a, b);
const deepEq = (a, b) => assert.deepEqual(a, b);
const ok = (v, m) => assert.ok(v, m);
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const CCM = await import('/assets/js/comms/cc.js');
const DV = await import('/assets/js/comms/devices.js');
const DK = await import('/assets/js/comms/devkey.js');
const SITE_WORDS = (await import('/assets/js/comms/cc-words.js')).WORDS;
const P = hasCC ? await import(pathToFileURL(join(CC, 'plugins/mentria/lib/pairing.js')).href) : null;
const PC = hasCC ? await import(pathToFileURL(join(CC, 'plugins/mentria/lib/crypto.js')).href) : null;
const PW = hasCC ? await import(pathToFileURL(join(CC, 'plugins/mentria/lib/wire.js')).href) : null;
const PSG = hasCC ? await import(pathToFileURL(join(CC, 'plugins/mentria/lib/sign.js')).href) : null;
const PLUGIN_WORDS = hasCC ? (await import(pathToFileURL(join(CC, 'plugins/mentria/lib/words.js')).href)).WORDS : null;

const createBus = () => {
  const topics = new Map();
  const get = (t) => { if (!topics.has(t)) topics.set(t, { events: [], subs: new Set() }); return topics.get(t); };
  const publish = async (topic, content) => { const t = get(topic); t.events.push(content); for (const fn of t.subs) setTimeout(() => fn(content), 0); return true; };
  const stream = (topic, onContent, { signal } = {}) => new Promise((done) => {
    const t = get(topic);
    for (const c of t.events) setTimeout(() => { if (!(signal && signal.aborted)) onContent(c); }, 0);
    const fn = (c) => { if (!(signal && signal.aborted)) onContent(c); };
    t.subs.add(fn);
    if (signal) signal.addEventListener('abort', () => { t.subs.delete(fn); done(); }, { once: true });
  });
  const transport = { publish, subscribe: (topic, fn) => { const t = get(topic); t.subs.add(fn); return () => t.subs.delete(fn); } };
  return { publish, stream, transport };
};

const siteDevice = async (name, kind) => {
  window.MentriaStore = memStore();
  secret = crypto.getRandomValues(new Uint8Array(32));
  const me = await DK.ensureDeviceKeys();
  const entry = { sigFp: me.sign.sigFp, spub: me.sign.spub, dh: me.dh.pub, name, kind, added: Date.now() };
  return { me, entry, store: window.MentriaStore, secret };
};
const useDevice = (d) => { window.MentriaStore = d.store; secret = d.secret; };
const computer = () => { const s = PC.p256Keygen(); const d = PC.p256Keygen(); return { name: 'studio', sign: { priv: s.priv, spub: s.pub }, dh: { priv: d.priv, pub: d.pub } }; };
const family = async () => {
  const A = await siteDevice('iPhone', 'iphone');
  const B = await siteDevice('Mac', 'mac');
  useDevice(A);
  const list = await DV.withDevice(await DV.makeGenesis(A.me, A.entry), A.me, B.entry);
  return { A, B, list };
};
const pairOnce = async ({ offerEveryMs = 40, compNow } = {}) => {
  const bus = createBus();
  const { A, B, list } = await family();
  const comp = computer();
  const p = P.startPairing({ computer: comp, publish: bus.publish, stream: bus.stream, site: 'https://mentria.ai', offerEveryMs, now: compNow });
  useDevice(A);
  const S = CCM.parseCcLink('#' + p.link.split('#')[1]);
  const phone = CCM.acceptPairing({ S, me: A.me, entry: A.entry, list, ring: 'ringA', transport: bus.transport });
  return { bus, A, B, list, comp, p, S, phone };
};

const checks = [];
const check = (name, fn, needsPlugin = true) => checks.push([name, fn, needsPlugin]);

check('cc: parseCcLink reads only a well-formed link', () => {
  const S = crypto.getRandomValues(new Uint8Array(32));
  const enc = Buffer.from(S).toString('base64url');
  deepEq(CCM.parseCcLink('#cc1.' + enc), S);
  eq(CCM.parseCcLink('#cc1.' + enc + 'x'), null);
  eq(CCM.parseCcLink('#cc2.' + enc), null);
  eq(CCM.parseCcLink('#room/key'), null);
  eq(CCM.parseCcLink(''), null);
}, false);
check('cc: computer records merge by kver and removal sticks', () => {
  const a = { v: 1, list: [{ cid: 'c1', name: 'a', kver: 1, removed: false }, { cid: 'c2', name: 'b', kver: 3, removed: false }] };
  const b = { v: 1, list: [{ cid: 'c1', name: 'a', kver: 2, removed: false }, { cid: 'c2', name: 'b', kver: 1, removed: true }, { cid: 'c3', name: 'c', kver: 1, removed: false }] };
  const m = CCM.mergeComputerRecords(a, b);
  const by = Object.fromEntries(m.list.map((x) => [x.cid, x]));
  eq(by.c1.kver, 2);
  eq(by.c2.removed, true);
  eq(by.c3.name, 'c');
  deepEq(CCM.mergeComputerRecords(b, a).list.map((x) => x.cid).sort(), ['c1', 'c2', 'c3']);
  eq(CCM.mergeComputerRecords(null, a), a);
}, false);
check('cc: words list identical in both repos', () => { deepEq(Array.from(SITE_WORDS), Array.from(PLUGIN_WORDS)); eq(SITE_WORDS.length, 256); });
check('cc: full pairing over the memory gateway: codes match on both sides', async () => {
  const { A, B, comp, p, S, phone } = await pairOnce();
  let offer = null, accept = null, ready = null;
  phone.onOffer((o) => { offer = o; });
  p.onAccept((a) => { accept = a; });
  phone.onReady((r) => { ready = r; });
  await tick(100);
  ok(offer, 'offer');
  eq(offer.name, 'studio');
  eq(offer.cid, p.cid);
  await phone.approve();
  await tick(100);
  ok(accept, 'accept');
  eq(accept.code, offer.code);
  eq(accept.device.sigFp, A.entry.sigFp);
  eq(offer.code, PW.sasCode(S, comp.sign.spub, A.entry.spub));
  const res = await p.allow();
  await tick(100);
  ok(ready, 'ready');
  const saved = window.MentriaStore.get('comms', 'computers');
  eq(saved.list.length, 1);
  eq(saved.list[0].cid, p.cid);
  deepEq(await CCM.unwrapChannelKey(saved.list[0], A.me), res.K);
  useDevice(B);
  deepEq(await CCM.unwrapChannelKey(saved.list[0], B.me), res.K);
});
check('cc: a second phone that opens the same link after the first gets nothing', async () => {
  const { bus, p, S, phone } = await pairOnce();
  phone.onOffer(() => {});
  await tick(80);
  await phone.approve();
  await tick(60);
  await p.allow();
  await tick(60);
  const X = await siteDevice('Late', 'android');
  const xl = await DV.makeGenesis(X.me, X.entry);
  const late = CCM.acceptPairing({ S, me: X.me, entry: X.entry, list: xl, ring: '', transport: bus.transport });
  let seen = 0;
  late.onOffer(() => { seen++; });
  await tick(250);
  eq(seen, 0);
  late.cancel();
});
check('cc: link older than 10 minutes is refused on both sides', async () => {
  const { p, phone } = await pairOnce({ compNow: () => Date.now() - 600001 });
  let seen = 0;
  phone.onOffer(() => { seen++; });
  await tick(150);
  eq(seen, 0);
  await assert.rejects(phone.approve());
  p.cancel();
});
check('cc: deny on the computer leaves no computer record', async () => {
  const { p, phone } = await pairOnce();
  let denied = false, ready = false;
  phone.onDenied(() => { denied = true; });
  phone.onReady(() => { ready = true; });
  p.onAccept(() => {});
  await tick(80);
  await phone.approve();
  await tick(80);
  await p.deny();
  await tick(80);
  ok(denied);
  no(ready);
  eq(window.MentriaStore.get('comms', 'computers'), null);
});
check('cc: a forged accept (bad signature or list) never reaches onAccept', async () => {
  const { bus, A, p, S } = await pairOnce();
  let n = 0;
  p.onAccept(() => { n++; });
  const X = await siteDevice('Evil', 'device');
  const xl = await DV.makeGenesis(X.me, X.entry);
  useDevice(A);
  const wrongList = CCM.acceptPairing({ S, me: A.me, entry: A.entry, list: xl, ring: '', transport: bus.transport });
  wrongList.onOffer(() => {});
  await tick(80);
  await wrongList.approve();
  await tick(80);
  eq(n, 0);
  p.cancel();
});
check('cc: every device on the list can unwrap K; a device off the list cannot', async () => {
  const { A, B, p, phone } = await pairOnce();
  phone.onOffer(() => {});
  await tick(80);
  await phone.approve();
  await tick(60);
  const res = await p.allow();
  await tick(80);
  useDevice(A);
  const rec = window.MentriaStore.get('comms', 'computers').list[0];
  const C = await siteDevice('Off', 'device');
  eq(await CCM.unwrapChannelKey(rec, C.me), null);
  const stolen = Object.assign({}, rec, { wrapped: { [C.me.sign.sigFp]: rec.wrapped[A.me.sign.sigFp] } });
  eq(await CCM.unwrapChannelKey(stolen, C.me), null);
  useDevice(B);
  deepEq(await CCM.unwrapChannelKey(rec, B.me), res.K);
});
check('cc: two offers on one link stop the pairing', async () => {
  const { bus, p, S, phone } = await pairOnce();
  const fakeOffer = { t: 'cc-offer', v: 1, cid: 'fakecid', name: 'evil', spub: computer().sign.spub, dh: computer().dh.pub, exp: Date.now() + 60000 };
  let offers = 0, conflict = false;
  phone.onOffer(() => { offers++; });
  phone.onConflict(() => { conflict = true; });
  await tick(80);
  await bus.publish(PW.pairKeys(S).topic, PW.seal(PW.pairKeys(S).key, fakeOffer));
  await tick(80);
  ok(conflict);
  await assert.rejects(phone.approve());
  p.cancel();
});

const no = (v) => assert.ok(!v);
let failed = 0, skipped = 0;
for (const [name, fn, needsPlugin] of checks) {
  if (needsPlugin && !hasCC) { skipped++; console.log('SKIP ' + name + ' (set MENTRIA_CC)'); continue; }
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name); console.log('     ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e)); }
}
console.log('comms cc: ' + (checks.length - failed - skipped) + '/' + (checks.length - skipped) + ' passed' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(failed ? 1 : 0);
