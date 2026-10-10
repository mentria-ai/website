export function floatToInt16(input, output, n = input.length) {
  for (let i = 0; i < n; i++) {
    const v = input[i] < -1 ? -1 : input[i] > 1 ? 1 : input[i];
    output[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
}

export function encodeWav(chunks, sampleRate) {
  let frames = 0;
  for (const c of chunks) frames += c.length;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  v.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, frames * 2, true);
  return new Blob([header, ...chunks], { type: 'audio/wav' });
}

export function decodeWav(buf) {
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a wav file');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.byteLength) {
    const id = tag(off), size = v.getUint32(off + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(off + 8, true), channels: v.getUint16(off + 10, true), sampleRate: v.getUint32(off + 12, true), bits: v.getUint16(off + 22, true) };
    else if (id === 'data') data = { offset: off + 8, size: Math.min(size, buf.byteLength - off - 8) };
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.bits !== 16) throw new Error('unsupported wav');
  const frames = Math.floor(data.size / (2 * fmt.channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) samples[i] = v.getInt16(data.offset + i * 2 * fmt.channels, true) / 32768;
  return { sampleRate: fmt.sampleRate, samples };
}
