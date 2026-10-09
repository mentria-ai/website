import { writeFileSync } from 'node:fs';
import { makeScene } from './scanner-scenes.mjs';

export function writeY4m(path, { seed = 3, w = 1280, h = 720, frames = 30 } = {}) {
  const s = makeScene(seed, { w, h, kind: 'gradient' });
  const Y = new Uint8Array(w * h), U = new Uint8Array((w / 2) * (h / 2)), V = new Uint8Array((w / 2) * (h / 2));
  for (let p = 0; p < w * h; p++) {
    const r = s.rgba[p * 4], g = s.rgba[p * 4 + 1], b = s.rgba[p * 4 + 2];
    Y[p] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
  }
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w / 2; x++) {
      let r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const p = ((y * 2 + dy) * w + x * 2 + dx) * 4;
        r += s.rgba[p]; g += s.rgba[p + 1]; b += s.rgba[p + 2];
      }
      r /= 4; g /= 4; b /= 4;
      U[y * (w / 2) + x] = Math.max(0, Math.min(255, Math.round(-0.168736 * r - 0.331264 * g + 0.5 * b + 128)));
      V[y * (w / 2) + x] = Math.max(0, Math.min(255, Math.round(0.5 * r - 0.418688 * g - 0.081312 * b + 128)));
    }
  }
  const header = Buffer.from('YUV4MPEG2 W' + w + ' H' + h + ' F30:1 Ip A1:1 C420jpeg\n');
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Buffer.from(Y), Buffer.from(U), Buffer.from(V)]);
  writeFileSync(path, Buffer.concat([header].concat(Array(frames).fill(frame))));
  return s.truth;
}
