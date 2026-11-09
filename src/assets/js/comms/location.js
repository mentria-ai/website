const SMALL = 1 << 20;
const MAX_BOXES = 20000;
const MP4_BRANDS = ['qt  ', 'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'M4V ', 'M4VH', 'M4VP', 'avc1', '3gp4', '3gp5', '3gp6', 'MSNV', 'f4v '];
const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1', 'avif', 'avis'];
const QT_START = ['moov', 'mdat', 'wide', 'free', 'skip'];

class Bad extends Error {}

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const fourcc = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
const uN = (b, i, n) => {
  if (n === 0) return 0;
  if (n === 4) return u32(b, i);
  if (n === 8) return u32(b, i) * 4294967296 + u32(b, i + 4);
  throw new Bad();
};
const need = (b, i, n) => { if (i < 0 || i + n > b.length) throw new Bad(); };

const brandsOf = (head) => {
  const out = [];
  if (head.length < 12 || fourcc(head, 4) !== 'ftyp') return out;
  const end = Math.min(head.length, Math.max(16, u32(head, 0)));
  out.push(fourcc(head, 8));
  for (let i = 16; i + 4 <= end; i += 4) out.push(fourcc(head, i));
  return out;
};

export const kindOf = (file, head) => {
  const b = head instanceof Uint8Array ? head : new Uint8Array(head || 0);
  const name = String((file && file.name) || '').toLowerCase();
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
  if (b.length >= 12 && fourcc(b, 0) === 'RIFF' && fourcc(b, 8) === 'WEBP') return 'webp';
  const brands = brandsOf(b);
  if (brands.some((x) => HEIF_BRANDS.includes(x))) return 'heif';
  if (brands.some((x) => MP4_BRANDS.includes(x))) return 'mp4';
  if (brands.length && /\.(mov|mp4|m4v|3gp)$/.test(name)) return 'mp4';
  if (b.length >= 8 && QT_START.includes(fourcc(b, 4)) && /\.(mov|mp4|m4v)$/.test(name)) return 'mp4';
  return 'other';
};

const children = async (read, start, end) => {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    const h = await read(pos, 16);
    need(h, 0, 8);
    let size = u32(h, 0);
    const type = fourcc(h, 4);
    let hdr = 8;
    if (size === 1) {
      need(h, 8, 8);
      size = uN(h, 8, 8);
      hdr = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < hdr || pos + size > end) throw new Bad();
    out.push({ type, start: pos, end: pos + size, payload: pos + hdr });
    pos += size;
    if (out.length > MAX_BOXES) throw new Bad();
  }
  return out;
};

const readBox = async (read, b) => {
  const len = b.end - b.payload;
  if (len > SMALL) throw new Bad();
  const bytes = await read(b.payload, len);
  if (bytes.length !== len) throw new Bad();
  return bytes;
};

const isBoxAt = (b, i) => i + 8 <= b.length && u32(b, i) >= 8 && /^[A-Za-z0-9 ©]{4}$/.test(fourcc(b, i + 4));

const metaRanges = async (read, meta, ranges) => {
  const peek = await read(meta.payload, 16);
  const start = isBoxAt(peek, 0) ? meta.payload : meta.payload + 4;
  const kids = await children(read, start, meta.end);
  const names = [];
  for (const k of kids) {
    if (k.type !== 'keys') continue;
    const b = await readBox(read, k);
    need(b, 0, 8);
    const count = u32(b, 4);
    let i = 8;
    for (let n = 0; n < count; n += 1) {
      need(b, i, 8);
      const size = u32(b, i);
      if (size < 8) throw new Bad();
      need(b, i, size);
      names[n + 1] = String.fromCharCode(...b.subarray(i + 8, i + size));
      i += size;
    }
  }
  for (const k of kids) {
    if (k.type !== 'ilst') continue;
    for (const item of await children(read, k.payload, k.end)) {
      const head = await read(item.start, 8);
      const index = u32(head, 4);
      const name = names[index] || item.type;
      if (!(name === '©xyz' || /location/i.test(name))) continue;
      for (const d of await children(read, item.payload, item.end)) {
        if (d.type === 'data' && d.payload + 8 <= d.end) ranges.push({ start: d.payload + 8, end: d.end });
      }
    }
  }
};

const udtaRanges = async (read, udta, ranges) => {
  for (const k of await children(read, udta.payload, udta.end)) {
    if (k.type === '©xyz') {
      const h = await read(k.payload, 4);
      if (h.length < 4) continue;
      const len = u16(h, 0);
      const s = k.payload + 4;
      ranges.push({ start: s, end: Math.min(k.end, s + len) });
    } else if (k.type === 'loci') {
      if (k.payload + 4 < k.end) ranges.push({ start: k.payload + 4, end: k.end });
    } else if (k.type === 'meta') {
      await metaRanges(read, k, ranges);
    }
  }
};

const moovRanges = async (read, moov, ranges) => {
  for (const k of await children(read, moov.payload, moov.end)) {
    if (k.type === 'udta') await udtaRanges(read, k, ranges);
    else if (k.type === 'meta') await metaRanges(read, k, ranges);
    else if (k.type === 'trak') {
      for (const t of await children(read, k.payload, k.end)) {
        if (t.type === 'udta') await udtaRanges(read, t, ranges);
        else if (t.type === 'meta') await metaRanges(read, t, ranges);
      }
    }
  }
};

const mp4Ranges = async (read, size) => {
  const ranges = [];
  for (const b of await children(read, 0, size)) if (b.type === 'moov') await moovRanges(read, b, ranges);
  return ranges;
};

const cstring = (b, i) => {
  let j = i;
  while (j < b.length && b[j] !== 0) j += 1;
  if (j >= b.length) throw new Bad();
  return { text: String.fromCharCode(...b.subarray(i, j)), next: j + 1 };
};

const targetItems = async (read, iinf) => {
  const b = await readBox(read, iinf);
  need(b, 0, 4);
  const version = b[0];
  let i = 4;
  need(b, i, version === 0 ? 2 : 4);
  const count = version === 0 ? u16(b, i) : u32(b, i);
  i += version === 0 ? 2 : 4;
  const ids = new Set();
  for (let n = 0; n < count; n += 1) {
    need(b, i, 8);
    const size = u32(b, i);
    if (size < 12 || fourcc(b, i + 4) !== 'infe') throw new Bad();
    need(b, i, size);
    const e = b.subarray(i + 8, i + size);
    const v = e[0];
    if (v >= 2) {
      let j = 4;
      const id = v === 2 ? u16(e, j) : u32(e, j);
      j += v === 2 ? 2 : 4;
      j += 2;
      need(e, j, 4);
      const type = fourcc(e, j);
      j += 4;
      const name = cstring(e, j);
      if (type === 'Exif') ids.add(id);
      else if (type === 'mime') {
        const ct = cstring(e, name.next);
        if (/rdf\+xml|xmp/i.test(ct.text)) ids.add(id);
      }
    }
    i += size;
  }
  return ids;
};

const itemExtents = async (read, iloc, ids, idat) => {
  const b = await readBox(read, iloc);
  need(b, 0, 6);
  const version = b[0];
  const offSize = b[4] >> 4;
  const lenSize = b[4] & 15;
  const baseSize = b[5] >> 4;
  const indexSize = version >= 1 ? b[5] & 15 : 0;
  let i = 6;
  need(b, i, version < 2 ? 2 : 4);
  const count = version < 2 ? u16(b, i) : u32(b, i);
  i += version < 2 ? 2 : 4;
  const out = [];
  for (let n = 0; n < count; n += 1) {
    need(b, i, version < 2 ? 2 : 4);
    const id = version < 2 ? u16(b, i) : u32(b, i);
    i += version < 2 ? 2 : 4;
    let method = 0;
    if (version >= 1) {
      need(b, i, 2);
      method = u16(b, i) & 15;
      i += 2;
    }
    need(b, i, 2 + baseSize + 2);
    i += 2;
    const base = uN(b, i, baseSize);
    i += baseSize;
    const extents = u16(b, i);
    i += 2;
    for (let x = 0; x < extents; x += 1) {
      need(b, i, indexSize + offSize + lenSize);
      i += indexSize;
      const off = uN(b, i, offSize);
      i += offSize;
      const len = uN(b, i, lenSize);
      i += lenSize;
      if (!ids.has(id)) continue;
      if (method === 0) out.push({ start: base + off, end: base + off + len });
      else if (method === 1 && idat) out.push({ start: idat.payload + base + off, end: idat.payload + base + off + len });
      else throw new Bad();
    }
  }
  return out;
};

const heifRanges = async (read, size) => {
  const top = await children(read, 0, size);
  const meta = top.find((b) => b.type === 'meta');
  if (!meta) return [];
  const kids = await children(read, meta.payload + 4, meta.end);
  const iinf = kids.find((k) => k.type === 'iinf');
  const iloc = kids.find((k) => k.type === 'iloc');
  if (!iinf) return [];
  const ids = await targetItems(read, iinf);
  if (!ids.size) return [];
  if (!iloc) throw new Bad();
  const ranges = await itemExtents(read, iloc, ids, kids.find((k) => k.type === 'idat'));
  for (const r of ranges) if (r.start < 0 || r.end > size || r.end < r.start) throw new Bad();
  return ranges;
};

export const locationRanges = async (read, size, kind) => {
  try {
    if (kind === 'mp4') return { ok: true, ranges: await mp4Ranges(read, size) };
    if (kind === 'heif') return { ok: true, ranges: await heifRanges(read, size) };
  } catch (_) {
    return { ok: false, ranges: [] };
  }
  return { ok: false, ranges: [] };
};

export const blank = (bytes, offset, ranges) => {
  const end = offset + bytes.length;
  for (const r of ranges || []) {
    const s = Math.max(r.start, offset);
    const e = Math.min(r.end, end);
    if (s < e) bytes.fill(0, s - offset, e - offset);
  }
  return bytes;
};

const looksLikeMedia = (file) => (/^(image|video)\//i.test(String((file && file.type) || '')) && !/gif$/i.test(String(file.type))) || /\.(jpe?g|png|webp|heic|heif|avif|tiff?|mov|mp4|m4v|3gp|webm|mkv|avi)$/i.test(String((file && file.name) || ''));

export const forPeople = async (file) => {
  let head;
  try { head = new Uint8Array(await file.slice(0, 64).arrayBuffer()); } catch (_) { return { kept: looksLikeMedia(file) }; }
  const kind = kindOf(file, head);
  if (kind === 'jpeg' || kind === 'png' || kind === 'webp') {
    const strip = globalThis.MentriaMetaStrip;
    if (!strip || typeof strip.stripFile !== 'function') return { kept: true };
    try {
      const out = await strip.stripFile(file);
      return out ? { file: new File([out], file.name, { type: file.type || out.type, lastModified: file.lastModified }) } : { kept: true };
    } catch (_) {
      return { kept: true };
    }
  }
  if (kind === 'heif' || kind === 'mp4') {
    const read = async (s, n) => new Uint8Array(await file.slice(s, s + n).arrayBuffer());
    const r = await locationRanges(read, file.size, kind);
    return r.ok ? { ranges: r.ranges } : { kept: true };
  }
  return looksLikeMedia(file) ? { kept: true } : {};
};
