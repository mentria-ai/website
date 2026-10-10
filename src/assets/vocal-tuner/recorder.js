import { encodeWav } from './wav.js';

export function createRecorder(sampleRate, maxSeconds = 300) {
  const limit = Math.round(sampleRate * maxSeconds);
  let dry = [], tuned = [], frames = 0;
  const r = { sampleRate, limit };

  r.add = (d, t) => {
    if (frames >= limit) return true;
    const n = Math.min(d.length, t.length, limit - frames);
    dry.push(d.slice(0, n));
    tuned.push(t.slice(0, n));
    frames += n;
    return frames >= limit;
  };

  r.frames = () => frames;
  r.seconds = () => frames / sampleRate;

  r.finish = () => {
    const out = { dry: encodeWav(dry, sampleRate), tuned: encodeWav(tuned, sampleRate), duration: frames / sampleRate, frames };
    dry = [];
    tuned = [];
    frames = 0;
    return out;
  };

  r.reset = () => {
    dry = [];
    tuned = [];
    frames = 0;
  };

  return r;
}
