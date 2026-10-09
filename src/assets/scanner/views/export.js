import { h, t, toast, overlay, downloadBlob, canShareFiles, shareFiles } from '../ui.js';
import { loadBitmap, PRESETS } from '../pages.js';
import { render } from '../warp.js';
import { buildPdf } from '../pdf.js';
import { zipStore, safeName } from '../zip.js';

const KEY = 'mentria.scanner.export';
const DEFAULTS = { format: 'pdf', size: 'fit', quality: 'balanced' };

function readPrefs() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { return Object.assign({}, DEFAULTS); }
}

function writePrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) {}
}

function seg(legend, options, value, onPick) {
  const buttons = options.map(([v, label]) => h('button', {
    type: 'button',
    'aria-pressed': String(v === value),
    onclick: () => {
      buttons.forEach((b, k) => b.setAttribute('aria-pressed', String(options[k][0] === v)));
      onPick(v);
    }
  }, label));
  return h('fieldset', { class: 'sc-field' }, h('legend', {}, legend), h('div', { class: 'sc-seg' }, buttons));
}

export function openExport({ doc, pages }) {
  const prefs = readPrefs();
  let busy = false;
  let ready = null;
  const progress = h('p', { class: 'sc-sheet__progress', role: 'status' });
  const formatField = seg(t('export.format'), [['pdf', t('export.pdf')], ['jpg', t('export.jpg')], ['png', t('export.png')]], prefs.format, (v) => { prefs.format = v; changed(); });
  const sizeField = seg(t('export.page_size'), [['fit', t('export.size_fit')], ['a4', t('export.size_a4')], ['letter', t('export.size_letter')]], prefs.size, (v) => { prefs.size = v; changed(); });
  const qualityField = seg(t('export.quality'), [['high', t('export.q_high')], ['balanced', t('export.q_balanced')], ['small', t('export.q_small')]], prefs.quality, (v) => { prefs.quality = v; changed(); });
  const probe = [new File([new Uint8Array(1)], 'scan.pdf', { type: 'application/pdf' })];
  const shareBtn = h('button', { class: 'sc-btn', type: 'button', hidden: !canShareFiles(probe), onclick: () => share() }, t('export.share'));
  const downloadBtn = h('button', { class: 'sc-btn sc-btn--primary', type: 'button', onclick: () => download() }, t('export.download'));
  const cancelBtn = h('button', { class: 'sc-btn', type: 'button', onclick: () => close() }, t('export.cancel'));
  const o = overlay([
    h('h2', { class: 'sc-sheet__title' }, t('export.title')),
    formatField, sizeField, qualityField, progress,
    h('div', { class: 'sc-sheet__actions' }, cancelBtn, shareBtn, downloadBtn)
  ], () => close());
  o.panel.setAttribute('aria-label', t('export.title'));
  sync();
  downloadBtn.focus();

  function sync() {
    sizeField.hidden = prefs.format !== 'pdf';
    qualityField.hidden = prefs.format === 'png';
  }

  function changed() {
    writePrefs(prefs);
    ready = null;
    shareBtn.textContent = t('export.share');
    progress.textContent = '';
    sync();
  }

  function close() {
    if (!busy) o.close();
  }

  function setBusy(on) {
    busy = on;
    [shareBtn, downloadBtn, cancelBtn].forEach((b) => { b.disabled = on; });
  }

  async function build() {
    const fmt = prefs.format;
    const preset = PRESETS[fmt === 'png' ? 'high' : prefs.quality];
    const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
    const outs = [];
    for (let i = 0; i < pages.length; i++) {
      progress.textContent = t('export.working', { n: i + 1, total: pages.length });
      const p = pages[i];
      const bmp = await loadBitmap(p);
      try {
        outs.push(await render(bmp, p.quad, { rotation: p.rotation, filter: p.filter, maxSide: preset.max, mime, quality: preset.q }));
      } finally {
        bmp.close();
      }
    }
    progress.textContent = '';
    const base = safeName(doc.name);
    if (fmt === 'pdf') {
      const list = [];
      for (const r of outs) list.push({ jpeg: new Uint8Array(await r.blob.arrayBuffer()), width: r.width, height: r.height });
      return [new File([buildPdf(list, { pageSize: prefs.size, title: doc.name })], base + '.pdf', { type: 'application/pdf' })];
    }
    const ext = fmt === 'png' ? '.png' : '.jpg';
    if (outs.length === 1) return [new File([outs[0].blob], base + ext, { type: mime })];
    return outs.map((r, i) => new File([r.blob], base + ' - ' + String(i + 1).padStart(2, '0') + ext, { type: mime }));
  }

  async function zipOf(files) {
    const list = [];
    for (const f of files) list.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    return new File([zipStore(list)], safeName(doc.name) + '.zip', { type: 'application/zip' });
  }

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const files = ready || (await build());
      const out = files.length > 1 ? await zipOf(files) : files[0];
      downloadBlob(out.name, out);
      toast(t('export.done', { name: out.name }));
      setBusy(false);
      o.close();
    } catch (e) {
      progress.textContent = t('export.failed', { msg: (e && e.message) || String(e) });
      setBusy(false);
    }
  }

  async function shareReady() {
    const files = canShareFiles(ready) ? ready : [await zipOf(ready)];
    const r = await shareFiles(files, doc.name);
    if (r === 'shared') {
      toast(t('export.shared'));
      o.close();
    } else if (r === 'failed') {
      shareBtn.textContent = t('export.share_ready');
    }
  }

  async function share() {
    if (busy) return;
    if (ready) { await shareReady(); return; }
    setBusy(true);
    const started = performance.now();
    try {
      ready = await build();
      setBusy(false);
      if (performance.now() - started < 800) await shareReady();
      else shareBtn.textContent = t('export.share_ready');
    } catch (e) {
      progress.textContent = t('export.failed', { msg: (e && e.message) || String(e) });
      setBusy(false);
    }
  }
}
