(function (global) {
  'use strict';

  function matchBytes(u8, off, str) {
    if (off + str.length > u8.length) return false;
    for (let i = 0; i < str.length; i++) {
      if (u8[off + i] !== str.charCodeAt(i)) return false;
    }
    return true;
  }

  function sniff(u8) {
    if (u8.length > 3 && u8[0] === 0xFF && u8[1] === 0xD8) return 'jpeg';
    if (u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'png';
    if (u8.length > 12 && matchBytes(u8, 0, 'RIFF') && matchBytes(u8, 8, 'WEBP')) return 'webp';
    return null;
  }

  function readOrientation(u8, tiff) {
    if (tiff + 8 > u8.length) return 0;
    const le = u8[tiff] === 0x49 && u8[tiff + 1] === 0x49;
    const be = u8[tiff] === 0x4D && u8[tiff + 1] === 0x4D;
    if (!le && !be) return 0;
    const u16 = (i) => (le ? (u8[i] | (u8[i + 1] << 8)) : ((u8[i] << 8) | u8[i + 1]));
    const u32 = (i) => (le
      ? (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16)) + u8[i + 3] * 16777216
      : u8[i] * 16777216 + ((u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]));
    const ifd = tiff + u32(tiff + 4);
    if (ifd + 2 > u8.length) return 0;
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > u8.length) break;
      if (u16(e) === 0x0112) {
        const v = u16(e + 8);
        return v >= 1 && v <= 8 ? v : 0;
      }
    }
    return 0;
  }

  function orientationSegment(v) {
    return new Uint8Array([
      0xFF, 0xE1, 0x00, 0x22,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00,
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, v, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00
    ]);
  }

  function jpegEnd(u8, sos) {
    let q = sos;
    while (q + 1 < u8.length && u8[q] === 0xFF) {
      const m = u8[q + 1];
      if (m === 0xFF) { q += 1; continue; }
      if (m === 0xD9) return q + 2;
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { q += 2; continue; }
      if (q + 4 > u8.length) break;
      const len = (u8[q + 2] << 8) | u8[q + 3];
      if (len < 2) break;
      q += 2 + len;
      if (m === 0xDA) {
        while (q + 1 < u8.length && !(u8[q] === 0xFF && u8[q + 1] !== 0x00 && !(u8[q + 1] >= 0xD0 && u8[q + 1] <= 0xD7))) q++;
      }
    }
    return u8.length;
  }

  function keepJpegSegment(u8, marker, dataOff) {
    if (marker === 0xE0 || marker === 0xEE) return true;
    if (marker === 0xE2) return matchBytes(u8, dataOff, 'ICC_PROFILE');
    return !(marker >= 0xE1 && marker <= 0xEF) && marker !== 0xFE;
  }

  function jpegKind(u8, marker, dataOff) {
    if (marker === 0xE1 && matchBytes(u8, dataOff, 'Exif')) return 'exif';
    if (marker === 0xE1 && matchBytes(u8, dataOff, 'http://ns.adobe.com/')) return 'xmp';
    if (marker === 0xED) return 'iptc';
    if (marker === 0xFE) return 'comment';
    return 'other';
  }

  function stripJpeg(buf) {
    const u8 = new Uint8Array(buf);
    const parts = [u8.subarray(0, 2)];
    const removed = new Set();
    let orientation = 0;
    let p = 2;
    while (p + 4 <= u8.length) {
      if (u8[p] !== 0xFF) break;
      const marker = u8[p + 1];
      if (marker === 0xFF) { p += 1; continue; }
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { parts.push(u8.subarray(p, p + 2)); p += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;
      const len = (u8[p + 2] << 8) | u8[p + 3];
      if (len < 2 || p + 2 + len > u8.length) break;
      const dataOff = p + 4;
      if (keepJpegSegment(u8, marker, dataOff)) {
        parts.push(u8.subarray(p, p + 2 + len));
      } else {
        const kind = jpegKind(u8, marker, dataOff);
        if (kind === 'exif' && !orientation) orientation = readOrientation(u8, dataOff + 6);
        removed.add(kind);
      }
      p += 2 + len;
    }
    const end = jpegEnd(u8, p);
    if (end < u8.length) removed.add('trailer');
    parts.push(u8.subarray(p, end));
    if (orientation > 1) {
      const at = parts[1] && parts[1][0] === 0xFF && parts[1][1] === 0xE0 ? 2 : 1;
      parts.splice(at, 0, orientationSegment(orientation));
    }
    return { blob: new Blob(parts, { type: 'image/jpeg' }), removed: Array.from(removed), orientation };
  }

  function stripPng(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    const parts = [u8.subarray(0, 8)];
    const removed = new Set();
    const DROP = { tEXt: 'text', zTXt: 'text', iTXt: 'text', eXIf: 'exif', tIME: 'time' };
    let p = 8;
    while (p + 8 <= u8.length) {
      const len = dv.getUint32(p, false);
      const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      if (p + 12 + len > u8.length) break;
      if (DROP[type]) removed.add(DROP[type]);
      else parts.push(u8.subarray(p, p + 12 + len));
      p += 12 + len;
      if (type === 'IEND') break;
    }
    if (p < u8.length) removed.add('trailer');
    return { blob: new Blob(parts, { type: 'image/png' }), removed: Array.from(removed), orientation: 0 };
  }

  function stripWebp(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    const parts = [];
    const removed = new Set();
    const limit = Math.min(u8.length, 8 + dv.getUint32(4, true));
    let p = 12;
    while (p + 8 <= limit) {
      const fourcc = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
      const len = dv.getUint32(p + 4, true);
      if (p + 8 + len > limit) break;
      const total = Math.min(8 + len + (len % 2), limit - p);
      if (fourcc === 'EXIF') removed.add('exif');
      else if (fourcc === 'XMP ') removed.add('xmp');
      else {
        const chunk = new Uint8Array(u8.subarray(p, p + total));
        if (fourcc === 'VP8X' && chunk.length >= 9) chunk[8] = chunk[8] & 0xF3;
        parts.push(chunk);
      }
      p += total;
    }
    if (limit < u8.length) removed.add('trailer');
    let bodyLen = 4;
    for (const c of parts) bodyLen += c.length;
    const header = new Uint8Array(12);
    header.set([0x52, 0x49, 0x46, 0x46], 0);
    new DataView(header.buffer).setUint32(4, bodyLen, true);
    header.set([0x57, 0x45, 0x42, 0x50], 8);
    return { blob: new Blob([header, ...parts], { type: 'image/webp' }), removed: Array.from(removed), orientation: 0 };
  }

  const STRIP = { jpeg: stripJpeg, png: stripPng, webp: stripWebp };

  function strip(buf, kind) {
    const k = kind || sniff(new Uint8Array(buf));
    return STRIP[k] ? STRIP[k](buf) : null;
  }

  function stripFile(file) {
    return file.arrayBuffer().then((buf) => {
      const out = strip(buf);
      return out ? out.blob : null;
    });
  }

  global.MentriaMetaStrip = { sniff, strip, stripFile, jpegEnd, jpegKind, keepJpegSegment, matchBytes };
})(window);
