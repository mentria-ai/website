const te = new TextEncoder();
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

export function pageBox(imgW, imgH, pageSize) {
  if (SIZES[pageSize]) {
    let [pw, ph] = SIZES[pageSize];
    if (imgW > imgH) [pw, ph] = [ph, pw];
    const s = Math.min(pw / imgW, ph / imgH);
    const dw = imgW * s, dh = imgH * s;
    return { pw, ph, x: (pw - dw) / 2, y: (ph - dh) / 2, dw, dh };
  }
  const pw = 595.28, ph = pw * imgH / imgW;
  return { pw, ph, x: 0, y: 0, dw: pw, dh: ph };
}

function num(v) {
  return String(Math.round(v * 100) / 100);
}

export function pdfString(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
  let hex = 'FEFF';
  for (const ch of s) {
    let cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      cp -= 0x10000;
      hex += (0xd800 + (cp >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (cp & 0x3ff)).toString(16).padStart(4, '0');
    } else {
      hex += cp.toString(16).padStart(4, '0');
    }
  }
  return '<' + hex.toUpperCase() + '>';
}

function pdfDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return 'D:' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

const len = (b) => (b instanceof Uint8Array ? b.length : b.size);

function pdfParts(pages, { pageSize = 'fit', title = 'Scan', date = new Date() } = {}) {
  const parts = [];
  const offsets = [];
  let size = 0;
  const add = (x) => {
    const b = typeof x === 'string' ? te.encode(x) : x;
    parts.push(b);
    size += len(b);
  };
  const obj = (n, body) => {
    offsets[n] = size;
    add(n + ' 0 obj\n' + body + '\nendobj\n');
  };
  add(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + pages.map((_, i) => (4 + 3 * i) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
  obj(3, '<< /Title ' + pdfString(title) + ' /Producer (Mentria Document Scanner) /CreationDate (' + pdfDate(date) + ') >>');
  pages.forEach((p, i) => {
    const b = pageBox(p.width, p.height, pageSize);
    const content = 'q ' + num(b.dw) + ' 0 0 ' + num(b.dh) + ' ' + num(b.x) + ' ' + num(b.y) + ' cm /Im0 Do Q';
    obj(4 + 3 * i, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(b.pw) + ' ' + num(b.ph) + '] /Resources << /XObject << /Im0 ' + (6 + 3 * i) + ' 0 R >> >> /Contents ' + (5 + 3 * i) + ' 0 R >>');
    obj(5 + 3 * i, '<< /Length ' + te.encode(content).length + ' >>\nstream\n' + content + '\nendstream');
    offsets[6 + 3 * i] = size;
    add((6 + 3 * i) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.width + ' /Height ' + p.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + len(p.jpeg) + ' >>\nstream\n');
    add(p.jpeg);
    add('\nendstream\nendobj\n');
  });
  const count = 4 + 3 * pages.length;
  const xref = size;
  let table = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
  for (let k = 1; k < count; k++) table += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
  add(table + 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return parts;
}

export function buildPdfBytes(pages, opts) {
  const parts = pdfParts(pages, opts);
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

export function buildPdf(pages, opts) {
  return new Blob(pdfParts(pages, opts), { type: 'application/pdf' });
}
