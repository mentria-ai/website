import * as db from './db.js';
import { render } from './warp.js';
import { fitPixels } from './geometry.js';
import { t, lang } from './ui.js';

export const MAX_PIXELS = 16e6;
export const THUMB = 360;
export const DISPLAY = 1600;
export const PRESETS = { high: { max: 3500, q: 0.9 }, balanced: { max: 2400, q: 0.82 }, small: { max: 1600, q: 0.7 } };
export const FILTERS = ['original', 'auto', 'gray', 'bw', 'whiteboard'];

export async function decodeFile(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) {}
  try { return await createImageBitmap(file); } catch (_) {}
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fitBitmap(bmp) {
  const f = fitPixels(bmp.width, bmp.height, MAX_PIXELS);
  if (f.width === bmp.width && f.height === bmp.height) return bmp;
  const out = await createImageBitmap(bmp, { resizeWidth: f.width, resizeHeight: f.height, resizeQuality: 'high' });
  bmp.close();
  return out;
}

export async function encodeBitmap(bmp, mime = 'image/jpeg', quality = 0.92) {
  if (typeof OffscreenCanvas === 'function') {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    return c.convertToBlob({ type: mime, quality });
  }
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), mime, quality));
}

export function defaultName(d = new Date()) {
  let date;
  try { date = new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(d); } catch (_) { date = d.toISOString().slice(0, 16).replace('T', ' '); }
  return t('doc.default_name', { date });
}

export function newDoc() {
  const now = Date.now();
  return { id: db.newId(), name: defaultName(), createdAt: now, updatedAt: now, pageIds: [] };
}

async function renderViews(page, bmp) {
  const base = { rotation: page.rotation, filter: page.filter };
  const thumb = await render(bmp, page.quad, Object.assign({ maxSide: THUMB, quality: 0.8 }, base));
  const disp = await render(bmp, page.quad, Object.assign({ maxSide: DISPLAY, quality: 0.86 }, base));
  page.thumb = thumb.blob;
  page.render = disp.blob;
  page.updatedAt = Date.now();
}

let persisted = false;
function persistOnce() {
  if (persisted) return;
  persisted = true;
  try {
    const S = window.parent && window.parent !== window ? window.parent.MentriaStore : null;
    if (S && typeof S.requestPersist === 'function') { S.requestPersist(); return; }
  } catch (_) {}
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}
}

export async function addPage(doc, bmp, quad, opts = {}) {
  const original = await encodeBitmap(bmp, 'image/jpeg', 0.92);
  const page = { id: db.newId(), docId: doc.id, original, width: bmp.width, height: bmp.height, quad: quad || null, rotation: 0, filter: opts.filter || 'auto', render: null, thumb: null, updatedAt: Date.now() };
  await renderViews(page, bmp);
  await db.savePage(page);
  if (opts.replace) {
    const i = doc.pageIds.indexOf(opts.replace);
    if (i >= 0) doc.pageIds[i] = page.id;
    else doc.pageIds.push(page.id);
    await db.deletePage(opts.replace);
  } else {
    doc.pageIds.push(page.id);
  }
  doc.updatedAt = Date.now();
  await db.saveDoc(doc);
  persistOnce();
  return page;
}

export function loadBitmap(page) {
  return createImageBitmap(page.original);
}

export async function updatePage(page, patch) {
  Object.assign(page, patch);
  const bmp = await loadBitmap(page);
  try { await renderViews(page, bmp); } finally { bmp.close(); }
  await db.savePage(page);
  return page;
}
