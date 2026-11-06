import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    openLinked: async (list) => { f.calls.openLinked++; if (linked && list.length) { f.open = true; return 0; } throw new Error('locked'); }
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
check('identity: secretCopy is a copy', () => { const f = fakeIdentity({ unlocked: true }); const s = I.secretCopy(); s[0] = 99; ok(f.secret[0] !== 99); });

check('render: a bare link stops before the comma', () => deepEq(C.findLinks('see https://example.com/a, ok').map((l) => l.href), ['https://example.com/a']));
check('render: www links get https', () => deepEq(C.findLinks('www.example.com').map((l) => l.href), ['https://www.example.com']));
check('render: balanced parentheses stay', () => deepEq(C.findLinks('(https://en.wikipedia.org/wiki/A_(b))').map((l) => l.href), ['https://en.wikipedia.org/wiki/A_(b)']));
check('render: only web and mail links', () => { ok(C.allowedHref('https://x.y')); ok(C.allowedHref('mailto:a@b.c')); no(C.allowedHref(' JavaScript:alert(1)')); no(C.allowedHref('tel:123')); no(C.allowedHref('/relative')); no(C.allowedHref('data:text/html,x')); });
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
