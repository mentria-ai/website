import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..', 'src/assets/js/mentria-image.js');

const makeWindow = () => {
  const win = { console, Blob, File, Uint8Array, ArrayBuffer, Promise, Math, Number, String, Object, Array, Map, Intl, setTimeout, clearTimeout, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} } };
  win.window = win;
  win.globalThis = win;
  win.document = { createElement: () => { throw new Error('no canvas stub'); } };
  return win;
};

let I = null;
let win = null;
const load = () => {
  win = makeWindow();
  vm.createContext(win);
  vm.runInContext(readFileSync(SRC, 'utf8'), win, { filename: 'mentria-image.js' });
  I = win.MentriaImage;
  if (!I) throw new Error('MentriaImage not set');
};

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const pngHeader = (w, h) => new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(w), ...u32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0]);
const fakeFile = (head, type = 'image/png', name = 'a.png') => new File([head, new Uint8Array(1024)], name, { type });

const fakeBitmaps = () => {
  const calls = [];
  win.createImageBitmap = async (file, opts) => {
    calls.push({ file, opts: opts || null });
    const width = opts && opts.resizeWidth ? opts.resizeWidth : 100;
    const height = opts && opts.resizeHeight ? opts.resizeHeight : 75;
    return { width, height, close() {} };
  };
  return calls;
};

const fakeCanvas = (sizes) => {
  const log = { qualities: [] };
  let n = 0;
  win.document.createElement = (tag) => {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    return {
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(v) {}, set imageSmoothingEnabled(v) {}, set imageSmoothingQuality(v) {} }),
      toBlob(cb, mime, q) { log.qualities.push(q); const size = sizes[Math.min(n, sizes.length - 1)]; n += 1; cb(new Blob([new Uint8Array(size)], { type: mime })); }
    };
  };
  return log;
};

let pass = 0, fail = 0;
const results = [];
const check = (name, fn) => results.push([name, fn]);

check('image: helpers keep their names', () => { for (const k of ['MIME','FORMATS','DEFAULTS','formatBytes','formatPercent','formatMegapixels','formatDims','formatLabel','savedFraction','changeKind','pluralKey','fill','toDim','clampPercent','clampQuality','normalizeSettings','targetSize','signature','baseName','uniqueBase','outputName','originalName','isImageLike','isHeic','preferOriginal','sniffImage','toBlob','decodeImage','probeEncode','decodeAt','renderJpeg','preview','standard']) assert.ok(k in I, k); });
check('image: targetSize keeps the aspect ratio', () => assert.deepEqual({ ...I.targetSize(4000, 3000, I.normalizeSettings({ resize: 'fit', maxWidth: 1600, maxHeight: 1600 })) }, { w: 1600, h: 1200 }));
check('image: sniffImage reads a PNG header', () => assert.deepEqual([I.sniffImage(pngHeader(640, 480)).type, I.sniffImage(pngHeader(640, 480)).width], ['png', 640]));
check('image: decodeAt asks for the long side only', async () => { const calls = fakeBitmaps(); await I.decodeAt(fakeFile(pngHeader(4032, 3024)), 320); assert.deepEqual(calls[0].opts.resizeWidth, 320); assert.equal(calls[0].opts.resizeHeight, undefined); });
check('image: decodeAt never decodes full size', async () => { const calls = fakeBitmaps(); await I.decodeAt(fakeFile(pngHeader(3024, 4032)), 1600); assert.ok(calls.length > 0 && calls.every((c) => c.opts && (c.opts.resizeWidth || c.opts.resizeHeight))); });
check('image: preview steps quality down to fit 12 KB', async () => { fakeBitmaps(); const sizes = fakeCanvas([20000, 15000, 11000]); const r = await I.preview(fakeFile(pngHeader(1000, 800))); assert.equal(r.blob.size, 11000); assert.deepEqual(sizes.qualities, [0.7, 0.6, 0.5]); });

try { load(); } catch (e) { console.log('FAIL  load: ' + e.message); }
for (const [name, fn] of results) {
  try {
    if (!I) throw new Error('module not loaded');
    await fn();
    pass++;
    console.log('PASS  ' + name);
  } catch (e) {
    fail++;
    console.log('FAIL  ' + name + '  [' + String(e && e.message || e).split('\n')[0].slice(0, 200) + ']');
  }
}
console.log(fail ? `\nimage: ${fail} FAILED of ${pass + fail}` : `\nimage: ${pass}/${pass} passed`);
process.exit(fail ? 1 : 0);
