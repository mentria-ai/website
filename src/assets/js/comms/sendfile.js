export const PART_BYTES = 18000;
export const MAX_BYTES = 10000000;
export const WINDOW = 24;

export const safeName = (name) => {
  let base = String(name == null ? '' : name).split(/[\\/]/).pop();
  base = base.replace(/[\u0000-\u001f\u007f]+/g, '-').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '').replace(/-+$/, '');
  if (!base) return 'file';
  if (base.length > 80) {
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 && base.length - dot <= 12 ? base.slice(dot) : '';
    base = base.slice(0, 80 - ext.length) + ext;
  }
  return base;
};

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64url = (u8) => b64(u8).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export const fileHash = async (bytes) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

const outcome = (g) => (g.ok ? 'ok' : g.err === 'too-big' ? 'too-big' : 'failed');

export const sendFile = async ({ bytes, name, mime, text }, { offer, resend, part, waitGot, onProgress = () => {}, window = WINDOW, quietRounds = 5 }) => {
  if (!bytes || !bytes.length) return 'failed';
  if (bytes.length > MAX_BYTES) return 'too-big';
  const n = Math.ceil(bytes.length / PART_BYTES);
  const chunk = (i) => b64(bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES));
  const id = await offer({ name, mime, size: bytes.length, sha256: await fileHash(bytes), n, text: text || '' });
  let g = await waitGot(id);
  if (!g && resend) { await resend(id); g = await waitGot(id); }
  if (!g) return 'failed';
  if (g.done) return outcome(g);
  let start = 0;
  let quiet = 0;
  while (start < n) {
    const end = Math.min(start + window, n);
    for (let i = start; i < end; i++) await part(id, i, chunk(i), i === end - 1);
    g = await waitGot(id);
    for (;;) {
      if (!g) {
        if (++quiet > quietRounds) return 'failed';
        await part(id, end - 1, chunk(end - 1), true);
        g = await waitGot(id);
        continue;
      }
      quiet = 0;
      onProgress(Math.min(1, (Number(g.have) || 0) / n));
      if (g.done) return outcome(g);
      const need = (Array.isArray(g.need) ? g.need : []).filter((i) => Number.isInteger(i) && i >= 0 && i < end);
      if (!need.length) {
        if (end < n) break;
        g = await waitGot(id);
        continue;
      }
      for (let k = 0; k < need.length; k++) await part(id, need[k], chunk(need[k]), k === need.length - 1);
      g = await waitGot(id);
    }
    start = end;
  }
  return 'failed';
};
