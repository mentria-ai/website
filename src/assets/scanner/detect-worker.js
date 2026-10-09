import { detectQuad } from './detect.js';
import { warpCPU, rotateCPU, stats, filterCPU } from './cpu.js';

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'detect') {
      self.postMessage({ id: m.id, ok: true, result: detectQuad(m.data, m.w, m.h) });
      return;
    }
    if (m.type === 'render') {
      const warped = warpCPU(m.data, m.sw, m.sh, m.H, m.ow, m.oh);
      const st = m.filter === 'auto' || m.filter === 'gray' ? stats(warped, m.ow, m.oh) : null;
      const r = rotateCPU(filterCPU(warped, m.ow, m.oh, m.filter, st), m.ow, m.oh, m.rotation);
      self.postMessage({ id: m.id, ok: true, data: r.data, width: r.w, height: r.h }, [r.data.buffer]);
      return;
    }
    self.postMessage({ id: m.id, ok: false, error: 'unknown' });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
  }
};
