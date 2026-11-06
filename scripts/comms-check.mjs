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

const FIX = {
  key: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  topic: '6KIivZnJHh7w2Gas0N2XB9wOaCMAbsbyBJtQgSg2Sbg',
  enc: { v: 1, iv: 'Cq2ez/1WmnLvosqO', ct: 'Y3v63BU027prfBC19//lBA9ZvrEECRBR0a4TegW+2R8=' },
  pack: '{"v":2,"t":"hi","sfp":"A","sfp2":"B"}'
};

check('wire: topic is unchanged', async () => eq(await W.chatTopicFor('mentria-test-room', FIX.key), FIX.topic));
check('wire: golden ciphertext still opens', async () => eq(await W.decryptText(await W.deriveKey(FIX.key), FIX.enc), 'golden plaintext'));
check('wire: pack keeps both fingerprints', () => { const s = W.packChatPlain('hi', { fp: 'B', legacyFp: 'A' }); eq(s, FIX.pack); deepEq(JSON.parse(s), { v: 2, t: 'hi', sfp: 'A', sfp2: 'B' }); });
check('wire: pack drops a repeated fingerprint', () => deepEq(JSON.parse(W.packChatPlain('hi', { fp: 'A', legacyFp: 'A' })), { v: 2, t: 'hi', sfp: 'A' }));
check('wire: unpack reads what pack wrote', () => eq(W.unpackChatPlain(W.packChatPlain('hi', { fp: 'B', legacyFp: 'A' })).text, 'hi'));
check('wire: invite links are not rooms', () => eq(W.parseHash('#:i1.abc').room, null));
check('wire: a room link survives format and parse', () => eq(W.parseHash(W.formatHash('r1', 'k1')).room, 'r1'));

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
