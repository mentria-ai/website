(function (global) {
  'use strict';

  const MIME = { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png', avif: 'image/avif' };
  const FORMATS = ['jpeg', 'webp', 'png', 'avif'];
  const RESIZE_MODES = ['none', 'fit', 'percent'];
  const MAX_DIM = 30000;
  const DEFAULTS = { format: 'jpeg', quality: 80, resize: 'none', maxWidth: 1920, maxHeight: 1920, percent: 50 };
  const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png', 'image/avif': 'avif', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/heic': 'heic', 'image/heif': 'heif', 'image/svg+xml': 'svg', 'image/tiff': 'tif' };
  const LABELS = { jpeg: 'JPEG', jpg: 'JPEG', pjpeg: 'JPEG', webp: 'WebP', png: 'PNG', apng: 'PNG', avif: 'AVIF', gif: 'GIF', heic: 'HEIC', heif: 'HEIF', bmp: 'BMP', 'x-ms-bmp': 'BMP', 'svg+xml': 'SVG', svg: 'SVG', tiff: 'TIFF', tif: 'TIFF', 'x-icon': 'ICO', 'vnd.microsoft.icon': 'ICO', ico: 'ICO', jxl: 'JPEG XL' };
  const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'];
  const BMP_HEADERS = [12, 40, 52, 56, 64, 108, 124];
  const IMAGE_NAME = /\.(jpe?g|jfif|pjpeg|png|apng|gif|webp|avif|heic|heif|bmp|dib|svg|tiff?|ico|jxl)$/i;
  const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;
  const UNITS = ['kilobyte', 'megabyte', 'gigabyte'];
  const formatters = new Map();

  function numberFormat(lang, opts) {
    const key = lang + '|' + JSON.stringify(opts);
    let f = formatters.get(key);
    if (!f) {
      try { f = new Intl.NumberFormat(lang, opts); } catch (_) { f = new Intl.NumberFormat('en', opts); }
      formatters.set(key, f);
    }
    return f;
  }

  function formatBytes(bytes, lang) {
    const n = Math.max(0, Math.round(Number(bytes) || 0));
    if (n < 1000) return numberFormat(lang, { style: 'unit', unit: 'byte', unitDisplay: 'long' }).format(n);
    let v = n / 1000;
    let i = 0;
    while (i < UNITS.length - 1 && v >= 999.5) { v /= 1000; i += 1; }
    return numberFormat(lang, { style: 'unit', unit: UNITS[i], unitDisplay: 'short', maximumFractionDigits: v < 100 ? 1 : 0 }).format(v);
  }

  function formatPercent(fraction, lang) {
    let v = Math.abs(Number(fraction) || 0);
    if (v > 0 && v < 0.001) v = 0.001;
    return numberFormat(lang, { style: 'percent', maximumFractionDigits: v < 0.1 ? 1 : 0 }).format(v);
  }

  function formatMegapixels(pixels, lang) {
    return numberFormat(lang, { maximumFractionDigits: 1 }).format((Number(pixels) || 0) / 1e6);
  }

  function formatDims(w, h) {
    return w + ' × ' + h;
  }

  function formatLabel(kind) {
    const key = String(kind || '').toLowerCase().replace(/^image\//, '');
    return LABELS[key] || key.toUpperCase();
  }

  function savedFraction(before, after) {
    const b = Number(before) || 0;
    return b > 0 ? (b - (Number(after) || 0)) / b : 0;
  }

  function changeKind(before, after) {
    const b = Number(before) || 0;
    const a = Number(after) || 0;
    if (a < b) return 'smaller';
    if (a > b) return 'larger';
    return 'same';
  }

  function pluralKey(n, lang) {
    let cat = 'other';
    try { cat = new Intl.PluralRules(lang).select(n); } catch (_) { cat = n === 1 ? 'one' : 'other'; }
    return cat === 'one' ? 'one' : 'other';
  }

  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match));
  }

  function toDim(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(n, MAX_DIM);
  }

  function clampPercent(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(n, 100);
  }

  function clampQuality(value) {
    if (value === null || value === undefined || value === '') return DEFAULTS.quality;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return DEFAULTS.quality;
    return Math.min(100, Math.max(1, n));
  }

  function normalizeSettings(raw) {
    const s = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') return s;
    if (FORMATS.indexOf(raw.format) !== -1) s.format = raw.format;
    if (raw.quality !== undefined && raw.quality !== null) s.quality = clampQuality(raw.quality);
    if (RESIZE_MODES.indexOf(raw.resize) !== -1) s.resize = raw.resize;
    if (Object.prototype.hasOwnProperty.call(raw, 'maxWidth')) s.maxWidth = toDim(raw.maxWidth);
    if (Object.prototype.hasOwnProperty.call(raw, 'maxHeight')) s.maxHeight = toDim(raw.maxHeight);
    const p = clampPercent(raw.percent);
    if (p !== null) s.percent = p;
    return s;
  }

  function targetSize(width, height, s) {
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    const mode = s ? s.resize : 'none';
    if (mode === 'percent') {
      const p = clampPercent(s.percent);
      if (p === null || p >= 100) return { w, h };
      return { w: Math.max(1, Math.round(w * p / 100)), h: Math.max(1, Math.round(h * p / 100)) };
    }
    if (mode === 'fit') {
      const mw = toDim(s.maxWidth);
      const mh = toDim(s.maxHeight);
      const rw = mw === null ? Infinity : mw / w;
      const rh = mh === null ? Infinity : mh / h;
      if (!(Math.min(rw, rh) < 1)) return { w, h };
      if (rw <= rh) return { w: mw, h: Math.max(1, Math.min(h, Math.round(h * mw / w))) };
      return { w: Math.max(1, Math.min(w, Math.round(w * mh / h))), h: mh };
    }
    return { w, h };
  }

  function signature(s) {
    const parts = [s.format, s.format === 'png' ? '' : String(clampQuality(s.quality)), s.resize];
    if (s.resize === 'fit') parts.push(String(toDim(s.maxWidth)) + 'x' + String(toDim(s.maxHeight)));
    if (s.resize === 'percent') parts.push(String(clampPercent(s.percent)));
    return parts.join('|');
  }

  function baseName(name) {
    let s = String(name === null || name === undefined ? '' : name).replace(BAD_CHARS, '-').trim();
    const dot = s.lastIndexOf('.');
    if (dot > 0) s = s.slice(0, dot);
    s = s.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
    const chars = Array.from(s);
    if (chars.length > 120) s = chars.slice(0, 120).join('').replace(/[\s.]+$/, '');
    return s || 'image';
  }

  function uniqueBase(base, taken) {
    if (!taken.has(base)) return base;
    let k = 2;
    while (taken.has(base + '-' + k)) k += 1;
    return base + '-' + k;
  }

  function extFor(type) {
    const t = String(type || '').toLowerCase();
    if (EXT[t]) return EXT[t];
    const sub = t.indexOf('image/') === 0 ? t.slice(6).replace(/[^a-z0-9]+/g, '') : '';
    return sub || 'img';
  }

  function outputName(base, type) {
    return base + '-compressed.' + extFor(type);
  }

  function originalName(name, base, type) {
    const n = String(name === null || name === undefined ? '' : name).trim();
    return n || base + '.' + extFor(type);
  }

  function isImageLike(type, name) {
    return /^image\//i.test(String(type || '')) || IMAGE_NAME.test(String(name || ''));
  }

  function isHeic(kind, type, name) {
    return kind === 'heic' || kind === 'heif' || /^image\/hei[cf]/i.test(String(type || '')) || /\.hei[cf]$/i.test(String(name || ''));
  }

  function preferOriginal(c) {
    return c.after > c.before && c.sameDims === true && c.sameType === true;
  }

  function u16be(b, i) { return (b[i] << 8) | b[i + 1]; }
  function u16le(b, i) { return b[i] | (b[i + 1] << 8); }
  function u24le(b, i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16); }
  function u32be(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
  function u32le(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; }

  function ascii(b, i, n) {
    let s = '';
    for (let k = 0; k < n && i + k < b.length; k += 1) s += String.fromCharCode(b[i + k]);
    return s;
  }

  function info(type, width, height) {
    return width > 0 && height > 0 ? { type, width, height } : { type, width: 0, height: 0 };
  }

  function jpegInfo(b) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xFF) return info('jpeg', 0, 0);
      const m = b[i + 1];
      if (m === 0xFF) { i += 1; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m === 0xD9 || m === 0xDA) return info('jpeg', 0, 0);
      const len = u16be(b, i + 2);
      if (len < 2) return info('jpeg', 0, 0);
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        if (i + 8 >= b.length) return info('jpeg', 0, 0);
        return info('jpeg', u16be(b, i + 7), u16be(b, i + 5));
      }
      i += 2 + len;
    }
    return info('jpeg', 0, 0);
  }

  function webpInfo(b) {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9D && b[24] === 0x01 && b[25] === 0x2A) {
      return info('webp', u16le(b, 26) & 0x3FFF, u16le(b, 28) & 0x3FFF);
    }
    if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2F) {
      const bits = u32le(b, 21);
      return info('webp', (bits & 0x3FFF) + 1, ((bits >>> 14) & 0x3FFF) + 1);
    }
    if (chunk === 'VP8X' && b.length >= 30) return info('webp', u24le(b, 24) + 1, u24le(b, 27) + 1);
    return info('webp', 0, 0);
  }

  function bmpInfo(b) {
    const header = u32le(b, 14);
    if (BMP_HEADERS.indexOf(header) === -1) return info(null, 0, 0);
    if (header === 12) return info('bmp', u16le(b, 18), u16le(b, 20));
    return info('bmp', Math.abs(u32le(b, 18) | 0), Math.abs(u32le(b, 22) | 0));
  }

  function isoInfo(b) {
    const boxSize = u32be(b, 0);
    const end = Math.min(b.length, boxSize >= 16 ? boxSize : 16);
    const brands = [ascii(b, 8, 4)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, 4));
    let type = null;
    if (brands.indexOf('avif') !== -1 || brands.indexOf('avis') !== -1) type = 'avif';
    else if (brands.some((x) => HEIF_BRANDS.indexOf(x) !== -1)) type = 'heic';
    else if (brands.indexOf('mif1') !== -1 || brands.indexOf('msf1') !== -1) type = 'heif';
    if (!type) return info(null, 0, 0);
    let bw = 0;
    let bh = 0;
    const limit = Math.min(b.length - 16, 1 << 19);
    for (let i = 4; i <= limit; i += 1) {
      if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65 && u32be(b, i - 4) === 20) {
        const w = u32be(b, i + 8);
        const h = u32be(b, i + 12);
        if (w * h > bw * bh) { bw = w; bh = h; }
      }
    }
    return info(type, bw, bh);
  }

  function sniffImage(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    if (b.length >= 4 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return jpegInfo(b);
    if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
      return ascii(b, 12, 4) === 'IHDR' ? info('png', u32be(b, 16), u32be(b, 20)) : info('png', 0, 0);
    }
    if (b.length >= 10 && ascii(b, 0, 4) === 'GIF8') return info('gif', u16le(b, 6), u16le(b, 8));
    if (b.length >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webpInfo(b);
    if (b.length >= 26 && ascii(b, 0, 2) === 'BM') return bmpInfo(b);
    if (b.length >= 16 && ascii(b, 4, 4) === 'ftyp') return isoInfo(b);
    return info(null, 0, 0);
  }

  const PROBE_TIMEOUT_MS = 1500;
  const SNIFF_BYTES = 65536;
  const PREVIEW_SIDE = 320;
  const PREVIEW_BYTES = 12288;
  const STANDARD_SIDE = 1600;
  const STANDARD_QUALITY = 0.8;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function toBlob(canvas, mime, quality) {
    return new Promise((resolve) => {
      try { canvas.toBlob((blob) => resolve(blob), mime, quality); } catch (_) { resolve(null); }
    });
  }

  function wrapBitmap(bitmap) {
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => { try { bitmap.close(); } catch (_) {} }
    };
  }

  function decodeWithImage(file) {
    return new Promise((resolve) => {
      let url = '';
      try { url = URL.createObjectURL(file); } catch (_) { resolve(null); return; }
      const img = new Image();
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(value);
      };
      img.addEventListener('load', () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) { finish(null); return; }
        finish({ source: img, width: w, height: h, close: () => { img.removeAttribute('src'); } });
      });
      img.addEventListener('error', () => finish(null));
      img.decoding = 'async';
      img.src = url;
    });
  }

  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try { return wrapBitmap(await createImageBitmap(file, { imageOrientation: 'from-image' })); } catch (_) {}
      try { return wrapBitmap(await createImageBitmap(file)); } catch (_) {}
    }
    return decodeWithImage(file);
  }

  function probeEncode(mime) {
    const attempt = new Promise((resolve) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.fillRect(0, 0, 1, 1);
        canvas.toBlob((blob) => resolve(!!blob && blob.type === mime), mime, 0.8);
      } catch (_) {
        resolve(false);
      }
    });
    return Promise.race([attempt, wait(PROBE_TIMEOUT_MS).then(() => false)]);
  }

  function jpegOrientation(b) {
    if (!(b.length > 4 && b[0] === 0xFF && b[1] === 0xD8)) return 1;
    let i = 2;
    while (i + 4 < b.length) {
      if (b[i] !== 0xFF) return 1;
      const m = b[i + 1];
      if (m === 0xDA || m === 0xD9) return 1;
      const len = u16be(b, i + 2);
      if (m === 0xE1 && ascii(b, i + 4, 4) === 'Exif') {
        const t = i + 10;
        const le = b[t] === 0x49;
        const r16 = (k) => (le ? u16le(b, k) : u16be(b, k));
        const r32 = (k) => (le ? u32le(b, k) : u32be(b, k));
        const ifd = t + r32(t + 4);
        if (ifd + 2 > b.length) return 1;
        const n = r16(ifd);
        for (let e = 0; e < n; e += 1) {
          const p = ifd + 2 + e * 12;
          if (p + 12 > b.length) return 1;
          if (r16(p) === 0x0112) {
            const v = r16(p + 8);
            return v >= 1 && v <= 8 ? v : 1;
          }
        }
        return 1;
      }
      i += 2 + len;
    }
    return 1;
  }

  function naturalSizeOf(file) {
    return new Promise((resolve) => {
      let url = '';
      try { url = URL.createObjectURL(file); } catch (_) { resolve(null); return; }
      const img = new Image();
      const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
      img.onload = () => done(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight, type: null } : null);
      img.onerror = () => done(null);
      img.src = url;
    });
  }

  async function headInfo(file) {
    let head = null;
    try { head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()); } catch (_) {}
    const found = head ? sniffImage(head) : info(null, 0, 0);
    if (found.width && found.height) {
      const turned = found.type === 'jpeg' && jpegOrientation(head) >= 5;
      return turned ? { w: found.height, h: found.width, type: found.type } : { w: found.width, h: found.height, type: found.type };
    }
    const seen = await naturalSizeOf(file);
    return seen ? { w: seen.w, h: seen.h, type: found.type } : null;
  }

  async function decodeAt(file, maxSide) {
    const max = Math.max(1, Math.round(Number(maxSide) || 1));
    const size = await headInfo(file).catch(() => null);
    if (!size || typeof createImageBitmap !== 'function') return null;
    if (Math.max(size.w, size.h) > max) {
      const opts = { resizeQuality: 'high', imageOrientation: 'from-image' };
      if (size.w >= size.h) opts.resizeWidth = max;
      else opts.resizeHeight = max;
      try { return wrapBitmap(await createImageBitmap(file, opts)); } catch (_) {}
      delete opts.imageOrientation;
      try { return wrapBitmap(await createImageBitmap(file, opts)); } catch (_) {}
      return null;
    }
    try { return wrapBitmap(await createImageBitmap(file, { imageOrientation: 'from-image' })); } catch (_) {}
    try { return wrapBitmap(await createImageBitmap(file)); } catch (_) {}
    return null;
  }

  async function renderJpeg(src, maxSide, quality) {
    if (!src) return null;
    const size = targetSize(src.width, src.height, { resize: 'fit', maxWidth: maxSide, maxHeight: maxSide });
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.source, 0, 0, size.w, size.h);
    const blob = await toBlob(canvas, 'image/jpeg', quality);
    canvas.width = 0;
    canvas.height = 0;
    return blob && blob.size ? { blob, w: size.w, h: size.h } : null;
  }

  async function preview(file) {
    const src = await decodeAt(file, PREVIEW_SIDE);
    if (!src) return null;
    try {
      let best = null;
      for (let q = 7; q >= 3; q -= 1) {
        const r = await renderJpeg(src, PREVIEW_SIDE, q / 10);
        if (!r) break;
        if (!best || r.blob.size < best.blob.size) best = r;
        if (r.blob.size <= PREVIEW_BYTES) return r;
      }
      return best;
    } finally {
      src.close();
    }
  }

  async function standard(file) {
    const size = await headInfo(file).catch(() => null);
    if (size && size.type === 'jpeg' && Math.max(size.w, size.h) <= STANDARD_SIDE) return null;
    const src = await decodeAt(file, STANDARD_SIDE);
    if (!src) return null;
    try {
      return await renderJpeg(src, STANDARD_SIDE, STANDARD_QUALITY);
    } finally {
      src.close();
    }
  }

  global.MentriaImage = {
    MIME, FORMATS, DEFAULTS,
    formatBytes, formatPercent, formatMegapixels, formatDims, formatLabel,
    savedFraction, changeKind, pluralKey, fill,
    toDim, clampPercent, clampQuality, normalizeSettings, targetSize, signature,
    baseName, uniqueBase, outputName, originalName, isImageLike, isHeic, preferOriginal,
    sniffImage,
    toBlob, decodeImage, probeEncode,
    decodeAt, renderJpeg, preview, standard
  };
})(typeof window !== 'undefined' ? window : globalThis);
