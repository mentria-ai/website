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
  window.__trust = list;
  return { A, B, list };
};
const pairOnce = async ({ offerEveryMs = 40, compNow } = {}) => {
  const bus = createBus();
  const { A, B, list } = await family();
  const comp = computer();
  const p = P.startPairing({ computer: comp, publish: bus.publish, stream: bus.stream, site: 'https://mentria.ai', offerEveryMs, now: compNow });
  p.__computer = comp;
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
  const k = { spub: { x: 'sx', y: 'sy' }, dh: { x: 'dx', y: 'dy' } };
  const r = (o) => Object.assign({}, k, o);
  const a = { v: 1, list: [r({ cid: 'c1', name: 'a', kver: 1, removed: false }), r({ cid: 'c2', name: 'b', kver: 3, removed: false })] };
  const b = { v: 1, list: [r({ cid: 'c1', name: 'a', kver: 2, removed: false }), r({ cid: 'c2', name: 'b', kver: 1, removed: true }), r({ cid: 'c3', name: 'c', kver: 1, removed: false })] };
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
  let offer = null, accept = null, ready = null, code = null;
  phone.onOffer((o) => { offer = o; });
  phone.onCode((x) => { code = x.code; });
  p.onAccept((a) => { accept = a; });
  phone.onReady((r) => { ready = r; });
  await tick(100);
  ok(offer, 'offer');
  eq(offer.name, 'studio');
  eq(offer.cid, p.cid);
  eq(offer.code, undefined);
  await phone.approve();
  await tick(100);
  ok(accept, 'accept');
  ok(code, 'code after the reveal');
  eq(accept.code, code);
  eq(accept.device.sigFp, A.entry.sigFp);
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
  const fakeOffer = { t: 'cc-offer', v: 1, cid: 'fakecid', name: 'evil', spub: computer().sign.spub, dh: computer().dh.pub, exp: Date.now() + 60000, commit: 'A'.repeat(43) };
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

const BRM = await import('/assets/js/comms/bridge.js');
const SGM = await import('/assets/js/comms/sign.js');
const memTransport = () => { const fns = new Set(); const sent = []; return { sent, publish: async (c) => { sent.push(c); }, onEvent: (fn) => fns.add(fn), feed: (c) => { for (const fn of fns) fn(c); } }; };
const hostKey = async () => { const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); const j = await crypto.subtle.exportKey('jwk', kp.publicKey); return { key: kp.privateKey, spub: { x: j.x, y: j.y } }; };
const frameOut = async (keys, msg) => Promise.all(BRM.splitFrames(msg).map((f) => BRM.seal(keys.aes, f)));
check('cc: host message with a bad or missing signature is dropped', async () => {
  const keys = await BRM.keysFromBridgeKey(new Uint8Array(32).fill(3));
  const host = await hostKey();
  const other = await hostKey();
  const t = memTransport();
  const client = BRM.createBridgeClient({ transport: t, keys, sign: async (sid, cmid, body) => body, host: { spub: host.spub, room: 'cc:c1' } });
  const seen = [];
  client.on('here', (m) => seen.push(m.sessions[0].name));
  const here = (name) => ({ t: 'here', cmid: 'h:' + name, sessions: [{ sid: 's-' + name, name, busy: false, lastTs: 1 }], host: 'x' });
  for (const c of await frameOut(keys, here('unsigned'))) t.feed(c);
  for (const c of await frameOut(keys, await SGM.signBody(other.key, other.spub, 'cc:c1', 'h:forged', here('forged')))) t.feed(c);
  for (const c of await frameOut(keys, await SGM.signBody(host.key, host.spub, 'cc:c2', 'h:room', here('room')))) t.feed(c);
  for (const c of await frameOut(keys, await SGM.signBody(host.key, host.spub, 'cc:c1', 'h:good', here('good')))) t.feed(c);
  for (const c of await frameOut(keys, await SGM.signBody(host.key, host.spub, 'cc:c1', 'h:old', here('old'), Date.now() - 11 * 60000))) t.feed(c);
  await tick(80);
  deepEq(seen, ['good', 'old']);
  deepEq(client.sessions().map((x) => x.name).sort(), ['good', 'old']);
  eq(client.clockOff(), true);
}, false);
check('cc: hello carries the ring token and the newest list', async () => {
  const keys = await BRM.keysFromBridgeKey(new Uint8Array(32).fill(4));
  const t = memTransport();
  const client = BRM.createBridgeClient({ transport: t, keys, sign: async (sid, cmid, body) => body, hello: () => ({ ring: 'r1', list: { v: 1, ver: 3 } }) });
  await client.hello();
  const r = new BRM.Reassembler();
  let m = null;
  for (const c of t.sent) m = r.push(await BRM.open(keys.aes, c)) || m;
  eq(m.t, 'hello');
  eq(m.ring, 'r1');
  eq(m.list.ver, 3);
}, false);
check('cc: the combined client routes each session to its computer', async () => {
  const mk = () => { const calls = []; const subs = new Map(); let sessions = []; return { calls, set: (s) => { sessions = s; }, emit: (t, m) => { for (const fn of subs.get(t) || []) fn(m); }, client: { on: (t, fn) => { if (!subs.has(t)) subs.set(t, new Set()); subs.get(t).add(fn); return () => subs.get(t).delete(fn); }, hello: async (sid) => calls.push(['hello', sid]), watch: async (sid) => calls.push(['watch', sid]), say: async (sid, text) => { calls.push(['say', sid, text]); return 'c1'; }, verdict: async (sid) => calls.push(['verdict', sid]), answer: async (sid) => calls.push(['answer', sid]), list: async (sid) => calls.push(['list', sid]), open: async (sid) => calls.push(['open', sid]), get: async (sid) => calls.push(['get', sid]), reset: () => {}, channel: (sid) => sid === 'a1', sessions: () => sessions, turn: (sid, n) => ({ n, sid }), turns: (sid) => [sid.length] } }; };
  const A = mk(), B = mk();
  A.set([{ sid: 'a1', name: 'one', online: true }]);
  B.set([{ sid: 'b1', name: 'two', online: true }]);
  const multi = CCM.createMultiClient();
  const heard = [];
  multi.on('here', (m) => heard.push(m.x));
  multi.add('ca', A.client);
  multi.add('cb', B.client);
  A.emit('here', { x: 1 });
  B.emit('here', { x: 2 });
  deepEq(heard, [1, 2]);
  deepEq(multi.sessions().map((s) => [s.sid, s.cid]), [['a1', 'ca'], ['b1', 'cb']]);
  await multi.say('b1', 'hi');
  await multi.watch('a1');
  deepEq(B.calls, [['say', 'b1', 'hi']]);
  deepEq(A.calls, [['watch', 'a1']]);
  eq(multi.channel('a1'), true);
  eq(multi.channel('b1'), false);
  await multi.hello();
  deepEq(A.calls.slice(-1), [['hello', undefined]]);
  deepEq(B.calls.slice(-1), [['hello', undefined]]);
  multi.remove('ca');
  deepEq(multi.sessions().map((s) => s.sid), ['b1']);
  A.emit('here', { x: 3 });
  deepEq(heard, [1, 2]);
  eq(await multi.say('a1', 'gone').catch(() => 'refused'), 'refused');
  const before = B.calls.length;
  await multi.hello('new-sid');
  await multi.open('new-sid', 0);
  deepEq(B.calls.slice(before), [['hello', 'new-sid'], ['open', 'new-sid']]);
}, false);
check('cc: Disconnect sends a signed revoke and hides the computer', async () => {
  const D = await siteDevice('iPhone', 'iphone');
  window.MentriaStore.set('comms', 'computers', { v: 1, list: [{ cid: 'c9', name: 'studio', kver: 1, removed: false }] });
  const keys = await BRM.keysFromBridgeKey(new Uint8Array(32).fill(5));
  const t = memTransport();
  const client = BRM.createBridgeClient({ transport: t, keys, sign: async (sid, cmid, body) => body });
  await CCM.disconnectComputer({ cid: 'c9', client, me: D.me });
  const r = new BRM.Reassembler();
  let m = null;
  for (const c of t.sent) m = r.push(await BRM.open(keys.aes, c)) || m;
  eq(m.t, 'cc-revoke');
  eq(m.cid, 'c9');
  const v = await SGM.verifyBody(m, 'cc:c9', m.cmid);
  eq(v.ok, true);
  eq(v.sigFp, D.me.sign.sigFp);
  eq(window.MentriaStore.get('comms', 'computers').list[0].removed, true);
  deepEq(CCM.liveComputers().map((x) => x.cid), []);
}, false);

check('cc: a here with a gone session removes it', async () => {
  const keys = await BRM.keysFromBridgeKey(new Uint8Array(32).fill(6));
  const host = await hostKey();
  const t = memTransport();
  const client = BRM.createBridgeClient({ transport: t, keys, sign: async (sid, cmid, body) => body, host: { spub: host.spub, room: 'cc:c1' } });
  const send = async (cmid, sessions) => { for (const c of await frameOut(keys, await SGM.signBody(host.key, host.spub, 'cc:c1', cmid, { t: 'here', cmid, sessions, host: 'Mac' }))) t.feed(c); };
  await send('h1', [{ sid: 's1', name: 'one', busy: false, lastTs: 1 }]);
  await send('h2', [{ sid: 's2', name: 'two', busy: true, lastTs: 2 }]);
  await tick(60);
  deepEq(client.sessions().map((x) => x.sid).sort(), ['s1', 's2']);
  await send('h3', [{ sid: 's1', name: 'one', gone: true }]);
  await tick(60);
  deepEq(client.sessions().map((x) => x.sid), ['s2']);
}, false);

check('cc: hello carries the ring token only when alerts are on', async () => {
  const list = { v: 1, ver: 2 };
  deepEq(CCM.helloFields({ ring: 'tok', list }), { ring: 'tok', list });
  deepEq(CCM.helloFields({ ring: null, list }), { list });
  deepEq(CCM.helloFields({ ring: '', list: Object.assign({ needsSign: true }, list) }), {});
}, false);

check('cc: the phone follows a rekey without the owner noticing', async () => {
  const { A, B, p, phone } = await pairOnce();
  phone.onOffer(() => {});
  await tick(80);
  await phone.approve();
  await tick(60);
  await p.allow();
  await tick(80);
  useDevice(A);
  const rec = window.MentriaStore.get('comms', 'computers').list[0];
  eq(await CCM.verifyComputer(rec, A.list || window.__trust, A.me.sign.sigFp), true);
  const comp = p.__computer;
  const K2 = PC.randomBytes(32);
  const hostSigned = (body) => { const cmid = 'h:' + Math.random().toString(36).slice(2); return PSG.signBody(comp.sign.priv, comp.sign.spub, 'cc:' + rec.cid, cmid, Object.assign({}, body, { cmid })); };
  const wrapped = { [A.me.sign.sigFp]: PW.wrapFor(K2, comp.dh.priv, A.entry.dh, rec.cid, A.me.sign.sigFp) };
  eq(await CCM.applyHostKeys(rec.cid, { t: 'cc-rekey', kver: 2, wrapped }), false);
  eq(await CCM.applyHostKeys(rec.cid, hostSigned({ t: 'cc-rekey', kver: 2, wrapped })), true);
  const now = window.MentriaStore.get('comms', 'computers').list[0];
  eq(now.kver, 2);
  deepEq(await CCM.unwrapChannelKey(now, A.me), K2);
  eq(await CCM.verifyComputer(now, window.__trust, A.me.sign.sigFp), true);
  eq(await CCM.applyHostKeys(rec.cid, hostSigned({ t: 'cc-rekey', kver: 1, wrapped: rec.wrapped })), false);
  const wrappedB = { [B.me.sign.sigFp]: PW.wrapFor(K2, comp.dh.priv, B.entry.dh, rec.cid, B.me.sign.sigFp) };
  eq(await CCM.applyHostKeys(rec.cid, hostSigned({ t: 'cc-keys', kver: 2, wrapped: wrappedB })), true);
  const both = window.MentriaStore.get('comms', 'computers').list[0];
  deepEq(Object.keys(both.wrapped).sort(), [A.me.sign.sigFp, B.me.sign.sigFp].sort());
  eq(await CCM.verifyComputer(both, window.__trust, B.me.sign.sigFp), true);
});
check('cc: a computer record needs a trusted approval and computer-signed keys', async () => {
  const { A, p, phone } = await pairOnce();
  phone.onOffer(() => {});
  await tick(80);
  await phone.approve();
  await tick(60);
  await p.allow();
  await tick(80);
  useDevice(A);
  const rec = window.MentriaStore.get('comms', 'computers').list[0];
  const trust = window.__trust;
  eq(await CCM.verifyComputer(rec, trust, A.me.sign.sigFp), true);
  const imp = computer();
  eq(await CCM.verifyComputer(Object.assign({}, rec, { spub: imp.sign.spub }), trust, A.me.sign.sigFp), false);
  const K3 = PC.randomBytes(32);
  const forgedWrap = { [A.me.sign.sigFp]: PW.wrapFor(K3, imp.dh.priv, A.entry.dh, rec.cid, A.me.sign.sigFp) };
  eq(await CCM.verifyComputer(Object.assign({}, rec, { dh: imp.dh.pub, wrapped: forgedWrap }), trust, A.me.sign.sigFp), false);
  eq(await CCM.verifyComputer(Object.assign({}, rec, { approvals: [] }), trust, A.me.sign.sigFp), false);
  const X = await siteDevice('Lost', 'iphone');
  const byLost = await CCM.approveComputer(rec, X.me);
  eq(await CCM.verifyComputer(Object.assign({}, rec, { approvals: [byLost] }), trust, A.me.sign.sigFp), false);
});
check('cc: computer records merge without losing approvals and Disconnect sticks', async () => {
  const { A, p, phone } = await pairOnce();
  phone.onOffer(() => {});
  await tick(80);
  await phone.approve();
  await tick(60);
  await p.allow();
  await tick(80);
  useDevice(A);
  const rec = window.MentriaStore.get('comms', 'computers').list[0];
  const imp = computer();
  const swapped = Object.assign({}, rec, { spub: imp.sign.spub, kver: 9 });
  const m1 = CCM.mergeComputerRecords({ v: 1, list: [rec] }, { v: 1, list: [swapped] });
  deepEq(m1.list[0].spub, rec.spub);
  const gone = Object.assign({}, rec, { removed: true });
  const m2 = CCM.mergeComputerRecords({ v: 1, list: [gone] }, { v: 1, list: [Object.assign({}, rec, { removed: false })] });
  eq(m2.list[0].removed, true);
  const B2 = await siteDevice('Mac', 'mac');
  const extra = await CCM.approveComputer(rec, B2.me);
  const m3 = CCM.mergeComputerRecords({ v: 1, list: [rec] }, { v: 1, list: [Object.assign({}, rec, { approvals: [extra] })] });
  eq(m3.list[0].approvals.length, 2);
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
