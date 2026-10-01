const NUL = String.fromCharCode(0);
const LATIN1 = new TextDecoder('windows-1252');
const UTF8 = new TextDecoder('utf-8');
const UTF16LE = new TextDecoder('utf-16le');
const UTF16BE = new TextDecoder('utf-16be');
const MAX_TAG = 16777216;
const GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];

async function bytes(file, start, end) {
  return new Uint8Array(await file.slice(start, Math.min(file.size, end)).arrayBuffer());
}
function str(u8, at, len) {
  let s = '';
  for (let i = 0; i < len && at + i < u8.length; i++) s += String.fromCharCode(u8[at + i]);
  return s;
}
function be32(u8, at) { return ((u8[at] << 24) >>> 0) + (u8[at + 1] << 16) + (u8[at + 2] << 8) + u8[at + 3]; }
function le32(u8, at) { return u8[at] + (u8[at + 1] << 8) + (u8[at + 2] << 16) + ((u8[at + 3] << 24) >>> 0); }
function syncsafe(u8, at) { return (u8[at] & 127) * 2097152 + (u8[at + 1] & 127) * 16384 + (u8[at + 2] & 127) * 128 + (u8[at + 3] & 127); }
function clean(s) { return String(s || '').split(NUL)[0].trim(); }
function num(s) { const m = /^\s*(\d+)/.exec(String(s || '')); return m ? +m[1] : 0; }
function year(s) { const m = /(\d{4})/.exec(String(s || '')); return m ? +m[1] : 0; }
function genre(s) {
  s = clean(s);
  const m = /^\((\d+)\)(.*)$/.exec(s);
  if (m) return m[2].trim() || GENRES[+m[1]] || '';
  if (/^\d+$/.test(s)) return GENRES[+s] || '';
  return s;
}

function unsync(u8) {
  const out = new Uint8Array(u8.length);
  let j = 0;
  for (let i = 0; i < u8.length; i++) {
    out[j++] = u8[i];
    if (u8[i] === 0xff && u8[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function decodeText(enc, raw) {
  if (enc === 1) {
    if (raw[0] === 0xfe && raw[1] === 0xff) return UTF16BE.decode(raw.subarray(2));
    return UTF16LE.decode(raw);
  }
  if (enc === 2) return UTF16BE.decode(raw);
  if (enc === 3) return UTF8.decode(raw);
  return LATIN1.decode(raw);
}

function textEnd(raw, enc, from) {
  if (enc === 1 || enc === 2) {
    for (let i = from; i + 1 < raw.length; i += 2) if (raw[i] === 0 && raw[i + 1] === 0) return i;
    return raw.length;
  }
  for (let i = from; i < raw.length; i++) if (raw[i] === 0) return i;
  return raw.length;
}

function id3Picture(body, v2) {
  const enc = body[0];
  let p = 1;
  let mime;
  if (v2) {
    const f = str(body, 1, 3).toUpperCase();
    mime = f === 'PNG' ? 'image/png' : 'image/jpeg';
    p = 4;
  } else {
    const e = textEnd(body, 0, 1);
    mime = str(body, 1, e - 1).toLowerCase() || 'image/jpeg';
    if (mime.indexOf('/') === -1) mime = 'image/' + (mime === 'png' ? 'png' : 'jpeg');
    p = e + 1;
  }
  const type = body[p];
  p += 1;
  const d = textEnd(body, enc, p);
  p = d + (enc === 1 || enc === 2 ? 2 : 1);
  if (p >= body.length) return null;
  return { type, mime, data: body.slice(p) };
}

const ID3_MAP = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album',
  TPE2: 'albumArtist', TP2: 'albumArtist', TRCK: 'track', TRK: 'track', TPOS: 'disc', TPA: 'disc',
  TYER: 'year', TYE: 'year', TDRC: 'year', TCON: 'genre', TCO: 'genre', TLEN: 'length', TLE: 'length'
};

async function readId3v2(file) {
  const hdr = await bytes(file, 0, 10);
  const ver = hdr[3];
  const flags = hdr[5];
  const size = syncsafe(hdr, 6);
  const end = 10 + size + (flags & 0x10 ? 10 : 0);
  if (ver < 2 || ver > 4 || size > MAX_TAG) return { end: 10 + size, tags: {} };
  let data = (await bytes(file, 10, 10 + size));
  if ((flags & 0x80) && ver < 4) data = unsync(data);
  let p = 0;
  if (flags & 0x40) p = ver === 3 ? 4 + be32(data, 0) : syncsafe(data, 0);
  const idLen = ver === 2 ? 3 : 4;
  const hLen = ver === 2 ? 6 : 10;
  const tags = {};
  let pic = null;
  while (p + hLen <= data.length) {
    const id = str(data, p, idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const fsize = ver === 2 ? (data[p + 3] << 16) + (data[p + 4] << 8) + data[p + 5] : (ver === 4 ? syncsafe(data, p + 4) : be32(data, p + 4));
    const fmt = ver === 2 ? 0 : data[p + 9];
    let body = data.subarray(p + hLen, Math.min(data.length, p + hLen + fsize));
    p += hLen + fsize;
    if (ver === 3) {
      if (fmt & 0xc0) continue;
      if (fmt & 0x20) body = body.subarray(1);
    } else if (ver === 4) {
      if (fmt & 0x0c) continue;
      if (fmt & 0x40) body = body.subarray(1);
      if (fmt & 0x01) body = body.subarray(4);
      if ((fmt & 0x02) || (flags & 0x80)) body = unsync(body);
    }
    if (!body.length) continue;
    if (id === 'APIC' || id === 'PIC') {
      const pc = id3Picture(body, ver === 2);
      if (pc && (!pic || (pc.type === 3 && pic.type !== 3))) pic = pc;
      continue;
    }
    const key = ID3_MAP[id];
    if (key && !tags[key]) tags[key] = clean(decodeText(body[0], body.subarray(1)));
  }
  return { end, tags, pic };
}

async function readId3v1(file) {
  if (file.size < 128) return null;
  const t = await bytes(file, file.size - 128, file.size);
  if (str(t, 0, 3) !== 'TAG') return null;
  const s = (a, l) => clean(LATIN1.decode(t.subarray(a, a + l)));
  return {
    title: s(3, 30), artist: s(33, 30), album: s(63, 30), year: s(93, 4),
    track: t[125] === 0 && t[126] ? String(t[126]) : '', genre: GENRES[t[127]] || ''
  };
}

const MP3_RATES = [[44100, 48000, 32000], [22050, 24000, 16000], [11025, 12000, 8000]];
const MP3_KBPS = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};

async function mp3Duration(file, start, hasV1) {
  const buf = await bytes(file, start, start + 65536);
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const vBits = (buf[i + 1] >> 3) & 3;
    const lBits = (buf[i + 1] >> 1) & 3;
    const bIdx = buf[i + 2] >> 4;
    const rIdx = (buf[i + 2] >> 2) & 3;
    if (vBits === 1 || lBits === 0 || bIdx === 0 || bIdx === 15 || rIdx === 3) continue;
    const mpeg = vBits === 3 ? 1 : (vBits === 2 ? 2 : 25);
    const layer = 4 - lBits;
    const rate = MP3_RATES[mpeg === 1 ? 0 : (mpeg === 2 ? 1 : 2)][rIdx];
    const kbps = MP3_KBPS[(mpeg === 1 ? 1 : 2) + '-' + layer][bIdx];
    const mono = (buf[i + 3] >> 6) === 3;
    const spf = layer === 1 ? 384 : (layer === 2 || mpeg === 1 ? 1152 : 576);
    const side = mpeg === 1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const x = i + 4 + side;
    const tag = str(buf, x, 4);
    if (tag === 'Xing' || tag === 'Info') {
      const fl = be32(buf, x + 4);
      if (fl & 1) return (be32(buf, x + 8) * spf) / rate;
    }
    if (str(buf, i + 36, 4) === 'VBRI') return (be32(buf, i + 36 + 14) * spf) / rate;
    const audio = file.size - start - i - (hasV1 ? 128 : 0);
    return kbps ? (audio * 8) / (kbps * 1000) : 0;
  }
  return 0;
}

function vorbisComments(u8, at, out) {
  const vlen = le32(u8, at);
  let p = at + 4 + vlen;
  const n = le32(u8, p);
  p += 4;
  const map = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist', TRACKNUMBER: 'track', DISCNUMBER: 'disc', DATE: 'year', YEAR: 'year', GENRE: 'genre' };
  let pic = null;
  for (let i = 0; i < n && p + 4 <= u8.length; i++) {
    const len = le32(u8, p);
    p += 4;
    if (p + len > u8.length) break;
    const kv = UTF8.decode(u8.subarray(p, p + len));
    p += len;
    const eq = kv.indexOf('=');
    if (eq < 1) continue;
    const k = kv.slice(0, eq).toUpperCase();
    const v = kv.slice(eq + 1);
    if (k === 'METADATA_BLOCK_PICTURE' && !pic) {
      try {
        const bin = atob(v.replace(/\s+/g, ''));
        const b = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) b[j] = bin.charCodeAt(j);
        pic = flacPicture(b, 0);
      } catch (_) {}
    } else if (map[k] && !out[map[k]]) out[map[k]] = v.trim();
  }
  return pic;
}

function flacPicture(u8, at) {
  const type = be32(u8, at);
  const ml = be32(u8, at + 4);
  const mime = str(u8, at + 8, ml) || 'image/jpeg';
  let p = at + 8 + ml;
  const dl = be32(u8, p);
  p += 4 + dl + 16;
  const len = be32(u8, p);
  p += 4;
  if (p + len > u8.length) return null;
  return { type, mime, data: u8.slice(p, p + len) };
}

async function readFlac(file, start) {
  const tags = {};
  let pic = null;
  let duration = 0;
  let p = start + 4;
  for (let i = 0; i < 64; i++) {
    const h = await bytes(file, p, p + 4);
    if (h.length < 4) break;
    const last = h[0] & 0x80;
    const type = h[0] & 0x7f;
    const len = (h[1] << 16) + (h[2] << 8) + h[3];
    if (type === 0 || type === 4 || (type === 6 && !pic && len < MAX_TAG)) {
      const b = await bytes(file, p + 4, p + 4 + len);
      if (type === 0 && b.length >= 18) {
        const rate = (b[10] << 12) + (b[11] << 4) + (b[12] >> 4);
        const total = (b[13] & 15) * 4294967296 + be32(b, 14);
        if (rate) duration = total / rate;
      } else if (type === 4) {
        const vp = vorbisComments(b, 0, tags);
        if (vp && !pic) pic = vp;
      } else if (type === 6) {
        const fp = flacPicture(b, 0);
        if (fp && (!pic || (fp.type === 3 && pic.type !== 3))) pic = fp;
      }
    }
    p += 4 + len;
    if (last) break;
  }
  return { tags, pic, duration };
}

function oggPackets(u8, want) {
  const packets = [];
  let cur = [];
  let p = 0;
  while (p + 27 <= u8.length && packets.length < want) {
    if (str(u8, p, 4) !== 'OggS') break;
    const segs = u8[p + 26];
    let q = p + 27 + segs;
    for (let s = 0; s < segs; s++) {
      const l = u8[p + 27 + s];
      if (q + l > u8.length) return packets;
      cur.push(u8.subarray(q, q + l));
      q += l;
      if (l < 255) {
        let total = 0;
        cur.forEach((c) => { total += c.length; });
        const out = new Uint8Array(total);
        let o = 0;
        cur.forEach((c) => { out.set(c, o); o += c.length; });
        packets.push(out);
        cur = [];
        if (packets.length >= want) return packets;
      }
    }
    p = q;
  }
  return packets;
}

async function readOgg(file) {
  let u8 = await bytes(file, 0, 262144);
  let pk = oggPackets(u8, 2);
  if (pk.length < 2 && file.size > u8.length) {
    u8 = await bytes(file, 0, Math.min(file.size, MAX_TAG));
    pk = oggPackets(u8, 2);
  }
  const tags = {};
  let pic = null;
  let rate = 0;
  let skip = 0;
  if (pk[0] && str(pk[0], 0, 8) === 'OpusHead') { rate = 48000; skip = pk[0][10] + (pk[0][11] << 8); }
  else if (pk[0] && pk[0][0] === 1 && str(pk[0], 1, 6) === 'vorbis') rate = le32(pk[0], 12);
  if (pk[1]) {
    if (str(pk[1], 0, 8) === 'OpusTags') pic = vorbisComments(pk[1], 8, tags);
    else if (pk[1][0] === 3 && str(pk[1], 1, 6) === 'vorbis') pic = vorbisComments(pk[1], 7, tags);
  }
  let duration = 0;
  if (rate) {
    const tail = await bytes(file, Math.max(0, file.size - 65536), file.size);
    for (let i = tail.length - 14; i >= 0; i--) {
      if (tail[i] === 0x4f && str(tail, i, 4) === 'OggS') {
        const g = le32(tail, i + 6) + le32(tail, i + 10) * 4294967296;
        if (g > 0) duration = Math.max(0, g - skip) / rate;
        break;
      }
    }
  }
  return { tags, pic, duration };
}

function mp4Boxes(u8, from, to, fn) {
  let p = from;
  while (p + 8 <= to) {
    let size = be32(u8, p);
    const type = str(u8, p + 4, 4);
    let h = 8;
    if (size === 1) { size = be32(u8, p + 8) * 4294967296 + be32(u8, p + 12); h = 16; }
    else if (size === 0) size = to - p;
    if (size < h || p + size > to) break;
    if (fn(type, p + h, p + size) === false) return;
    p += size;
  }
}

async function readMp4(file) {
  let moov = null;
  let off = 0;
  for (let i = 0; i < 64 && off + 8 <= file.size; i++) {
    const h = await bytes(file, off, off + 16);
    let size = be32(h, 0);
    const type = str(h, 4, 4);
    if (size === 1) size = be32(h, 8) * 4294967296 + be32(h, 12);
    else if (size === 0) size = file.size - off;
    if (size < 8) break;
    if (type === 'moov') { if (size <= MAX_TAG * 2) moov = await bytes(file, off, off + size); break; }
    off += size;
  }
  const tags = {};
  let pic = null;
  let duration = 0;
  if (!moov) return { tags, pic, duration };
  const map = { '©nam': 'title', '©ART': 'artist', '©alb': 'album', aART: 'albumArtist', '©day': 'year', '©gen': 'genre' };
  mp4Boxes(moov, 8, moov.length, (type, s, e) => {
    if (type === 'mvhd') {
      const v = moov[s];
      const ts = v === 1 ? be32(moov, s + 20) : be32(moov, s + 12);
      const dur = v === 1 ? be32(moov, s + 24) * 4294967296 + be32(moov, s + 28) : be32(moov, s + 16);
      if (ts) duration = dur / ts;
    } else if (type === 'udta') {
      mp4Boxes(moov, s, e, (t2, s2, e2) => {
        if (t2 !== 'meta') return;
        const inner = str(moov, s2 + 4, 4) === 'hdlr' ? s2 : s2 + 4;
        mp4Boxes(moov, inner, e2, (t3, s3, e3) => {
          if (t3 !== 'ilst') return;
          mp4Boxes(moov, s3, e3, (item, s4, e4) => {
            mp4Boxes(moov, s4, e4, (t5, s5, e5) => {
              if (t5 !== 'data') return;
              const kind = be32(moov, s5) & 0xffffff;
              const val = moov.subarray(s5 + 8, e5);
              if (item === 'covr' && !pic) pic = { type: 3, mime: kind === 14 ? 'image/png' : 'image/jpeg', data: val.slice() };
              else if (item === 'trkn' && val.length >= 4) { tags.track = String((val[2] << 8) + val[3]); }
              else if (item === 'disk' && val.length >= 4) { tags.disc = String((val[2] << 8) + val[3]); }
              else if (item === 'gnre' && val.length >= 2 && !tags.genre) tags.genre = GENRES[((val[0] << 8) + val[1]) - 1] || '';
              else if (map[item] && !tags[map[item]]) tags[map[item]] = UTF8.decode(val).trim();
              return false;
            });
          });
        });
      });
    }
  });
  return { tags, pic, duration };
}

async function readWav(file) {
  const u8 = await bytes(file, 0, 65536);
  const tags = {};
  let byteRate = 0;
  let dataSize = 0;
  let p = 12;
  while (p + 8 <= u8.length) {
    const id = str(u8, p, 4);
    const len = le32(u8, p + 4);
    if (id === 'fmt ') byteRate = le32(u8, p + 16);
    else if (id === 'data') { dataSize = Math.min(len, file.size - p - 8); break; }
    else if (id === 'LIST' && str(u8, p + 8, 4) === 'INFO') {
      let q = p + 12;
      const map = { INAM: 'title', IART: 'artist', IPRD: 'album', ICRD: 'year', IGNR: 'genre', ITRK: 'track' };
      while (q + 8 <= Math.min(u8.length, p + 8 + len)) {
        const k = str(u8, q, 4);
        const l = le32(u8, q + 4);
        if (map[k]) tags[map[k]] = clean(LATIN1.decode(u8.subarray(q + 8, q + 8 + l)));
        q += 8 + l + (l & 1);
      }
    }
    p += 8 + len + (len & 1);
  }
  return { tags, pic: null, duration: byteRate ? dataSize / byteRate : 0 };
}

function finish(r) {
  const t = r.tags || {};
  const out = {
    title: clean(t.title), artist: clean(t.artist), album: clean(t.album), albumArtist: clean(t.albumArtist),
    track: num(t.track), disc: num(t.disc), year: year(t.year), genre: genre(t.genre),
    duration: r.duration > 0 && isFinite(r.duration) ? Math.round(r.duration * 1000) / 1000 : 0
  };
  if (!out.duration && num(t.length)) out.duration = num(t.length) / 1000;
  out.picture = r.pic && r.pic.data && r.pic.data.length ? { mime: r.pic.mime, data: r.pic.data } : null;
  return out;
}

export async function readTags(file) {
  try {
    const head = await bytes(file, 0, 12);
    if (str(head, 0, 3) === 'ID3') {
      const id3 = await readId3v2(file);
      const after = await bytes(file, id3.end, id3.end + 4);
      if (str(after, 0, 4) === 'fLaC') {
        const f = await readFlac(file, id3.end);
        return finish({ tags: Object.assign({}, id3.tags, f.tags), pic: f.pic || id3.pic, duration: f.duration });
      }
      const v1 = await readId3v1(file);
      const tags = Object.assign({}, v1 || {}, id3.tags);
      return finish({ tags, pic: id3.pic, duration: await mp3Duration(file, id3.end, !!v1) });
    }
    if (str(head, 0, 4) === 'fLaC') return finish(await readFlac(file, 0));
    if (str(head, 0, 4) === 'OggS') return finish(await readOgg(file));
    if (str(head, 4, 4) === 'ftyp') return finish(await readMp4(file));
    if (str(head, 0, 4) === 'RIFF' && str(head, 8, 4) === 'WAVE') return finish(await readWav(file));
    if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
      const v1 = await readId3v1(file);
      return finish({ tags: v1 || {}, pic: null, duration: await mp3Duration(file, 0, !!v1) });
    }
  } catch (_) {}
  return null;
}
