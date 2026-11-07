import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'comms-check-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const stubs = {
  '/assets/js/mentria-unlock.js': [
    'export const ready = async () => {};',
    'export const enabled = () => !!globalThis.__kr;',
    "export const state = () => { const k = globalThis.__kr; return { enabled: !!k, setUp: !!k, unlocked: !!(k && k.unlocked), linked: k ? (k.linked || ['identity']) : [] }; };",
    "export const secrets = async (name) => { const k = globalThis.__kr; if (!k || !k.unlocked || name !== 'identity') return []; k.calls.secrets++; return (k.secrets || []).map((b, i) => ({ id: 'e' + i, bytes: new Uint8Array(b) })); };"
  ],
  '/assets/js/mentria-unlock-ui.js': [
    'export const showLaunch = async () => { const k = globalThis.__kr; if (!k) return; k.calls.showLaunch++; if (k.onLaunch) k.onLaunch(); };'
  ]
};
const stubUrls = {};
for (const [spec, lines] of Object.entries(stubs)) {
  const file = join(tmp, spec.split('/').pop());
  writeFileSync(file, lines.join('\n'));
  stubUrls[spec] = pathToFileURL(file).href;
}
const hooksPath = join(tmp, 'hooks.mjs');
writeFileSync(hooksPath, [
  "let root = '';",
  'let stubs = {};',
  'export async function initialize(data) { root = data.root; stubs = data.stubs; }',
  'export async function resolve(specifier, context, next) {',
  "  if (stubs[specifier]) return { url: stubs[specifier], format: 'module', shortCircuit: true };",
  "  if (specifier.startsWith('/assets/')) return { url: root + specifier, format: 'module', shortCircuit: true };",
  '  return next(specifier, context);',
  '}'
].join('\n'));
register(pathToFileURL(hooksPath).href, import.meta.url, { data: { root: pathToFileURL(join(repo, 'src')).href, stubs: stubUrls } });

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { const k = Array.from(this.map.keys())[i]; return k === undefined ? null : k; }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}
const ls = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
globalThis.window = globalThis;

const eq = (a, b) => assert.equal(a, b);
const deepEq = (a, b) => assert.deepEqual(a, b);
const ok = (v) => assert.ok(v);
const no = (v) => assert.ok(!v);

const need = async (path) => {
  try { return await import(path); }
  catch (e) { return new Proxy({}, { get(_, k) { if (k === 'then') return undefined; throw e; } }); }
};

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const W = await need('/assets/js/comms/wire.js');
const I = await need('/assets/js/comms/identity.js');
const C = await need('/assets/js/comms/cards.js');
const H = await need('/assets/js/comms/threads.js');
const M = await need('/assets/js/comms/mention.js');
const A = await need('/assets/js/comms/ai-thread.js');
const L = await need('/assets/js/comms/location.js');
vm.runInThisContext(readFileSync(join(repo, 'src/assets/js/comms/media-format.js'), 'utf8'), { filename: 'media-format.js' });
const MF = globalThis.MentriaMediaFormat;
const F = await need('/assets/js/comms/files.js');

const FIX = {
  key: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  topic: '6KIivZnJHh7w2Gas0N2XB9wOaCMAbsbyBJtQgSg2Sbg',
  enc: { v: 1, iv: 'Cq2ez/1WmnLvosqO', ct: 'Y3v63BU027prfBC19//lBA9ZvrEECRBR0a4TegW+2R8=' },
  pack: '{"v":2,"t":"hi","sfp":"A","sfp2":"B"}'
};

const KEYRING_VAULT = 'mentria.store.keyring.vault';
const fakeIdentity = ({ unlocked = false, deviceOpens = false, linked = false, setUp = true } = {}) => {
  delete globalThis.__kr;
  ls.removeItem(KEYRING_VAULT);
  const f = { calls: { tryDeviceUnlock: 0, openLinked: 0 }, secret: new Uint8Array(32).fill(5), open: unlocked };
  window.MentriaIdentity = {
    isSetUp: () => setUp,
    isUnlocked: () => f.open,
    getSecret: () => { if (!f.open) throw new Error('locked'); return f.secret; },
    tryDeviceUnlock: async () => { f.calls.tryDeviceUnlock++; if (deviceOpens) f.open = true; return deviceOpens; },
    openLinked: async (list) => { f.calls.openLinked++; if (linked && list.length) { f.open = true; return 0; } throw new Error('locked'); },
    lock: () => { f.open = false; }
  };
  return f;
};
const fakeKeyring = ({ unlocked = false, secrets = [], linked = ['identity'], onLaunch = null } = {}) => {
  ls.setItem(KEYRING_VAULT, '{"v":1}');
  globalThis.__kr = { unlocked, secrets, linked, onLaunch, calls: { secrets: 0, showLaunch: 0 } };
  return globalThis.__kr;
};

check('wire: topic is unchanged', async () => eq(await W.chatTopicFor('mentria-test-room', FIX.key), FIX.topic));
check('wire: golden ciphertext still opens', async () => eq(await W.decryptText(await W.deriveKey(FIX.key), FIX.enc), 'golden plaintext'));
check('wire: pack keeps both fingerprints', () => { const s = W.packChatPlain('hi', { fp: 'B', legacyFp: 'A' }); eq(s, FIX.pack); deepEq(JSON.parse(s), { v: 2, t: 'hi', sfp: 'A', sfp2: 'B' }); });
check('wire: pack drops a repeated fingerprint', () => deepEq(JSON.parse(W.packChatPlain('hi', { fp: 'A', legacyFp: 'A' })), { v: 2, t: 'hi', sfp: 'A' }));
check('wire: unpack reads what pack wrote', () => eq(W.unpackChatPlain(W.packChatPlain('hi', { fp: 'B', legacyFp: 'A' })).text, 'hi'));
check('wire: invite links are not rooms', () => eq(W.parseHash('#:i1.abc').room, null));
check('wire: a room link survives format and parse', () => eq(W.parseHash(W.formatHash('r1', 'k1')).room, 'r1'));

check('identity: an open identity skips device unlock', async () => { const f = fakeIdentity({ unlocked: true }); ok(await I.openQuietly()); eq(f.calls.tryDeviceUnlock, 0); });
check('identity: device unlock comes before the keyring', async () => { const f = fakeIdentity({ deviceOpens: true }); ok(await I.openQuietly()); eq(f.calls.openLinked, 0); });
check('identity: keyring secrets open a linked identity', async () => { const f = fakeIdentity({ linked: true }); fakeKeyring({ unlocked: true, secrets: [new Uint8Array(32).fill(3)] }); ok(await I.openQuietly()); eq(f.calls.openLinked, 1); });
check('identity: without a keyring only Comms can unlock', async () => { fakeIdentity({}); eq(await I.askToOpen(), 'elsewhere'); });
check('identity: a linked identity asks the one unlock', async () => { fakeIdentity({ linked: true }); const k = fakeKeyring({ secrets: [new Uint8Array(32).fill(3)], onLaunch: () => { k.unlocked = true; } }); eq(await I.askToOpen(), 'open'); eq(k.calls.showLaunch, 1); });
check('identity: closing the unlock leaves the chat unsaved', async () => { const f = fakeIdentity({ linked: true }); const k = fakeKeyring({ secrets: [new Uint8Array(32).fill(3)] }); eq(await I.askToOpen(), 'cancelled'); eq(k.calls.showLaunch, 1); eq(f.calls.openLinked, 0); });
check('identity: a lock in another tab closes this page too', async () => { const f = fakeIdentity({ unlocked: true, linked: true }); fakeKeyring({ unlocked: false }); eq(await I.stillOpen(), false); eq(f.open, false); });
check('identity: an open keyring keeps the page open', async () => { const f = fakeIdentity({ unlocked: true, linked: true }); fakeKeyring({ unlocked: true }); eq(await I.stillOpen(), true); eq(f.open, true); });
check('identity: secretCopy is a copy', () => { const f = fakeIdentity({ unlocked: true }); const s = I.secretCopy(); s[0] = 99; ok(f.secret[0] !== 99); });

check('render: a bare link stops before the comma', () => deepEq(C.findLinks('see https://example.com/a, ok').map((l) => l.href), ['https://example.com/a']));
check('render: www links get https', () => deepEq(C.findLinks('www.example.com').map((l) => l.href), ['https://www.example.com']));
check('render: balanced parentheses stay', () => deepEq(C.findLinks('(https://en.wikipedia.org/wiki/A_(b))').map((l) => l.href), ['https://en.wikipedia.org/wiki/A_(b)']));
check('render: only web and mail links', () => { ok(C.allowedHref('https://x.y')); ok(C.allowedHref('mailto:a@b.c')); no(C.allowedHref(' JavaScript:alert(1)')); no(C.allowedHref('tel:123')); no(C.allowedHref('/relative')); no(C.allowedHref('data:text/html,x')); });
check('render: no lookbehind, so older Safari can parse the modules', () => { const dir = join(repo, 'src/assets/js/comms'); for (const f of readdirSync(dir)) no(/\(\?<[=!]/.test(readFileSync(join(dir, f), 'utf8')), f); });
check('render: an email domain is not linked', () => deepEq(C.findLinks('write to a@www.example.com or b.www.example.org'), []));
check('render: outside images are spotted', () => { ok(C.isOutsideImage('https://t.example/p.gif', 'https://mentria.ai')); no(C.isOutsideImage('data:image/png;base64,AAAA', 'https://mentria.ai')); no(C.isOutsideImage('https://mentria.ai/assets/x.png', 'https://mentria.ai')); });

const SRC = {
  requests: [{ fp: 'fp-req', name: 'Req' }],
  contacts: [{ fp: 'fp-sam', name: 'Sam' }, { fp: 'fp-noor', name: 'Noor' }],
  rooms: [{ room: 'trip', key: 'k1', label: 'Trip' }],
  threads: [
    { id: 'dm-sam', kind: 'dm', title: 'Sam', meta: { fp: 'fp-sam' }, updatedAt: 300, preview: 'see you at 9' },
    { id: 'trip', kind: 'room', title: 'Trip', meta: {}, updatedAt: 200, preview: 'tickets booked' },
    { id: 'ai-1', kind: 'model', title: 'Explain ternary weights', meta: { tool: 'ai-chat' }, updatedAt: 250, preview: 'They store energy in their neck tendons' }
  ],
  unread: { 'fp-sam': { n: 2 } }
};
check('home: requests stay on top', () => eq(H.homeRows(SRC, { filter: 'all', query: '' })[0].kind, 'request'));
check('home: newest activity first', () => deepEq(H.homeRows(SRC, { filter: 'people', query: '' }).filter((r) => r.kind !== 'request').map((r) => r.key), ['fp-sam', 'room:trip', 'fp-noor']));
check('home: the AI filter keeps AI chats only', () => ok(H.homeRows(SRC, { filter: 'ai', query: '' }).every((r) => r.kind === 'ai')));
check('home: search ignores case and reads previews', () => deepEq(H.homeRows(SRC, { filter: 'all', query: 'TENDON' }).map((r) => r.key), ['ai-1']));
check('home: previews show plain text', () => eq(H.homeRows({ contacts: [], requests: [], rooms: [], threads: [{ id: 'ai-2', kind: 'model', title: 'T', meta: {}, updatedAt: 1, preview: '## **Bold** and `code`, a [link](https://x.y) and ![pic](https://x.y/p.png)\n- next' }], unread: {} }, { filter: 'all', query: '' })[0].preview, 'Bold and code, a link and pic next'));
check('home: Annotate chats open in Annotate Image', () => eq(H.aiHref({ id: 'an-1', meta: { tool: 'annotate-image' } }, '/es'), '/es/tools/annotate-image/?thread=an-1'));

check('mention: an @ at a word start opens the picker', () => eq(M.mentionQuery('hi @sa', 6), 'sa'));
check('mention: an @ inside a word does not', () => eq(M.mentionQuery('mail a@b.c', 10), null));
check('mention: prefix matches come first', () => deepEq(M.matchTargets('sa', [{ kind: 'contact', id: '1', label: 'Isabel' }, { kind: 'contact', id: '2', label: 'Sam' }]).map((t) => t.label), ['Sam', 'Isabel']));
check('mention: the chosen name leaves the message', () => eq(M.splitTarget('@Sam see you at 9', { kind: 'contact', id: '2', label: 'Sam' }).body, 'see you at 9'));

const TURNS = [
  { role: 'user', text: 'What is in this photo?', img: true, thumb: 'ab12cd' },
  { role: 'assistant', text: 'A seahorse in a kelp bed.', model: 'b2-2b', repeatCut: false },
  { role: 'assistant', text: 'A seahorse. A seahorse.', model: 'b2-2b', repeatCut: true }
];
check('ai thread: turns survive the round trip', () => deepEq(A.messagesToTurns(TURNS.map((t, i) => A.turnToMessage(t, 'ai-x', i, 1000 + i))), TURNS));
check('ai thread: titles are cut at 60 characters', () => eq(A.titleFrom('a'.repeat(80), 'Photo chat').length, 60));
check('ai thread: photo-only chats get the fallback title', () => eq(A.titleFrom('', 'Photo chat'), 'Photo chat'));
check('ai thread: a message keeps its position in its id', () => { eq(A.messageIndex({ id: 'ai-x:12' }), 12); eq(A.messageIndex({ id: 'ai-x' }), null); eq(A.messageIndex({ id: 'ai-x:-1' }), null); eq(A.messageIndex({ id: 'ai-x:1.5' }), null); });
check('ai thread: legacy ids are stable', async () => { eq(await A.legacyThreadId('[1]'), await A.legacyThreadId('[1]')); ok((await A.legacyThreadId('[1]')).startsWith('ai-legacy-')); });

check('annotate: one result is a photo and an answer', () => { const [u, m] = A.annotateToMessages({ mode: 'describe', modeLabel: 'Describe', text: 'A seahorse', thumb: 'h1' }, 'an-1', 0, 5); eq(u.from, 'self'); eq(u.parts[0].thumb, 'h1'); eq(m.t, 'A seahorse'); eq(m.id, 'an-1:1'); });

const te8 = (t) => new TextEncoder().encode(t);
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n) => [(n >> 8) & 255, n & 255];
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const tag = (type) => Uint8Array.from(type, (c) => c.charCodeAt(0));
const box = (type, ...payload) => { const body = cat(...payload.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)))); return cat(Uint8Array.from(be32(body.length + 8)), tag(type), body); };
const fullBox = (type, version, ...payload) => box(type, [version, 0, 0, 0], ...payload);
const ftyp = (brand) => box('ftyp', tag(brand), [0, 0, 0, 0], tag(brand));
const mdat = () => box('mdat', new Uint8Array(64).fill(7));
const mov = ({ xyz } = {}) => cat(ftyp('qt  '), box('moov', box('mvhd', new Uint8Array(20)), box('udta', ...(xyz ? [box('©xyz', be16(te8(xyz).length), be16(0x15c7), te8(xyz))] : []), box('free', [0, 0]))), mdat());
const mp4Keys = (pairs) => { const names = Object.keys(pairs); const keys = fullBox('keys', 0, be32(names.length), ...names.map((n) => cat(Uint8Array.from(be32(te8(n).length + 8)), tag('mdta'), te8(n)))); const ilst = box('ilst', ...names.map((n, i) => cat(Uint8Array.from(be32(8 + 16 + te8(pairs[n]).length)), Uint8Array.from(be32(i + 1)), box('data', be32(1), be32(0), te8(pairs[n]))))); return cat(ftyp('qt  '), box('moov', box('mvhd', new Uint8Array(20)), box('meta', box('hdlr', new Uint8Array(24)), keys, ilst)), mdat()); };
const heif = ({ exif }) => { const ex = te8('Exif\0\0' + exif); const infe = fullBox('infe', 2, be16(1), be16(0), tag('Exif'), te8('\0')); const iinf = fullBox('iinf', 0, be16(1), infe); const ilocLen = 8 + 4 + 2 + 2 + (2 + 2 + 4 + 2 + 4 + 4); const head = cat(ftyp('heic')); const metaBody = (off) => cat(box('hdlr', new Uint8Array(24)), iinf, fullBox('iloc', 0, [0x44, 0x40], be16(1), be16(1), be16(0), be32(0), be16(1), be32(off), be32(ex.length))); const metaLen = 12 + metaBody(0).length; const off = head.length + metaLen + 8; return cat(head, fullBox('meta', 0, metaBody(off)), box('mdat', ex)); };
const brokenMov = () => { const f = mov({ xyz: '+1+1/' }); const g = f.slice(); g.set(be32(9999), ftyp('qt  ').length); return g; };
const reader = (bytes) => async (start, length) => bytes.subarray(start, Math.min(bytes.length, start + length));
const text = (f, r) => String.fromCharCode(...f.subarray(r.start, r.end));
const boxes = (b) => { const out = []; for (let i = 0; i + 8 <= b.length;) { const n = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; out.push(String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]) + ':' + n); if (n < 8) break; i += n; } return out; };

check('location: MOV ©xyz payload is found', async () => { const f = mov({ xyz: '+51.5074-000.1278/' }); const r = await L.locationRanges(reader(f), f.length, 'mp4'); eq(r.ok, true); eq(text(f, r.ranges[0]), '+51.5074-000.1278/'); });
check('location: MP4 keys/ilst location value is found', async () => { const f = mp4Keys({ 'com.apple.quicktime.location.ISO6709': '+48.8584+002.2945/' }); const r = await L.locationRanges(reader(f), f.length, 'mp4'); ok(r.ranges.some((x) => text(f, x).includes('+48.8584'))); });
check('location: HEIF Exif item is found through iloc', async () => { const f = heif({ exif: 'GPS-SECRET' }); const r = await L.locationRanges(reader(f), f.length, 'heif'); ok(r.ranges.some((x) => text(f, x).includes('GPS-SECRET'))); });
check('location: blanking keeps the size and box layout', async () => { const f = mov({ xyz: '+51.5074-000.1278/' }); const r = await L.locationRanges(reader(f), f.length, 'mp4'); const g = L.blank(f.slice(), 0, r.ranges); eq(g.length, f.length); ok(!Buffer.from(g).includes('+51.5074')); deepEq(boxes(g), boxes(f)); });
check('location: blanking across a piece edge', () => { const b = new Uint8Array(10).fill(1); L.blank(b, 100, [{ start: 95, end: 103 }]); deepEq([...b.slice(0, 4)], [0, 0, 0, 1]); });
check('location: a box that runs past the end is not ok', async () => { const f = brokenMov(); eq((await L.locationRanges(reader(f), f.length, 'mp4')).ok, false); });
check('location: a file with no location has no ranges', async () => { const f = mov({}); deepEq((await L.locationRanges(reader(f), f.length, 'mp4')).ranges, []); });

const b64u = (bytes) => Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const ref16 = (i) => b64u(new Uint8Array(16).fill(i));
const R16 = ref16(1);
const R32 = b64u(new Uint8Array(32).fill(2));
const img = (over = {}) => ({ type: 'image', ref: R16, mh: R32, size: 1000, mime: 'image/jpeg', w: 320, h: 240, thumb: 'QUJD', ...over });
const album = (n, thumbLen) => ({ type: 'album', aid: 'a1', n, items: Array.from({ length: n }, (_, i) => img({ ref: ref16(i + 10), thumb: 'A'.repeat(thumbLen) })) });

check('wire: no parts means identical bytes', () => eq(W.packChatPlain('hi', { fp: 'a', legacyFp: 'a' }), '{"v":2,"t":"hi","sfp":"a"}'));
check('wire: parts round-trip', () => { const p = [{ type: 'file', ref: R16, mh: R32, size: 10, mime: 'application/pdf', name: 'a.pdf' }]; deepEq(W.unpackChatPlain(W.packChatPlain('x', {}, { p })).parts, p); });
check('wire: old payloads have no parts', () => eq(W.unpackChatPlain('{"v":2,"t":"hi"}').parts, null));
check('wire: unknown part types become unknown', () => deepEq(W.cleanParts([{ type: 'hologram', x: 1 }]), [{ type: 'unknown' }]));
check('wire: bad fields are dropped', () => eq(W.cleanParts([{ type: 'file', ref: 'not-b64!', mh: R32, size: -1 }]), null));
check('wire: an oversized thumb is dropped', () => eq(W.cleanParts([img({ thumb: 'A'.repeat(16385) })])[0].thumb, undefined));
check('wire: a big album splits under the budget', async () => { const parts = [{ type: 'text', text: 'trip' }, album(12, 15000)]; const msgs = await W.splitOffer(parts, async (ps) => JSON.stringify(ps).length * 1.4); ok(msgs.length > 1); ok(msgs.every((m) => JSON.stringify(m).length * 1.4 <= 60000)); eq(msgs.flatMap((m) => m.find((x) => x.type === 'album').items).length, 12); eq(msgs[0][0].type, 'text'); });
check('wire: offer text for old pages', () => eq(W.offerText([album(3, 10)], { files: { offer_photos: 'Sent {n} photos. Update Mentria to see them.' } }), 'Sent 3 photos. Update Mentria to see them.'));

const sha = (n) => MF.sha256(new Uint8Array([n]));
check('files: bitfield round-trip', () => { const b = F.bfNew(13); F.bfSet(b, 0); F.bfSet(b, 12); eq(F.bfCount(F.bfFrom(F.bfB64(b), 13)), 2); });
check('files: next pieces skip held and in flight', () => { const b = F.bfNew(20); [0, 1, 3].forEach((i) => F.bfSet(b, i)); deepEq(F.nextPieces(b, 20, new Set([2, 4]), 3), [5, 6, 7]); });
check('files: a forged manifest fails', async () => { const h = [await sha(1), await sha(2)]; const mh = await MF.manifestHash(h); eq(await F.checkManifest({ size: 300000, pieceSize: 262144, hashes: [h[0], await sha(9)] }, mh), false); eq(await F.checkManifest({ size: 300000, pieceSize: 262144, hashes: h }, mh), true); });
check('files: a wrong piece size fails', async () => { const h = [await sha(1)]; eq(await F.checkManifest({ size: 1, pieceSize: 1024, hashes: h }, await MF.manifestHash(h)), false); });
check('files: messages are checked', () => { eq(F.cleanFilesMsg('fwq', { id: R16, i: Array(65).fill(0) }), null); eq(F.cleanFilesMsg('fwq', { id: 'x', i: [1] }), null); deepEq(F.cleanFilesMsg('fwq', { id: R16, i: [1, 2] }), { id: R16, i: [1, 2] }); });

const KEY = FIX.key;
const KEY2 = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
const stubT = () => ({ attached: [], attach(id) { this.attached.push(id); }, detach() {} });
const stubRoom = () => ({ left: false, leave() { this.left = true; } });
const threadsN = (n) => Array.from({ length: n }, (_, i) => ({ id: 't' + i, roomName: 'r' + i, b64Key: KEY, priority: i }));
check('files: files room is stable and differs from the chat room', async () => { const a = await F.filesRoomFor('dm-abc', KEY); const b = await F.filesRoomFor('dm-abc', KEY); deepEq(a, b); ok(/^mf-[a-z2-7]{16}$/.test(a.roomId)); ok(a.roomId !== 'dm-abc'); });
check('files: different keys give different rooms', async () => ok((await F.filesRoomFor('r', KEY)).roomId !== (await F.filesRoomFor('r', KEY2)).roomId));
check('files: at most six rooms, newest first', async () => { const joined = []; const fr = new F.FilesRooms({ transfers: stubT(), join: (id) => { joined.push(id); return stubRoom(); }, max: 6 }); await fr.sync(threadsN(9)); eq(joined.length, 6); deepEq(fr.joined().sort(), ['t3', 't4', 't5', 't6', 't7', 't8']); });

check('files: a room is not rejoined until its leave has finished', async () => {
  const leaving = new Set();
  const events = [];
  const join = (id) => { if (leaving.has(id)) throw new Error('still leaving ' + id); events.push('join ' + id); return { leave: () => { leaving.add(id); events.push('leave ' + id); return new Promise((r) => setTimeout(() => { leaving.delete(id); r(); }, 40)); } }; };
  const fr = new F.FilesRooms({ transfers: stubT(), join, max: 6 });
  const t = threadsN(1);
  await fr.sync(t);
  await fr.sync([]);
  await fr.sync(t);
  deepEq(fr.joined(), ['t0']);
  eq(events.filter((e) => e.startsWith('join')).length, 2);
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name);
    console.log('     ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e));
  }
}
console.log('comms: ' + (checks.length - failed) + '/' + checks.length + ' passed');
process.exit(failed ? 1 : 0);
