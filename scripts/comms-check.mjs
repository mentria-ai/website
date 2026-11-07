import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { hkdfSync, createHmac } from 'node:crypto';

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
const SH = await need('/assets/js/comms/sheet.js');
const SF = await need('/assets/js/comms/self.js');
const RM = await need('/assets/js/comms/rooms.js');
const SG = await need('/assets/js/comms/sign.js');
const IV = await need('/assets/js/comms/invite.js');
const MB = await need('/assets/js/comms/members.js');
const CIDM = await need('/assets/js/mentria-comms-id.js');
const VEC = JSON.parse(readFileSync(join(repo, 'scripts/fixtures/sig-vector.json'), 'utf8'));

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

const TT = { sheet: { est_down: '{n} photos · {size}, downscaled', est_orig: '{size}, originals', est_mixed: '{n} items · {size}, photos downscaled' } };
check('sheet: estimate downscaled', () => eq(SH.estimate([{ size: 4e6, kind: 'photo', variant: 'standard', std: 6e5 }, { size: 5e6, kind: 'photo', variant: 'standard', std: 7e5 }], TT), '2 photos · 1.3 MB, downscaled'));
check('sheet: estimate originals', () => eq(SH.estimate([{ size: 24.6e6, kind: 'video', variant: 'original' }], TT), '24.6 MB, originals'));

check('accept: rules table', () => { const t = [[{ self: true, contact: false, kind: 'file', size: 2e9 }, 'auto'], [{ self: false, contact: true, kind: 'photo', size: 24e6 }, 'auto'], [{ self: false, contact: true, kind: 'video', size: 26e6 }, 'ask'], [{ self: false, contact: true, kind: 'file', size: 1e5 }, 'ask'], [{ self: false, contact: false, kind: 'photo', size: 1e5 }, 'ask']]; for (const [a, want] of t) assert.equal(F.acceptFor(a), want, JSON.stringify(a)); });
check('accept: relay ask only for people over 100 MB', () => { eq(F.relayAsk({ self: false, viaRelay: true, size: 101e6 }), true); eq(F.relayAsk({ self: true, viaRelay: true, size: 5e9 }), false); eq(F.relayAsk({ self: false, viaRelay: false, size: 5e9 }), false); });
check('accept: 25 MB is the line', () => eq(F.acceptFor({ self: false, contact: true, kind: 'photo', size: 25 * 1024 * 1024 }), 'ask'));
check('accept: a relayed pair is seen in stats', async () => { const pc = { getStats: async () => new Map([['p', { type: 'candidate-pair', state: 'succeeded', nominated: true, selected: true, localCandidateId: 'l', remoteCandidateId: 'r' }], ['l', { type: 'local-candidate', candidateType: 'relay' }], ['r', { type: 'remote-candidate', candidateType: 'host' }]]) }; eq(await F.viaRelay(pc), true); const direct = { getStats: async () => new Map([['p', { type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l', remoteCandidateId: 'r' }], ['l', { type: 'local-candidate', candidateType: 'srflx' }], ['r', { type: 'remote-candidate', candidateType: 'host' }]]) }; eq(await F.viaRelay(direct), false); });

check('files: adding a missing record is ignored', async () => { const t = new F.Transfers({ store: { listMedia: async () => [] }, media: {} }); try { eq(await t.add(null), null); eq(await t.add({}), null); } finally { t.stop(); } });

const SEC = new Uint8Array(32).fill(4);
const syncKeyB64 = async (secret, now) => { const bucket = String(Math.floor(now / 604800000)); const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']); const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('mentria-identity-key-v1'), info: new TextEncoder().encode('aes-gcm-256|w' + bucket) }, base, 256)); return W.b64urlEncode(bits); };
check('self: same secret, same week, same room', async () => { const a = await SF.selfRoomFor(SEC, 1.7e12); const b = await SF.selfRoomFor(SEC, 1.7e12 + 1000); deepEq(a, b); ok(/^self-[a-z2-7]{16}$/.test(a.roomName)); eq(a.threadId, 'self'); });
check('self: the room changes with the week', async () => ok((await SF.selfRoomFor(SEC, 1.7e12)).roomName !== (await SF.selfRoomFor(SEC, 1.7e12 + 604800000)).roomName));
check('self: differs from the identity sync room', async () => ok((await SF.selfRoomFor(SEC, 1.7e12)).b64Key !== await syncKeyB64(SEC, 1.7e12)));
check('self: device kinds from the user agent', () => { eq(SF.kindFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)', 5), 'iphone'); eq(SF.kindFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'mac'); eq(SF.kindFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'ipad'); eq(SF.kindFrom('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 5), 'android'); });

check('files: hello offers are checked', () => { const d = F.cleanFilesMsg('fhi', { caps: { files: 2 }, have: [], want: [], offers: [{ id: R16, mh: R32, size: 5, mime: 'text/plain', name: 'a.txt', kind: 'file' }, { id: 'bad', mh: R32, size: 5 }, { id: R16, mh: 'short', size: 5 }] }); eq(d.offers.length, 1); deepEq(d.offers[0], { id: R16, mh: R32, size: 5, mime: 'text/plain', name: 'a.txt', kind: 'file' }); });

check('sync: newer wins', () => { eq(SF.mergeMessage({ id: 'a', ts: 1 }, { id: 'a', ts: 2 }), 'replace'); eq(SF.mergeMessage({ id: 'a', ts: 2 }, { id: 'a', ts: 1 }), 'skip'); eq(SF.mergeMessage(null, { id: 'a', ts: 1 }), 'put'); });
check('sync: only threads newer here are sent', () => deepEq(SF.threadsToSend([{ id: 'x', updatedAt: 5 }, { id: 'y', updatedAt: 1 }, { id: 'z', updatedAt: 3 }], [{ id: 'x', updatedAt: 9 }, { id: 'y', updatedAt: 0 }]), ['y', 'z']));

const fakeRoom = () => { const sent = []; const room = { sent, actions: {}, makeAction(name) { const a = { onMessage: null, send: async (d, o) => { sent.push([name, d, o]); } }; room.actions[name] = a; return a; }, getPeers: () => ({ p1: {} }), leave() {} }; return room; };
check('fix C2b: an old-path copy has its location ranges blanked', async () => { const f = new File([new Uint8Array(20).fill(7)], 'clip.mov', { type: 'video/quicktime' }); const g = await F.blankedCopy(f, [{ start: 4, end: 8 }]); const b = new Uint8Array(await g.arrayBuffer()); deepEq([...b.slice(2, 10)], [7, 7, 0, 0, 0, 0, 7, 7]); eq(g.name, 'clip.mov'); eq(g.type, 'video/quicktime'); });
check('fix I1: a re-encoded photo is not blanked with the original ranges', () => { const item = { file: { name: 'a.heic' }, ranges: [{ start: 1, end: 9 }] }; const std = { name: 'a.jpg' }; deepEq(F.importPlan(item, std), { file: std, ranges: undefined }); deepEq(F.importPlan(item, null), { file: item.file, ranges: item.ranges }); });
check('fix I9: a big send splits by count too', async () => { const items = Array.from({ length: 50 }, (_, i) => img({ ref: ref16(i), thumb: undefined })); const msgs = await W.splitOffer([{ type: 'album', aid: 'a1', n: 50, items }], async () => 10); ok(msgs.every((m) => m.reduce((a, p) => a + (p.type === 'album' ? p.items.length : 1), 0) <= 40)); eq(msgs.flatMap((m) => m.find((p) => p.type === 'album').items).length, 50); const files = Array.from({ length: 45 }, (_, i) => ({ type: 'file', ref: ref16(i), mh: R32, size: 1, mime: 'x', name: 'f' + i })); const fm = await W.splitOffer(files, async () => 10); ok(fm.every((m) => m.length <= 40)); eq(fm.flat().length, 45); });
check('fix I9: more than 200 photos become several albums', () => { const items = Array.from({ length: 450 }, (_, i) => img({ ref: ref16(i % 200) })); let k = 0; const parts = W.toAlbums(items, () => 'aid' + (k++)); eq(parts.length, 3); deepEq(parts.map((p) => p.n), [200, 200, 50]); eq(new Set(parts.map((p) => p.aid)).size, 3); eq(W.toAlbums(items.slice(0, 1), () => 'x')[0].type, 'image'); });
check('fix I4: device info goes only to pinned rooms', async () => { const t = new F.Transfers({ store: { listMedia: async () => [] }, media: {}, device: { id: 'dev1', name: 'Mac', kind: 'mac' }, pinned: ['self'] }); try { const a = fakeRoom(); const b = fakeRoom(); await t.attach('dm-x', a, {}); await t.attach('self', b, {}); const ha = a.sent.find((x) => x[0] === 'fhi'); const hb = b.sent.find((x) => x[0] === 'fhi'); eq(ha[1].device, undefined); eq(hb[1].device.id, 'dev1'); } finally { t.stop(); } });
check('fix I6: a full bitfield that never finished is finished', async () => { const h = [await sha(5)]; const rec = { id: R16, threadId: 'dm-x', role: 'in', state: 'moving', complete: false, size: 10, pieceSize: 262144, mh: await MF.manifestHash(h), hashes: MF.b64(MF.joinHashes(h)), have: MF.bfB64(MF.bfSet(MF.bfNew(1), 0)), updatedAt: 1 }; const saved = []; const t = new F.Transfers({ store: { listMedia: async () => [rec], putMedia: async (r) => { saved.push(r); } }, media: { closeFile: async () => {} } }); try { await t.attach('dm-x', fakeRoom(), {}); await new Promise((r) => setTimeout(r, 50)); eq(t.get(R16).complete, true); ok(saved.some((r) => r.complete && r.state === 'done')); } finally { t.stop(); } });
check('fix I6: patching delivery keeps the live record', async () => { const saved = []; const t = new F.Transfers({ store: { listMedia: async () => [], putMedia: async (r) => { saved.push(r); } }, media: {} }); try { await t.add({ id: R16, threadId: 'dm-x', role: 'in', state: 'done', complete: true, size: 1, have: '', hashes: '', mh: R32 }); await t.patch(R16, { delivered: true, onDevices: ['d1'] }); const r = t.get(R16); eq(r.complete, true); eq(r.state, 'done'); eq(r.delivered, true); deepEq(r.onDevices, ['d1']); ok(saved.length >= 1); } finally { t.stop(); } });
check('fix I5: a room whose name changes is rejoined', async () => { const joined = []; const left = []; const fr = new F.FilesRooms({ transfers: stubT(), join: (id) => { joined.push(id); return { leave: () => { left.push(id); } }; } }); await fr.sync([{ id: 'self', roomName: 'self-a', b64Key: KEY, pinned: true }]); await fr.sync([{ id: 'self', roomName: 'self-b', b64Key: KEY, pinned: true }]); eq(joined.length, 2); eq(left.length, 1); ok(joined[0] !== joined[1]); });
check('fix I7: a transfer nobody can serve shows as paused', () => { eq(F.shownState({ state: 'moving', complete: false }, { peers: 0 }), 'paused'); eq(F.shownState({ state: 'queued', complete: false }, { peers: 0 }), 'paused'); eq(F.shownState({ state: 'moving', complete: false }, { peers: 1 }), 'moving'); eq(F.shownState({ state: 'done', complete: true }, { peers: 0 }), 'done'); eq(F.shownState({ state: 'offered', complete: false }, { peers: 0 }), 'offered'); });

check('fix phone: a holder that stops answering is dropped and reported', async () => { const h = [await sha(1), await sha(2)]; const rec = { id: R16, threadId: 'dm-x', role: 'in', state: 'queued', complete: false, size: 300000, pieceSize: 262144, mh: await MF.manifestHash(h), hashes: MF.b64(MF.joinHashes(h)), have: MF.bfB64(MF.bfNew(2)), updatedAt: 1 }; const events = []; const t = new F.Transfers({ store: { listMedia: async () => [rec], putMedia: async () => {} }, media: {}, onChange: (id, x) => { if (x) events.push(x); }, timeoutMs: 40, tickMs: 15 }); try { const room = fakeRoom(); await t.attach('dm-x', room, {}); room.actions.fhi.onMessage({ caps: { files: 2 }, have: [R16], want: [] }, { peerId: 'p1' }); await new Promise((r) => setTimeout(r, 400)); ok(events.some((x) => x.stale && x.threadId === 'dm-x' && x.peerId === 'p1')); eq(t.peersOf('dm-x').length, 0); } finally { t.stop(); } });
check('fix phone: a files room can be rejoined on demand', async () => { const joined = []; const fr = new F.FilesRooms({ transfers: stubT(), join: (id) => { joined.push(id); return { leave: () => {} }; } }); await fr.sync(threadsN(1)); await fr.rejoin('t0'); eq(joined.length, 2); deepEq(fr.joined(), ['t0']); });

check('fix phone: a file open in another worker counts as busy on Safari and Chrome', async () => { ok(MF.isBusy({ name: 'InvalidStateError' })); ok(MF.isBusy({ name: 'NoModificationAllowedError' })); ok(!MF.isBusy({ name: 'NotFoundError' })); ok(!MF.isBusy(null)); });

const aiFlush = async () => { for (let i = 0; i < 40; i++) await null; };
const aiClock = () => {
  let t = 1000000; let n = 0; const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++n; timers.set(id, { at: t + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    async advance(ms) {
      const end = t + ms;
      await aiFlush();
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at || (x.at === next[1].at && id < next[0]))) next = [id, x];
        if (!next) break;
        timers.delete(next[0]); t = next[1].at; next[1].fn(); await aiFlush();
      }
      t = end; await aiFlush();
    }
  };
};
const linkedRooms = (count) => {
  const rooms = [];
  for (let i = 0; i < count; i++) {
    const room = { id: 'p' + i, up: true, sent: [], actions: {}, onPeerJoin: null, onPeerLeave: null };
    room.makeAction = (name) => {
      if (room.actions[name]) return room.actions[name];
      const a = { onMessage: null, send: async (data, o) => {
        room.sent.push([name, data, o && o.target]);
        const target = o && o.target;
        for (const other of rooms) {
          if (other === room || !other.up || !room.up) continue;
          if (target && target !== other.id) continue;
          const b = other.actions[name];
          if (b && b.onMessage) { const copy = JSON.parse(JSON.stringify(data)); queueMicrotask(() => b.onMessage(copy, { peerId: room.id })); }
        }
      } };
      room.actions[name] = a;
      return a;
    };
    rooms.push(room);
  }
  const leave = (i) => { rooms[i].up = false; for (const r of rooms) if (r !== rooms[i] && r.onPeerLeave) r.onPeerLeave(rooms[i].id); };
  const join = (i) => { rooms[i].up = true; for (const r of rooms) if (r !== rooms[i] && r.onPeerJoin) r.onPeerJoin(rooms[i].id); };
  return { rooms, join, leave };
};
const aiDev = (id, kind = 'mac') => ({ id, name: kind === 'mac' ? 'Mac' : 'iPhone', kind });
const aiAsk = (text = 'hello') => ({ threadId: 'ai-t1', tier: '27b', messages: [{ role: 'user', content: text }], pageLang: 'en', from: { device: aiDev('dev-phone', 'iphone') } });
const aiHostFor = (L, clock, o = {}) => {
  const calls = { loads: [], answers: [], signals: [] };
  const host = new L.AiHost({
    device: aiDev('dev-mac'), page: 'comms', clock,
    listModels: async () => o.models || [{ tier: '27b', state: 'cached' }, { tier: 'b2-2b', state: 'cached' }],
    load: o.load || (async (tier) => { calls.loads.push(tier); if (tier === 'b2-9b') throw new Error('model-not-cached'); return { engine: {}, tier, contextTokens: 4096 }; }),
    answer: o.answer || (async (ctx, ask, onText, signal) => {
      calls.answers.push(ask.messages[ask.messages.length - 1].content); calls.signals.push(signal);
      for (const piece of ['Hel', 'lo', ' there']) {
        if (signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
        onText(piece, { reset: false });
        await new Promise((r) => clock.setTimeout(r, 100));
      }
      if (signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      return { text: 'Hello there', tokens: 3, ms: 300 };
    }),
    isBusy: o.isBusy || (() => false),
    onActivity: o.onActivity || (() => {})
  });
  return { host, calls };
};
const aiWatch = (h) => { const ev = []; for (const k of ['wait', 'tok', 'done', 'err', 'gone']) h.on(k, (x) => ev.push([k, x])); return ev; };

check('ai-link: a host advertises its models and the asker lists it by device', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const seen = [];
  const client = new L.AiClient({ onHosts: (h) => seen.push(h), clock }); client.bind(rooms[1]);
  const { host } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await aiFlush(); await clock.advance(10);
  const hs = client.hosts();
  eq(hs.length, 1); eq(hs[0].peerId, 'p0'); eq(hs[0].device.id, 'dev-mac'); eq(hs[0].page, 'comms'); eq(hs[0].busy, false);
  deepEq(hs[0].models.map((m) => m.tier), ['27b', 'b2-2b']);
  ok(seen.length >= 1);
});

check('ai-link: an answer streams in order and finishes with stats', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const client = new L.AiClient({ clock }); client.bind(rooms[1]);
  const { host } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h = client.ask('p0', aiAsk()); const ev = aiWatch(h);
  await clock.advance(2000);
  const toks = ev.filter((e) => e[0] === 'tok');
  ok(toks.length >= 1);
  eq(toks[toks.length - 1][1].full, 'Hello there');
  const done = ev.find((e) => e[0] === 'done');
  ok(done); eq(done[1].stats.tier, '27b'); eq(done[1].stats.tokens, 3);
  ok(ev.findIndex((e) => e[0] === 'done') > ev.findIndex((e) => e[0] === 'tok'));
  const c2 = new L.AiClient({ clock }); const { rooms: r2 } = linkedRooms(2); c2.bind(r2[1]);
  const h2 = c2.ask('p0', aiAsk()); const ev2 = aiWatch(h2);
  const sa = r2[1].actions.fas;
  sa.onMessage({ op: 'tok', id: h2.id, seq: 1, text: ' world' }, { peerId: 'p0' });
  sa.onMessage({ op: 'tok', id: h2.id, seq: 0, text: 'hello' }, { peerId: 'p0' });
  sa.onMessage({ op: 'done', id: h2.id, seq: 2, stats: { tier: '27b', tokens: 2, ms: 1 } }, { peerId: 'p0' });
  await aiFlush();
  deepEq(ev2.filter((e) => e[0] === 'tok').map((e) => e[1].full), ['hello', 'hello world']);
  eq(ev2[ev2.length - 1][0], 'done');
});

check('ai-link: a second ask waits as busy and answers after the first', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(3);
  const a = new L.AiClient({ clock }); a.bind(rooms[1]);
  const b = new L.AiClient({ clock }); b.bind(rooms[2]);
  const { host, calls } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const order = [];
  const h1 = a.ask('p0', aiAsk('one')); const e1 = aiWatch(h1); h1.on('done', () => order.push('one'));
  await aiFlush();
  const h2 = b.ask('p0', aiAsk('two')); const e2 = aiWatch(h2); h2.on('done', () => order.push('two'));
  await clock.advance(5000);
  const w = e2.find((e) => e[0] === 'wait');
  ok(w); eq(w[1].reason, 'busy'); eq(w[1].ahead, 1);
  deepEq(order, ['one', 'two']);
  deepEq(calls.answers, ['one', 'two']);
  ok(e1.some((e) => e[0] === 'done'));
});

check('ai-link: a fourth waiting ask is refused as busy', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const hs = []; const evs = [];
  for (let i = 0; i < 5; i++) { const h = c.ask('p0', aiAsk('q' + i)); hs.push(h); evs.push(aiWatch(h)); await aiFlush(); }
  const refused = evs.filter((ev) => ev.some((e) => e[0] === 'err' && e[1].reason === 'busy'));
  eq(refused.length, 1);
  ok(evs[4].some((e) => e[0] === 'err' && e[1].reason === 'busy'));
  eq(L.QUEUE_MAX, 3);
});

check('ai-link: cancel stops the answer and frees the host', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host, calls } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h1 = c.ask('p0', aiAsk('one')); aiWatch(h1);
  await clock.advance(50);
  h1.cancel();
  await aiFlush();
  eq(calls.signals[0].aborted, true);
  const h2 = c.ask('p0', aiAsk('two')); const e2 = aiWatch(h2);
  await clock.advance(2000);
  ok(e2.some((e) => e[0] === 'done'));
  deepEq(calls.answers, ['one', 'two']);
});

check('ai-link: the asker leaving stops the answer', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host, calls } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  c.ask('p0', aiAsk('one')); await aiFlush();
  c.ask('p0', aiAsk('two')); await clock.advance(50);
  const before = rooms[0].sent.length;
  host.peerLeft('p1');
  await clock.advance(3000);
  eq(calls.signals[0].aborted, true);
  deepEq(calls.answers, ['one']);
  eq(rooms[0].sent.slice(before).filter((s) => s[0] === 'fas').length, 0);
});

check('ai-link: a slow load keeps the asker waiting, not gone', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const load = async (tier, onStage) => { onStage('loading'); await new Promise((r) => clock.setTimeout(r, 3 * L.STALL_MS)); return { engine: {}, tier, contextTokens: 4096 }; };
  const { host } = aiHostFor(L, clock, { load }); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h = c.ask('p0', aiAsk()); const ev = aiWatch(h);
  await clock.advance(3 * L.STALL_MS + 2000);
  ok(ev.filter((e) => e[0] === 'wait' && e[1].reason === 'loading').length >= 3);
  eq(ev.filter((e) => e[0] === 'gone').length, 0);
  ok(ev.some((e) => e[0] === 'done'));
});

check('ai-link: a host that goes silent is gone after STALL_MS', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const answer = async () => new Promise(() => {});
  const load = async (tier) => ({ engine: {}, tier, contextTokens: 4096 });
  const { host } = aiHostFor(L, clock, { answer, load }); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h = c.ask('p0', aiAsk()); const ev = aiWatch(h);
  rooms[0].up = false;
  await clock.advance(L.STALL_MS - 100);
  eq(ev.filter((e) => e[0] === 'gone').length, 0);
  await clock.advance(200);
  eq(ev.filter((e) => e[0] === 'gone').length, 1);
});

check('ai-link: a host that leaves mid-answer is gone at once', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h = c.ask('p0', aiAsk()); const ev = aiWatch(h);
  await clock.advance(150);
  c.peerLeft('p0');
  await aiFlush();
  eq(ev.filter((e) => e[0] === 'gone').length, 1);
  eq(c.hosts().length, 0);
});

check("ai-link: a tier the host can't load answers tier-unavailable", async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h = c.ask('p0', Object.assign(aiAsk(), { tier: 'b2-9b' })); const ev = aiWatch(h);
  await clock.advance(500);
  ok(ev.some((e) => e[0] === 'err' && e[1].reason === 'tier-unavailable'));
});

check('ai-link: a disabled host advertises no models and refuses asks as not-hosting', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host, calls } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  host.setEnabled(false);
  await clock.advance(10);
  deepEq(c.hosts()[0].models, []);
  const h = c.ask('p0', aiAsk()); const ev = aiWatch(h);
  await clock.advance(500);
  ok(ev.some((e) => e[0] === 'err' && e[1].reason === 'not-hosting'));
  eq(calls.answers.length, 0);
});

check('ai-link: asks with images, bad ids or an assistant last turn are refused as bad-request', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const good = { op: 'ai', id: 'abcDEF_-12', threadId: 'ai-t1', tier: '27b', messages: [{ role: 'user', content: 'hi' }], images: [], params: { pageLang: 'en' }, from: { device: aiDev('d1', 'iphone') } };
  ok(L.cleanAsk(good));
  eq(L.cleanAsk(Object.assign({}, good, { images: ['x'] })), null);
  eq(L.cleanAsk(Object.assign({}, good, { id: 'bad id!' })), null);
  eq(L.cleanAsk(Object.assign({}, good, { id: 'x'.repeat(65) })), null);
  eq(L.cleanAsk(Object.assign({}, good, { threadId: 't'.repeat(201) })), null);
  eq(L.cleanAsk(Object.assign({}, good, { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })), null);
  eq(L.cleanAsk(Object.assign({}, good, { messages: [{ role: 'system', content: 'a' }] })), null);
  eq(L.cleanAsk(Object.assign({}, good, { messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'a' })) })), null);
  eq(L.cleanAsk(Object.assign({}, good, { messages: [{ role: 'user', content: 'x'.repeat(L.CHARS_MAX + L.TEXT_MAX + 1) }] })), null);
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const { host, calls } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  const got = [];
  const sa = rooms[1].makeAction('fas'); sa.onMessage = (d) => got.push(d);
  rooms[1].makeAction('faq').send(Object.assign({}, good, { images: ['x'] }), { target: 'p0' });
  await clock.advance(100);
  ok(got.some((d) => d.op === 'err' && d.reason === 'bad-request' && d.id === good.id));
  eq(calls.answers.length, 0);
});

check('ai-link: a long thread is cut to the newest turns that fit', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const turns = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'w'.repeat(299) + String(i % 10) }));
  turns.push({ role: 'user', text: 'final question' });
  const out = L.trimForRequest(turns);
  ok(out.length <= L.TURNS_MAX);
  ok(out.reduce((a, m) => a + m.content.length, 0) <= L.CHARS_MAX);
  deepEq(out[out.length - 1], { role: 'user', content: 'final question' });
  deepEq(out.map((m) => m.content), turns.slice(turns.length - out.length).map((t) => t.text));
  const big = L.trimForRequest([{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'z'.repeat(50000) }]);
  eq(big.length, 1); eq(big[0].content.length, L.TEXT_MAX);
  const tail = L.trimForRequest([{ role: 'user', text: 'q' }, { role: 'assistant', text: 'partial' }]);
  deepEq(tail, [{ role: 'user', content: 'q' }]);
});

check('ai-link: a host is dropped HOST_TTL_MS after its last advert', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  eq(c.hosts().length, 1);
  await clock.advance(L.ADVERT_MS * 3);
  eq(c.hosts().length, 1);
  host.close();
  await clock.advance(L.HOST_TTL_MS + 1000);
  eq(c.hosts().length, 0);
});

check('ai-link: a newer advert from the same device replaces the old peer', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(3);
  const c = new L.AiClient({ clock }); c.bind(rooms[2]);
  const a = aiHostFor(L, clock).host; a.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const b = aiHostFor(L, clock, { models: [{ tier: 'b2-4b', state: 'loaded' }] }).host; b.bind(rooms[1], { ownsPeers: false });
  await clock.advance(10);
  const hs = c.hosts();
  eq(hs.length, 1); eq(hs[0].peerId, 'p1'); deepEq(hs[0].models, [{ tier: 'b2-4b', state: 'loaded' }]);
});

check('ai-link: remembered hosts keep the newest 8 devices', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const st = new MemoryStorage();
  for (let i = 0; i < 10; i++) L.rememberHosts([{ peerId: 'p' + i, device: aiDev('dev' + i), page: 'comms', models: [{ tier: '27b', state: 'cached' }], busy: false, at: 1000 + i }], st);
  const k = L.knownHosts(st);
  eq(Object.keys(k).length, 8);
  ok(!k.dev0 && !k.dev1 && k.dev9 && k.dev2);
  deepEq(k.dev9.models, [{ tier: '27b', state: 'cached' }]);
  ok(st.getItem('mentria.comms.aihosts'));
  st.setItem('mentria.comms.aihosts', 'not json');
  deepEq(L.knownHosts(st), {});
});

check('ai-view: a thread set to another device opens inline, every other thread opens its page', async () => {
  const V = await import('/assets/js/comms/ai-view.js');
  const me = 'dev-phone';
  eq(V.aiRoute({ id: 'ai-1', kind: 'model' }, { myDeviceId: me }), 'page');
  eq(V.aiRoute({ id: 'ai-2', kind: 'model', meta: {} }, { myDeviceId: me }), 'page');
  eq(V.aiRoute({ id: 'ai-3', kind: 'model', meta: { route: { device: me, kind: 'iphone', tier: 'b2-2b' } } }, { myDeviceId: me }), 'page');
  eq(V.aiRoute({ id: 'ai-4', kind: 'model', meta: { route: { device: 'dev-mac', kind: 'mac', tier: '27b' } } }, { myDeviceId: me }), 'inline');
  eq(V.aiRoute({ id: 'ai-5', kind: 'model', meta: { tool: 'annotate-image', route: { device: 'dev-mac', kind: 'mac', tier: '27b' } } }, { myDeviceId: me }), 'page');
  eq(V.aiRoute(null, { myDeviceId: me }), 'page');
});

const aiMenuT = { ai: { this_device: 'This device' }, devices: { kind_mac: 'Mac', kind_windows: 'Windows PC', kind_iphone: 'iPhone' } };
const aiMenuInput = () => ({
  local: [{ tier: 'b2-2b', cached: true, sizeLabel: '520 MB' }, { tier: 'b2-4b', cached: false, sizeLabel: '1.1 GB' }],
  hosts: [{ peerId: 'p1', device: { id: 'mac1', name: 'Mac', kind: 'mac' }, page: 'comms', models: [{ tier: '27b', state: 'loaded' }, { tier: 'b2-2b', state: 'cached' }], busy: false, at: 900 }],
  known: {
    mac1: { device: { id: 'mac1', name: 'Mac', kind: 'mac' }, models: [{ tier: '27b', state: 'cached' }], at: 800 },
    pc1: { device: { id: 'pc1', name: 'PC', kind: 'windows' }, models: [{ tier: 'b2-9b', state: 'cached' }], at: 700 },
    me: { device: { id: 'me', name: 'iPhone', kind: 'iphone' }, models: [], at: 990 }
  },
  myDeviceId: 'me', T: aiMenuT
});

check('ai-view: the menu puts this device first, then online devices, then asleep ones', async () => {
  const V = await import('/assets/js/comms/ai-view.js');
  const secs = V.modelSections(aiMenuInput());
  deepEq(secs.map((x) => x.title), ['This device', 'Mac', 'Windows PC']);
  eq(secs[0].device, null);
  deepEq(secs[0].items.map((i) => [i.tier, i.state, i.size]), [['b2-2b', 'cached', '520 MB'], ['b2-4b', 'download', '1.1 GB']]);
  eq(secs[1].device.id, 'mac1');
  deepEq(secs[1].items.map((i) => [i.tier, i.state]), [['27b', 'loaded'], ['b2-2b', 'cached']]);
  eq(secs[1].items[0].label, '27B');
});

check("ai-view: an asleep device's models are listed but marked asleep", async () => {
  const V = await import('/assets/js/comms/ai-view.js');
  const secs = V.modelSections(aiMenuInput());
  const pc = secs.find((x) => x.device && x.device.id === 'pc1');
  ok(pc);
  deepEq(pc.items.map((i) => [i.tier, i.state]), [['b2-9b', 'asleep']]);
  eq(pc.online, false);
  eq(secs.find((x) => x.device && x.device.id === 'me'), undefined);
});

check("ai-link: an empty advert from one page doesn't hide another page of the same device", async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(3);
  const c = new L.AiClient({ clock }); c.bind(rooms[2]);
  const page = aiHostFor(L, clock, { models: [{ tier: 'b2-2b', state: 'loaded' }] }).host; page.bind(rooms[1], { ownsPeers: false });
  await clock.advance(10);
  const comms = aiHostFor(L, clock).host; comms.bind(rooms[0], { ownsPeers: false });
  comms.setEnabled(false);
  await clock.advance(10);
  let hs = c.hosts();
  eq(hs.length, 1); eq(hs[0].peerId, 'p1'); deepEq(hs[0].models, [{ tier: 'b2-2b', state: 'loaded' }]);
  await clock.advance(L.ADVERT_MS * 2);
  hs = c.hosts();
  eq(hs.length, 1); eq(hs[0].peerId, 'p1');
  c.peerLeft('p1');
  hs = c.hosts();
  eq(hs.length, 1); eq(hs[0].peerId, 'p0'); deepEq(hs[0].models, []);
});

check('fix I4: rebinding a host to a new room drops the old room jobs', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host, calls } = aiHostFor(L, clock); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  c.ask('p0', aiAsk('one')); await aiFlush();
  c.ask('p0', aiAsk('two')); await clock.advance(50);
  const fresh = linkedRooms(1).rooms[0];
  const before = rooms[0].sent.length;
  host.bind(fresh, { ownsPeers: false });
  await clock.advance(3000);
  eq(calls.signals[0].aborted, true);
  deepEq(calls.answers, ['one']);
  eq(rooms[0].sent.slice(before).filter((x) => x[0] === 'fas').length, 0);
});

check('fix I4: rebinding the asker ends its pending asks as gone', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host } = aiHostFor(L, clock, { answer: async () => new Promise(() => {}) }); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h = c.ask('p0', aiAsk()); const ev = aiWatch(h);
  await clock.advance(50);
  c.bind(linkedRooms(1).rooms[0]);
  await aiFlush();
  eq(ev.filter((e) => e[0] === 'gone').length, 1);
  eq(c.hosts().length, 0);
});

check('fix I6: a host answers only tiers it lists', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host, calls } = aiHostFor(L, clock, { models: [{ tier: 'b2-2b', state: 'loaded' }] }); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h = c.ask('p0', aiAsk()); const ev = aiWatch(h);
  await clock.advance(500);
  ok(ev.some((e) => e[0] === 'err' && e[1].reason === 'tier-unavailable'));
  eq(calls.loads.length, 0);
});

check('fix I6: a host that lists nothing answers not-hosting without loading', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const { host, calls } = aiHostFor(L, clock, { models: [] }); host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h = c.ask('p0', aiAsk()); const ev = aiWatch(h);
  await clock.advance(500);
  ok(ev.some((e) => e[0] === 'err' && e[1].reason === 'not-hosting'));
  eq(calls.loads.length, 0);
});

check('fix I7: a failed answer is reported so the host can drop its engine', async () => {
  const L = await import('/assets/js/comms/ai-link.js');
  const clock = aiClock(); const { rooms } = linkedRooms(2);
  const c = new L.AiClient({ clock }); c.bind(rooms[1]);
  const failures = [];
  const host = new L.AiHost({ device: aiDev('dev-mac'), page: 'comms', clock, listModels: async () => [{ tier: '27b', state: 'loaded' }], load: async (tier) => ({ engine: {}, tier, contextTokens: 4096 }), answer: async () => { throw new Error('device lost'); }, onFailure: (ctx, err) => failures.push([ctx.tier, err.message]) });
  host.bind(rooms[0], { ownsPeers: false });
  await clock.advance(10);
  const h = c.ask('p0', aiAsk()); const ev = aiWatch(h);
  await clock.advance(500);
  ok(ev.some((e) => e[0] === 'err' && e[1].reason === 'failed'));
  deepEq(failures, [['27b', 'device lost']]);
});

const fakeModules = (o = {}) => {
  const st = { calls: [], engines: [] };
  const M = {
    hostModels: async () => [{ tier: '27b', state: 'cached' }],
    ensureModel: async (factory, opts) => {
      st.calls.push(opts);
      if (o.gate) await o.gate;
      const e = { terminated: 0, unloaded: 0, terminate() { this.terminated++; }, async unload() { this.unloaded++; } };
      st.engines.push(e);
      return { engine: e, tier: opts.tier, maxSeq: 4096 };
    }
  };
  return { st, modules: async () => ({ M, D: { MentriaEngine: function () {} } }) };
};

check('fix I1: unloading during a load throws the new engine away', async () => {
  const A = await import('/assets/js/comms/ai-local.js');
  let open; const gate = new Promise((r) => { open = r; });
  const { st, modules } = fakeModules({ gate });
  const local = A.createLocalEngine({ modules });
  const p = local.load('27b');
  await aiFlush();
  await local.unload();
  open();
  await assert.rejects(p);
  eq(local.current(), null);
  eq(st.engines.length, 1);
  eq(st.engines[0].terminated, 1);
});

check('fix I7: a lost GPU device drops the local engine', async () => {
  const A = await import('/assets/js/comms/ai-local.js');
  const { st, modules } = fakeModules();
  const local = A.createLocalEngine({ modules });
  await local.load('27b');
  eq(local.current(), '27b');
  ok(typeof st.calls[0].onDeviceLost === 'function');
  st.calls[0].onDeviceLost({ reason: 'test' });
  eq(local.current(), null);
  await local.load('27b');
  eq(st.calls.length, 2);
});

const pageHostDeps = (o = {}) => {
  const st = { requests: [], joins: [], leaves: 0, ice: 0, derive: 0, rooms: [], unlocked: !!o.unlocked, released: 0 };
  const names = o.names || ['self-w1'];
  const locks = { request: (name, opts, cb) => { st.requests.push([name, opts && opts.steal]); return Promise.resolve(cb()).then(() => { st.released++; }); } };
  const deps = {
    device: { id: 'dev-mac', name: 'Mac', kind: 'mac' },
    isUnlocked: () => st.unlocked,
    locks,
    getIce: async () => { st.ice++; return [{ urls: 'stun:x' }]; },
    derive: async () => { const n = names[Math.min(st.derive, names.length - 1)]; st.derive++; return { roomId: 'mf-' + n, password: 'pw' }; },
    joinRoom: async (cfg, id) => { st.joins.push([id, cfg.rtcConfig.iceServers.length]); const r = linkedRooms(1).rooms[0]; r.leave = () => { st.leaves++; }; st.rooms.push(r); return r; },
    setInterval: () => 0
  };
  return { st, deps };
};

check('fix I1: AI Chat takes the host lock when a load starts, even while locked', async () => {
  const P = await import('/assets/js/comms/ai-page-host.js');
  const { st, deps } = pageHostDeps({ unlocked: false });
  let eng = null;
  const ph = P.startPageHost({ getEngine: () => eng, deps });
  ph.loading();
  await aiFlush();
  deepEq(st.requests, [['mentria-ai-host', true]]);
  eng = { engine: {}, tier: 'b2-2b', contextTokens: 4096 };
  await ph.refresh();
  await aiFlush();
  eq(st.requests.length, 1);
  eq(st.released, 0);
  eq(st.joins.length, 0);
  eng = null;
  await ph.refresh();
  await aiFlush();
  eq(st.released, 1);
});

check('fix I1: unlocking later starts hosting', async () => {
  const P = await import('/assets/js/comms/ai-page-host.js');
  const { st, deps } = pageHostDeps({ unlocked: false });
  const eng = { engine: {}, tier: 'b2-2b', contextTokens: 4096 };
  const ph = P.startPageHost({ getEngine: () => eng, deps });
  await ph.refresh();
  await aiFlush();
  eq(st.joins.length, 0);
  st.unlocked = true;
  await ph.refresh();
  await aiFlush();
  eq(st.joins.length, 1);
  eq(st.requests.length, 1);
});

check('fix I5: the page host follows the weekly room change with fresh ICE', async () => {
  const P = await import('/assets/js/comms/ai-page-host.js');
  const { st, deps } = pageHostDeps({ unlocked: true, names: ['self-w1', 'self-w1', 'self-w2'] });
  const eng = { engine: {}, tier: 'b2-2b', contextTokens: 4096 };
  const ph = P.startPageHost({ getEngine: () => eng, deps });
  await ph.refresh();
  await aiFlush();
  deepEq(st.joins.map((j) => j[0]), ['mf-self-w1']);
  await ph.checkWeek();
  await aiFlush();
  deepEq(st.joins.map((j) => j[0]), ['mf-self-w1']);
  await ph.checkWeek();
  await aiFlush();
  deepEq(st.joins.map((j) => j[0]), ['mf-self-w1', 'mf-self-w2']);
  eq(st.leaves, 1);
  eq(st.ice, 2);
  eq(st.requests.length, 1);
});

const RK = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const ephOf = (map) => ({ get: (r) => map[r] || null, set: (r, key, kv) => { map[r] = { key, kv }; } });
check('rooms: an imported link resolves with its key', () => deepEq(RM.resolveHash('#abc:' + RK, [], ephOf({})), { room: 'abc', key: RK, kv: 1, imported: true }));
check('rooms: an imported link that matches a saved room keeps its kv', () => deepEq(RM.resolveHash('#abc:' + RK, [{ room: 'abc', key: RK, kv: 2 }], ephOf({})), { room: 'abc', key: RK, kv: 2, imported: true }));
check('rooms: a bare name resolves to the saved key', () => deepEq(RM.resolveHash('#abc', [{ room: 'abc', key: RK, kv: 2 }], ephOf({})), { room: 'abc', key: RK, kv: 2, imported: false }));
check('rooms: a bare ephemeral name resolves from this tab', () => deepEq(RM.resolveHash('#!tmp', [], ephOf({ '!tmp': { key: RK, kv: 2 } })), { room: '!tmp', key: RK, kv: 2, imported: false }));
check('rooms: an unknown bare name joins without a key', () => deepEq(RM.resolveHash('#open', [], ephOf({})), { room: 'open', key: null, kv: 1, imported: false }));
check('rooms: DM and invite hashes are not resolved here', () => {
  eq(RM.resolveHash('#dm-x:' + RK, [], ephOf({})), null);
  eq(RM.resolveHash('#!dm-x:' + RK, [], ephOf({})), null);
  eq(RM.resolveHash('#:i1.abc', [], ephOf({})), null);
  eq(RM.resolveHash('', [], ephOf({})), null);
  eq(RM.resolveHash('#', [], ephOf({})), null);
});
check('rooms: an encoded room name resolves decoded', () => deepEq(RM.resolveHash('#Trip%20photos', [{ room: 'Trip photos', key: RK }], ephOf({})), { room: 'Trip photos', key: RK, kv: 1, imported: false }));
check('rooms: the tab key memory keeps the newest 20', () => {
  const st = new MemoryStorage();
  const e = RM.ephKeys(st);
  for (let i = 0; i < 25; i++) e.set('!r' + i, RK, 2);
  eq(e.get('!r0'), null);
  deepEq(e.get('!r24'), { key: RK, kv: 2 });
  deepEq(RM.ephKeys(st).get('!r24'), { key: RK, kv: 2 });
});
check('rooms: a broken tab key memory reads as empty', () => {
  const st = new MemoryStorage();
  st.setItem('mentria.comms.ephkeys', '{nope');
  eq(RM.ephKeys(st).get('!x'), null);
  eq(RM.ephKeys(null).get('!x'), null);
});

const rawOf = (k) => Buffer.from(k.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const nodeHkdfVectors = (k, room) => {
  const ikm = rawOf(k);
  const sub = (info) => Buffer.from(hkdfSync('sha256', ikm, Buffer.from('mentria-room-v2'), Buffer.from(info), 32));
  const topic = sub('topic');
  return {
    chat: sub('chat').toString('base64url'),
    topic: topic.toString('base64url'),
    signal: sub('signal').toString('base64url'),
    files: sub('files').toString('base64url'),
    topicTag: createHmac('sha256', topic).update('mentria-comms-topic-v2|' + room).digest('base64url')
  };
};
const exportRaw = async (key) => new Uint8Array(await crypto.subtle.exportKey('raw', key));
check("keys: a v1 room keeps today's chat key, topic and password", async () => {
  const k = await W.roomKeys(FIX.key, 1);
  eq(await W.chatTopicFor('mentria-test-room', FIX.key, 1), FIX.topic);
  eq(await W.chatTopicFor('mentria-test-room', FIX.key), FIX.topic);
  eq(k.password, FIX.key);
  eq(await W.decryptText(k.chatKey, FIX.enc), 'golden plaintext');
  eq(Buffer.from(k.topicRaw).toString('base64'), FIX.key);
  eq(Buffer.from(k.filesIkm).toString('base64'), FIX.key);
});
check('keys: a v2 room splits chat, topic, signal and files keys', async () => {
  const want = nodeHkdfVectors(FIX.key, 'mentria-test-room');
  const k = await W.roomKeys(FIX.key, 2, { extractable: true });
  eq(Buffer.from(await exportRaw(k.chatKey)).toString('base64url'), want.chat);
  eq(Buffer.from(k.topicRaw).toString('base64url'), want.topic);
  eq(k.password, want.signal);
  eq(Buffer.from(k.filesIkm).toString('base64url'), want.files);
  eq(await W.chatTopicFor('mentria-test-room', FIX.key, 2), want.topicTag);
  ok(want.topicTag !== FIX.topic);
});
check('keys: a v2 room never hands the chat key to signalling', async () => {
  const want = nodeHkdfVectors(FIX.key, 'r');
  const k = await W.roomKeys(FIX.key, 2);
  ok(k.password !== FIX.key && k.password !== want.chat && k.password !== FIX.key.replace(/=+$/, ''));
  eq(new Set([want.chat, want.topic, want.signal, want.files]).size, 4);
});
check('keys: a bad key gives nothing', async () => { eq(await W.roomKeys('short', 2), null); eq(await W.roomKeys('', 1), null); eq(await W.chatTopicFor('r', 'short', 2), null); });
check('files: a v2 room derives its files room from the files key', async () => {
  const one = await F.filesRoomFor('r', FIX.key, 1);
  const two = await F.filesRoomFor('r', FIX.key, 2);
  deepEq(one, await F.filesRoomFor('r', FIX.key));
  ok(one.roomId !== two.roomId && one.password !== two.password);
  deepEq(two, await F.filesRoomFor('r', FIX.key, 2));
});

const memStore = () => { const m = new Map(); return { get: (ns, k) => (m.has(ns + '.' + k) ? structuredClone(m.get(ns + '.' + k)) : null), set: (ns, k, v) => { m.set(ns + '.' + k, structuredClone(v)); return true; }, remove: (ns, k) => m.delete(ns + '.' + k) }; };
check('sign: a signed body verifies in its room', async () => { const v = await SG.verifyBody(VEC.signed, VEC.room, VEC.cmid); eq(v.ok, true); eq(v.sigFp, await SG.sigFingerprint(VEC.spub)); eq(v.ts, VEC.ts); deepEq(v.spub, VEC.spub); });
check('sign: a body replayed into another room fails', async () => eq((await SG.verifyBody(VEC.signed, 'other-room', VEC.cmid)).ok, false));
check('sign: a changed text, part or ctl fails', async () => { for (const k of [{ t: 'hellO' }, { p: [{ type: 'text', text: 'x' }] }, { ctl: { k: 'ring' } }]) eq((await SG.verifyBody({ ...VEC.signed, ...k }, VEC.room, VEC.cmid)).ok, false); });
check('sign: a cmid or time change fails', async () => { eq((await SG.verifyBody(VEC.signed, VEC.room, 'abc:2')).ok, false); eq((await SG.verifyBody({ ...VEC.signed, sg: { ...VEC.signed.sg, ts: VEC.ts + 1 } }, VEC.room, VEC.cmid)).ok, false); });
check('sign: an unsigned or malformed body is not verified', async () => { eq((await SG.verifyBody(VEC.body, VEC.room, VEC.cmid)).ok, false); eq((await SG.verifyBody({ ...VEC.signed, sg: { pub: { x: 'a', y: 'b' }, ts: 1, s: 'zz' } }, VEC.room, VEC.cmid)).ok, false); eq((await SG.verifyBody(null, VEC.room, VEC.cmid)).ok, false); eq((await SG.verifyBody({ ...VEC.signed, sg: 'x' }, VEC.room, VEC.cmid)).ok, false); });
check('sign: a fresh signature round-trips', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const j = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const out = await SG.signBody(kp.privateKey, { x: j.x, y: j.y }, 'r', 'c:1', { v: 2, t: 'x', p: [{ type: 'text', text: 'y' }] }, 5);
  deepEq(Object.keys(out), ['v', 't', 'p', 'sg']);
  eq(out.sg.ts, 5);
  eq((await SG.verifyBody(JSON.parse(JSON.stringify(out)), 'r', 'c:1')).ok, true);
});
check('sign: signing fingerprints differ from identity fingerprints', async () => { const a = await SG.sigFingerprint(VEC.spub); ok(/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(a)); ok(a !== await CIDM.fingerprint(VEC.spub)); });
check('id: the signing key is created once and kept in idkeys', async () => {
  fakeIdentity({ unlocked: true });
  window.MentriaStore = memStore();
  await CIDM.ensureKeypair();
  const before = MentriaStore.get('comms', 'idkeys');
  const a = await CIDM.ensureSigningKey();
  const b = await CIDM.ensureSigningKey();
  eq(a.sigFp, b.sigFp);
  deepEq(a.spub, b.spub);
  eq(a.sigFp, await SG.sigFingerprint(a.spub));
  const after = MentriaStore.get('comms', 'idkeys');
  deepEq(after.pub, before.pub);
  deepEq(after.wrapped, before.wrapped);
  ok(after.sign && after.sign.wrapped && after.sign.wrapped.ct);
  deepEq({ x: after.sign.pub.x, y: after.sign.pub.y }, a.spub);
  const out = await SG.signBody(a.signKey, a.spub, 'r', 'c', { v: 2, t: 'q' });
  eq((await SG.verifyBody(out, 'r', 'c')).ok, true);
  deepEq((await CIDM.ensureKeypair()).publicJwk, before.pub);
});
check('id: a contact code carries the signing key and old codes still read', () => {
  const code = CIDM.encodeContactCode({ name: 'A' }, { x: 'X', y: 'Y' }, null, { x: 'SX', y: 'SY' });
  ok(code.startsWith('MC1.'));
  deepEq(CIDM.decodeContactCode(code).spub, { x: 'SX', y: 'SY' });
  const old = CIDM.encodeContactCode({ name: 'A' }, { x: 'X', y: 'Y' }, 'ring1234567890123456789');
  eq(CIDM.decodeContactCode(old).spub, undefined);
  eq(CIDM.decodeContactCode(old).ring, 'ring1234567890123456789');
});
check('id: contacts keep a signing key and a newer one replaces it', async () => {
  window.MentriaStore = memStore();
  await CIDM.addContact({ name: 'B', pub: { x: 'X1', y: 'Y1' }, spub: { x: 'S1', y: 'T1' } });
  deepEq(CIDM.contactByPub({ x: 'X1', y: 'Y1' }).spub, { x: 'S1', y: 'T1' });
  await CIDM.addContact({ name: 'B', pub: { x: 'X1', y: 'Y1' }, spub: { x: 'S2', y: 'T2' }, annTs: 5 });
  deepEq(CIDM.contactByPub({ x: 'X1', y: 'Y1' }).spub, { x: 'S2', y: 'T2' });
  await CIDM.addContact({ name: 'B', pub: { x: 'X1', y: 'Y1' }, spub: { x: 'S3', y: 'T3' }, annTs: 4 });
  deepEq(CIDM.contactByPub({ x: 'X1', y: 'Y1' }).spub, { x: 'S2', y: 'T2' });
  await CIDM.addContact({ name: 'B', pub: { x: 'X1', y: 'Y1' }, spub: { x: 1, y: 2 }, annTs: 9 });
  deepEq(CIDM.contactByPub({ x: 'X1', y: 'Y1' }).spub, { x: 'S2', y: 'T2' });
});
check('wire: unpack keeps the signature and the parsed body', () => { const u = W.unpackChatPlain(JSON.stringify(VEC.signed)); deepEq(u.sg, VEC.signed.sg); eq(u.obj.t, 'hello'); eq(u.text, 'hello'); eq(W.unpackChatPlain('{"v":2,"t":"x"}').sg, null); });
check('wire: packChatBody is what packChatPlain writes', () => { eq(JSON.stringify(W.packChatBody('hi', { fp: 'B', legacyFp: 'A' })), FIX.pack); eq(W.packChatPlain('hi', { fp: 'B', legacyFp: 'A' }), FIX.pack); });

const INV_TOKEN = 'AAECAwQFBgcICQoLDA0ODw';
const nodeInvite = (token) => {
  const ikm = Buffer.from(token, 'base64url');
  const sub = (info, n) => Buffer.from(hkdfSync('sha256', ikm, Buffer.from('mentria-invite-v1'), Buffer.from(info), n));
  return { topic: createHmac('sha256', sub('invite-topic', 32)).update('mentria-invite-v1').digest('base64url'), id: sub('invite-id', 9).toString('base64url'), sk: sub('invite-nostr', 32).toString('hex') };
};
const invBody = (over = {}) => Object.assign({ v: 1, room: 'trip', key: RK, kv: 2, label: 'Trip', by: { name: 'Alice', pub: { x: 'X', y: 'Y' } }, exp: Math.floor(Date.now() / 1000) + 3600, once: true }, over);
class FakeSock {
  constructor(reply) { this.reply = reply; this.sent = []; this.ls = new Set(); }
  addEventListener(t, fn) { if (t === 'message') this.ls.add(fn); }
  removeEventListener(t, fn) { this.ls.delete(fn); }
  emit(m) { for (const fn of [...this.ls]) fn({ data: JSON.stringify(m), target: this }); }
  send(s) { this.sent.push(s); const m = JSON.parse(s); if (m[0] === 'REQ' && this.reply) this.reply(this, m[1]); }
}
check('invite: a token makes a 22-character link that parses back', () => {
  const t = IV.newInviteToken();
  ok(/^[A-Za-z0-9_-]{22}$/.test(t));
  eq(IV.inviteUrl('https://mentria.ai', t), 'https://mentria.ai/comms/#:i1.' + t);
  eq(IV.parseInvite(IV.inviteUrl('https://mentria.ai/', t)), t);
  eq(IV.parseInvite('#:i1.' + t), t);
  eq(IV.parseInvite('i1.' + t), t);
  eq(IV.parseInvite('  ' + IV.inviteUrl('https://beta.mentria.ai', t) + '  '), t);
  eq(IV.parseInvite('#room:' + RK), null);
  eq(IV.parseInvite('#:i1.short'), null);
  eq(IV.parseInvite(''), null);
});
check('invite: keys match the independent derivation', async () => {
  const k = await IV.inviteKeys(INV_TOKEN);
  const want = nodeInvite(INV_TOKEN);
  eq(k.topic, want.topic);
  eq(k.id, want.id);
  eq(Buffer.from(k.sk).toString('hex'), want.sk);
  eq(k.id.length, 12);
  eq(await IV.inviteKeys('nope'), null);
});
check('invite: a sealed body opens with its token', async () => {
  const k = await IV.inviteKeys(INV_TOKEN);
  const body = invBody();
  const opened = await IV.openInvite(k.aes, await IV.sealInvite(k.aes, body));
  eq(opened.room, 'trip'); eq(opened.key, RK); eq(opened.kv, 2); eq(opened.label, 'Trip'); eq(opened.by.name, 'Alice'); deepEq(opened.by.pub, { x: 'X', y: 'Y' }); eq(opened.once, true);
});
check('invite: a wrong token or tampered envelope opens as null', async () => {
  const k = await IV.inviteKeys(INV_TOKEN);
  const other = await IV.inviteKeys(IV.newInviteToken());
  const sealed = await IV.sealInvite(k.aes, invBody());
  eq(await IV.openInvite(other.aes, sealed), null);
  const env = JSON.parse(sealed);
  const ct = Buffer.from(env.ct, 'base64url'); ct[3] ^= 1;
  eq(await IV.openInvite(k.aes, JSON.stringify({ ...env, ct: ct.toString('base64url') })), null);
  eq(await IV.openInvite(k.aes, '{}'), null);
  eq(await IV.openInvite(k.aes, 'not json'), null);
  eq(await IV.openInvite(k.aes, null), null);
});
check('invite: an expired or malformed body opens as null', async () => {
  const k = await IV.inviteKeys(INV_TOKEN);
  for (const over of [{ exp: Math.floor(Date.now() / 1000) - 5 }, { kv: 3 }, { room: '' }, { room: 'x'.repeat(65) }, { key: 'AAEC' }, { key: Buffer.alloc(31).toString('base64url') }, { v: 2 }]) {
    eq(await IV.openInvite(k.aes, await IV.sealInvite(k.aes, invBody(over))), null);
  }
});
check('invite: the envelope expires in 24 hours and the deletion names it', () => {
  const t = IV.envelopeTemplate('topic', 'c', 1000);
  deepEq(t, { kind: 3838, created_at: 1000, tags: [['x', 'topic'], ['expiration', String(1000 + 86400)]], content: 'c' });
  deepEq(IV.deletionTemplate('ev1', 2000), { kind: 5, created_at: 2000, tags: [['e', 'ev1'], ['k', '3838']], content: '' });
});
check('invite: a slow first socket still finds the envelope', async () => {
  const k = await IV.inviteKeys(INV_TOKEN);
  const content = await IV.sealInvite(k.aes, invBody());
  const silent = new FakeSock(null);
  const slow = new FakeSock((ws, sub) => setTimeout(() => ws.emit(['EVENT', sub, { id: 'ev9', content }]), 40));
  const t0 = Date.now();
  const got = await IV.fetchInvite([silent, slow], k.topic, k.aes, { timeoutMs: 600, retryMs: 60 });
  ok(got && got.evId === 'ev9' && got.body.room === 'trip');
  ok(Date.now() - t0 < 400);
  ok(silent.sent.some((s) => JSON.parse(s)[0] === 'CLOSE'));
});
check('invite: nothing found resolves null after the relays say so', async () => {
  const k = await IV.inviteKeys(INV_TOKEN);
  const empty = () => new FakeSock((ws, sub) => setTimeout(() => ws.emit(['EOSE', sub]), 5));
  const t0 = Date.now();
  eq(await IV.fetchInvite([empty(), empty()], k.topic, k.aes, { timeoutMs: 5000, retryMs: 3000 }), null);
  ok(Date.now() - t0 < 1500);
  eq(await IV.fetchInvite([new FakeSock(null)], k.topic, k.aes, { timeoutMs: 80, retryMs: 40 }), null);
  eq(await IV.fetchInvite([], k.topic, k.aes), null);
});
check('invite: junk events under the topic are skipped', async () => {
  const k = await IV.inviteKeys(INV_TOKEN);
  const content = await IV.sealInvite(k.aes, invBody());
  const s = new FakeSock((ws, sub) => { ws.emit(['EVENT', sub, { id: 'junk', content: 'garbage' }]); setTimeout(() => ws.emit(['EVENT', sub, { id: 'good', content }]), 10); });
  eq((await IV.fetchInvite([s], k.topic, k.aes, { timeoutMs: 500 })).evId, 'good');
});
check('members: two signers on one invite are a double use', () => {
  const e = { room: 'r' };
  eq(MB.noteJoined(e, { k: 'joined', inv: 'i1', name: 'B', jid: 'j1' }, 'fpB').twice, null);
  deepEq(MB.noteJoined(e, { k: 'joined', inv: 'i1', name: 'C', jid: 'j2' }, 'fpC').twice, ['B', 'C']);
  deepEq(MB.noteJoined(e, { k: 'joined', inv: 'i1', name: 'C', jid: 'j2' }, 'fpC').twice, ['B', 'C']);
});
check('members: the same signer twice is not a double use', () => {
  const e = { room: 'r' };
  MB.noteJoined(e, { inv: 'i1', name: 'B', jid: 'j1' }, 'fpB');
  eq(MB.noteJoined(e, { inv: 'i1', name: 'B phone', jid: 'j9' }, 'fpB').twice, null);
});
check('members: two guests are told apart by jid', () => {
  const e = { room: 'r' };
  MB.noteJoined(e, { inv: 'i1', name: 'G1', jid: 'a' }, null);
  deepEq(MB.noteJoined(e, { inv: 'i1', name: 'G2', jid: 'b' }, null).twice, ['G1', 'G2']);
  eq(MB.noteJoined(e, { inv: 'i2', name: 'x' }, null).twice, null);
  eq(MB.noteJoined(e, { name: 'x', jid: 'c' }, 'fp').twice, null);
});
check('members: members are kept newest first, at most 50, without me', () => {
  const e = { room: 'r' };
  for (let i = 0; i < 55; i++) MB.noteMember(e, { sigFp: 'fp' + i, name: 'N' + String(i).padStart(2, '0'), pub: { x: 'x' + i, y: 'y' }, ts: i });
  eq(Object.keys(e.members).length, 50);
  ok(!e.members.fp0 && !!e.members.fp54);
  const list = MB.membersOf(e, 'fp54');
  eq(list.length, 49);
  eq(list[0].name, 'N05');
  deepEq(list[0].pub, { x: 'x5', y: 'y' });
});
check('members: a rekey from a member of the room is accepted', () => {
  const e = { room: 'r' };
  MB.noteMember(e, { sigFp: 'fpA', name: 'A', ts: 1 });
  eq(MB.acceptRekey(e, { kind: 'room-rekey', room: 'r', key: RK, kv: 2 }, 'fpA'), true);
});
check('members: a rekey from a non-member or for an unknown room is refused', () => {
  const e = { room: 'r' };
  MB.noteMember(e, { sigFp: 'fpA', name: 'A', ts: 1 });
  const good = { kind: 'room-rekey', room: 'r', key: RK, kv: 2 };
  eq(MB.acceptRekey(e, good, 'fpZ'), false);
  eq(MB.acceptRekey(e, good, null), false);
  eq(MB.acceptRekey(null, good, 'fpA'), false);
  eq(MB.acceptRekey(e, { ...good, room: 'other' }, 'fpA'), false);
  eq(MB.acceptRekey(e, { ...good, key: 'AAEC' }, 'fpA'), false);
  eq(MB.acceptRekey(e, { ...good, kv: 1 }, 'fpA'), false);
  eq(MB.acceptRekey(e, { ...good, kind: 'room-invite' }, 'fpA'), false);
});

check('home: room invites sit with requests at the top', () => {
  const rows = H.homeRows({ requests: [{ fp: 'f1', name: 'Req' }], roomInvites: [{ room: 'r9', label: 'Trip', name: 'Alice', key: 'k' }], contacts: [{ fp: 'c1', name: 'Zed' }], rooms: [{ room: 'r1', label: 'One' }], threads: [] });
  deepEq(rows.slice(0, 2).map((r) => r.kind), ['request', 'invite']);
  eq(rows[1].key, 'inv:r9');
  eq(rows[1].title, 'Trip');
  eq(H.homeRows({ roomInvites: [{ room: 'r9', label: 'Trip' }] }, { filter: 'ai' }).length, 0);
  eq(H.homeRows({ roomInvites: [{ room: 'r9', label: 'Trip' }] }, { filter: 'people' }).length, 1);
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
