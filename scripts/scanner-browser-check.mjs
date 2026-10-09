import { rmSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { serve } from './scanner-serve.mjs';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/scanner-browser-check.mjs <build dir>'); process.exit(2); }
const ORIGIN = 'http://localhost:8098';
const PROFILE = '/Volumes/Mac ext storage/games-tmp/orch/scanner-check-profile';
rmSync(PROFILE, { recursive: true, force: true });
const server = await serve(BUILD, 8098);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  userDataDir: PROFILE,
  protocolTimeout: 600000,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal']
});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('renderer: GPU and CPU agree, rotation keeps orientation, filters and detection work', async (page) => {
  await page.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  const r = await page.evaluate(async () => {
    const W = await import('/assets/scanner/warp.js');
    const D = await import('/assets/scanner/detector.js');
    const c = new OffscreenCanvas(800, 600);
    const x = c.getContext('2d');
    x.fillStyle = '#202830';
    x.fillRect(0, 0, 800, 600);
    const quad = [[150, 100], [650, 120], [620, 520], [180, 500]];
    x.fillStyle = '#f2f2ee';
    x.beginPath();
    quad.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
    x.closePath();
    x.fill();
    x.fillStyle = '#d02020';
    x.fillRect(210, 150, 60, 60);
    x.fillStyle = '#333333';
    for (let i = 0; i < 12; i++) x.fillRect(260, 260 + i * 18, 280, 6);
    const bmp = await createImageBitmap(c);
    const pixels = async (blob) => {
      const b = await createImageBitmap(blob);
      const cc = new OffscreenCanvas(b.width, b.height);
      const xx = cc.getContext('2d');
      xx.drawImage(b, 0, 0);
      return { d: xx.getImageData(0, 0, b.width, b.height).data, w: b.width, h: b.height };
    };
    const redAt = (img) => {
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < img.h; y++) {
        for (let xx = 0; xx < img.w; xx++) {
          const i = (y * img.w + xx) * 4;
          if (img.d[i] > 150 && img.d[i + 1] < 90) { sx += xx; sy += y; n++; }
        }
      }
      return n ? [sx / n / img.w, sy / n / img.h] : null;
    };
    const g = await W.render(bmp, quad, { maxSide: 600, mime: 'image/png' });
    const k = await W.render(bmp, quad, { maxSide: 600, mime: 'image/png', cpu: true });
    const a = await pixels(g.blob), b = await pixels(k.blob);
    let diff = 0;
    for (let i = 0; i < a.d.length; i += 4) diff += Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]);
    diff /= (a.d.length / 4) * 3;
    const rot = await pixels((await W.render(bmp, quad, { maxSide: 600, mime: 'image/png', rotation: 90 })).blob);
    const modes = {};
    for (const f of ['auto', 'gray', 'bw', 'whiteboard']) {
      const o = await pixels((await W.render(bmp, quad, { maxSide: 400, mime: 'image/png', filter: f })).blob);
      let ext = 0;
      for (let i = 0; i < o.d.length; i += 4) if (o.d[i] < 40 || o.d[i] > 215) ext++;
      modes[f] = ext / (o.d.length / 4);
    }
    const det = await D.detectIn(bmp, 640);
    const cornerErr = det.quad ? Math.max(...det.quad.map((p) => Math.min(...quad.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))))) : 999;
    return { gpu: W.gpuAvailable(), w: g.width, h: g.height, cw: k.width, ch: k.height, rw: rot.w, rh: rot.h, diff, r0: redAt(a), r90: redAt(rot), modes, cornerErr };
  });
  if (!r.gpu) throw new Error('WebGL2 is unavailable in this browser');
  if (r.w !== r.cw || r.h !== r.ch) throw new Error('GPU ' + r.w + 'x' + r.h + ' vs CPU ' + r.cw + 'x' + r.ch);
  if (r.rw !== r.h || r.rh !== r.w) throw new Error('rotation did not swap sides');
  if (r.diff > 4) throw new Error('GPU and CPU differ by ' + r.diff.toFixed(2));
  if (!r.r0 || r.r0[0] > 0.5 || r.r0[1] > 0.5) throw new Error('marker not top-left: ' + JSON.stringify(r.r0));
  if (!r.r90 || r.r90[0] < 0.5 || r.r90[1] > 0.5) throw new Error('marker not top-right after 90: ' + JSON.stringify(r.r90));
  if (r.modes.bw < 0.8) throw new Error('black & white share ' + r.modes.bw);
  if (r.cornerErr > 24) throw new Error('detection corner error ' + r.cornerErr);
});

let failed = 0;
for (const [name, fn] of checks) {
  const page = await browser.newPage();
  try {
    await fn(page);
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + ((e && e.message) || e));
  }
  await page.close();
}
await browser.close();
server.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(checks.length - failed + '/' + checks.length + ' passed');
if (failed) process.exit(1);
