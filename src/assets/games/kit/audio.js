const PENTATONIC = [0, 2, 4, 7, 9];
const DRONE_DETUNE = [-7, 5, -3, 9];
const DRONE_DRIFT_RATE = [0.17, 0.23, 0.31, 0.13];
const DRONE_DRIFT_DEPTH = [5, 4, 6, 4];
const CYLINDER_CHOICES = [4, 6, 8, 10, 12];

function isNum(v) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
}

function num(v, d) {
  return isNum(v) ? v : d;
}

function unit(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function within(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function phaseAt(k, salt) {
  const x = Math.sin(k * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * Math.PI * 2;
}

function nearestCylinders(c) {
  const want = num(c, 6);
  let best = 6;
  let gap = Infinity;
  for (let i = 0; i < CYLINDER_CHOICES.length; i++) {
    const d = Math.abs(CYLINDER_CHOICES[i] - want);
    if (d < gap) {
      gap = d;
      best = CYLINDER_CHOICES[i];
    }
  }
  return best;
}

function propAmps() {
  const a = new Float32Array(40);
  for (let k = 1; k < 40; k++) {
    let v = 0.42 / Math.pow(k, 1.2);
    if (k % 3 === 0) v += 0.95 / Math.pow(k / 3, 0.95);
    if (k === 6) v *= 1.3;
    if (k === 14 || k === 21 || k === 28) v += 0.05;
    a[k] = v;
  }
  return a;
}

function engineAmps(cylinders, tone) {
  const a = new Float32Array(48);
  const p = 1.12 - 0.5 * tone;
  const formant = cylinders >= 10 ? 3 : 2;
  for (let k = 1; k < 48; k++) {
    let v = 1 / Math.pow(k, p);
    v *= 1 +
      0.8 * Math.exp(-((k - formant) * (k - formant)) / 1.5) +
      0.45 * Math.exp(-((k - 5) * (k - 5)) / 4) +
      0.3 * tone * Math.exp(-((k - 11) * (k - 11)) / 10);
    a[k] = v;
  }
  return a;
}

export function createAudio(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const S = {
    ctx: null,
    offline: false,
    owned: false,
    kicked: false,
    master: null,
    muteGain: null,
    limiter: null,
    reverbIn: null,
    buses: null,
    noise: null,
    pinkStereo: null,
    pink: null,
    softCurve: null,
    propWave: null,
    waveCache: new Map(),
    levels: { master: unit(num(options.master, 0.8)), sfx: 1, engine: 1, ui: 1 },
    muted: false,
    voices: new Set(),
    disposed: false,
    listening: false
  };

  function gainNode(v) {
    const n = S.ctx.createGain();
    n.gain.value = v;
    return n;
  }

  function filterNode(type, f, q) {
    const n = S.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    if (q !== undefined) n.Q.value = q;
    return n;
  }

  function noiseBuffer(seconds, channels) {
    const sr = S.ctx.sampleRate;
    const n = Math.max(2048, Math.floor(sr * seconds));
    const b = S.ctx.createBuffer(channels, n, sr);
    for (let c = 0; c < channels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return b;
  }

  function pinkBuffer(seconds, channels) {
    const sr = S.ctx.sampleRate;
    const n = Math.max(2048, Math.floor(sr * seconds));
    const b = S.ctx.createBuffer(channels, n, sr);
    for (let c = 0; c < channels; c++) {
      const d = b.getChannelData(c);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let peak = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        const v = b0 + b1 + b2 + w * 0.1848;
        d[i] = v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
      const k = peak > 0 ? 0.95 / peak : 1;
      for (let i = 0; i < n; i++) d[i] *= k;
    }
    return b;
  }

  function impulseBuffer(seconds, decay) {
    const sr = S.ctx.sampleRate;
    const n = Math.max(2048, Math.floor(sr * seconds));
    const b = S.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      const pre = Math.floor(sr * (c ? 0.011 : 0.007));
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const e = Math.exp(-t * decay) * Math.max(0, 1 - t / seconds);
        const k = 0.9 - Math.min(0.72, t * 0.6);
        lp += (Math.random() * 2 - 1 - lp) * k;
        d[i] = lp * e;
      }
    }
    return b;
  }

  function tanhCurve(k) {
    const n = 2048;
    const c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    return c;
  }

  function periodic(amps, salt) {
    try {
      const n = amps.length;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) {
        const ph = phaseAt(k, salt);
        real[k] = amps[k] * Math.sin(ph);
        imag[k] = amps[k] * Math.cos(ph);
      }
      return S.ctx.createPeriodicWave(real, imag);
    } catch (_) {
      return null;
    }
  }

  function engineWave(cylinders, tone) {
    const key = cylinders + '|' + tone.toFixed(2);
    if (S.waveCache.has(key)) return S.waveCache.get(key);
    const w = periodic(engineAmps(cylinders, tone), cylinders);
    S.waveCache.set(key, w);
    return w;
  }

  function makeBus(level) {
    const dry = gainNode(level);
    const wet = gainNode(level);
    dry.connect(S.master);
    wet.connect(S.reverbIn);
    return { dry: dry, wet: wet };
  }

  function build() {
    const c = S.ctx;
    S.master = gainNode(S.levels.master);
    S.muteGain = gainNode(S.muted ? 0 : 1);
    S.limiter = c.createDynamicsCompressor();
    S.limiter.threshold.value = -8;
    S.limiter.knee.value = 4;
    S.limiter.ratio.value = 16;
    S.limiter.attack.value = 0.002;
    S.limiter.release.value = 0.16;
    S.master.connect(S.muteGain);
    S.muteGain.connect(S.limiter);
    S.limiter.connect(c.destination);
    S.noise = noiseBuffer(2.3, 1);
    S.pinkStereo = pinkBuffer(3.1, 2);
    S.pink = pinkBuffer(2.7, 1);
    S.softCurve = tanhCurve(1.6);
    const verb = c.createConvolver();
    verb.normalize = true;
    verb.buffer = impulseBuffer(1.4, 3.6);
    S.reverbIn = gainNode(1);
    const verbOut = gainNode(0.5);
    S.reverbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(S.master);
    S.buses = { sfx: makeBus(S.levels.sfx), engine: makeBus(S.levels.engine), ui: makeBus(S.levels.ui) };
    S.propWave = periodic(propAmps(), 3);
  }

  function makeContext() {
    if (options.context) {
      S.ctx = options.context;
      S.owned = false;
      S.offline = typeof S.ctx.startRendering === 'function';
      return true;
    }
    if (typeof window === 'undefined') return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    let c = null;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch (_) {
      try {
        c = new AC();
      } catch (__) {
        c = null;
      }
    }
    if (!c) return false;
    S.ctx = c;
    S.owned = true;
    S.offline = false;
    return true;
  }

  function kick() {
    if (S.kicked || S.offline) return;
    S.kicked = true;
    try {
      const b = S.ctx.createBuffer(1, 1, S.ctx.sampleRate);
      const s = S.ctx.createBufferSource();
      s.buffer = b;
      s.connect(S.ctx.destination);
      s.start(0);
    } catch (_) {}
  }

  function hidden() {
    try {
      return typeof document !== 'undefined' && document.hidden === true;
    } catch (_) {
      return false;
    }
  }

  function resume() {
    if (!S.ctx || S.offline || S.disposed) return;
    try {
      const st = S.ctx.state;
      if (st === 'closed' || st === 'running') return;
      const p = S.ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (_) {}
  }

  function suspend() {
    if (!S.ctx || S.offline || S.disposed) return;
    try {
      if (S.ctx.state !== 'running') return;
      const p = S.ctx.suspend();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (_) {}
  }

  function onVisibility() {
    if (hidden()) suspend();
    else resume();
  }

  function onPageShow() {
    if (!hidden()) resume();
  }

  function onPageHide() {
    suspend();
  }

  function onGesture() {
    if (!S.ctx || hidden()) return;
    if (S.ctx.state !== 'running') resume();
  }

  function onStateChange() {
    if (!S.ctx || hidden()) return;
    if (S.ctx.state === 'interrupted') resume();
  }

  function watch() {
    if (S.listening || S.offline || typeof window === 'undefined') return;
    S.listening = true;
    try {
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pageshow', onPageShow);
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('pointerup', onGesture, true);
      window.addEventListener('touchend', onGesture, true);
      window.addEventListener('keydown', onGesture, true);
      if (S.ctx && typeof S.ctx.addEventListener === 'function') S.ctx.addEventListener('statechange', onStateChange);
    } catch (_) {}
  }

  function unwatch() {
    if (!S.listening) return;
    S.listening = false;
    try {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pointerup', onGesture, true);
      window.removeEventListener('touchend', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      if (S.ctx && typeof S.ctx.removeEventListener === 'function') S.ctx.removeEventListener('statechange', onStateChange);
    } catch (_) {}
  }

  function unlock() {
    if (S.disposed) return false;
    if (!S.ctx) {
      if (!makeContext()) return false;
      try {
        build();
      } catch (_) {
        if (S.owned) {
          try {
            S.ctx.close();
          } catch (__) {}
        }
        S.ctx = null;
        S.buses = null;
        return false;
      }
      S.voices.forEach(function (v) {
        v.ensure();
      });
      watch();
    }
    kick();
    if (!hidden()) resume();
    return true;
  }

  function rampParam(param, v) {
    if (!S.ctx) return;
    try {
      const t = S.ctx.currentTime;
      param.cancelScheduledValues(t);
      param.setTargetAtTime(v, t, 0.015);
    } catch (_) {}
  }

  function setMaster(v) {
    S.levels.master = unit(num(v, S.levels.master));
    if (S.master) rampParam(S.master.gain, S.levels.master);
    return S.levels.master;
  }

  function setMuted(b) {
    S.muted = !!b;
    if (S.muteGain) rampParam(S.muteGain.gain, S.muted ? 0 : 1);
    return S.muted;
  }

  function setLevels(l) {
    if (!l || typeof l !== 'object') return Object.assign({}, S.levels);
    const names = ['sfx', 'engine', 'ui'];
    for (let i = 0; i < names.length; i++) {
      const k = names[i];
      if (!isNum(l[k])) continue;
      S.levels[k] = unit(l[k]);
      if (S.buses && S.buses[k]) {
        rampParam(S.buses[k].dry.gain, S.levels[k]);
        rampParam(S.buses[k].wet.gain, S.levels[k]);
      }
    }
    if (isNum(l.master)) setMaster(l.master);
    return Object.assign({}, S.levels);
  }

  function voiceKit(n) {
    return {
      gain: function (v) {
        const x = gainNode(v);
        n.all.push(x);
        return x;
      },
      filter: function (type, f, q) {
        const x = filterNode(type, f, q);
        n.all.push(x);
        return x;
      },
      osc: function (type, f, wave) {
        const x = S.ctx.createOscillator();
        x.type = type;
        x.frequency.value = f;
        if (wave) {
          try {
            x.setPeriodicWave(wave);
          } catch (_) {}
        }
        n.all.push(x);
        n.sources.push(x);
        return x;
      },
      loop: function (buf, rate) {
        const x = S.ctx.createBufferSource();
        x.buffer = buf;
        x.loop = true;
        if (isNum(rate)) x.playbackRate.value = rate;
        n.all.push(x);
        n.sources.push(x);
        return x;
      },
      shaper: function (curve) {
        const x = S.ctx.createWaveShaper();
        x.curve = curve;
        x.oversample = '2x';
        n.all.push(x);
        return x;
      },
      pan: function () {
        if (typeof S.ctx.createStereoPanner !== 'function') return null;
        const x = S.ctx.createStereoPanner();
        n.all.push(x);
        return x;
      }
    };
  }

  function route(n, k, busName, wetLevel) {
    const b = S.buses[busName] || S.buses.sfx;
    n.out.connect(n.vol);
    let tail = n.vol;
    if (n.pan) {
      n.vol.connect(n.pan);
      tail = n.pan;
    }
    tail.connect(b.dry);
    if (wetLevel > 0) {
      const w = k.gain(wetLevel);
      tail.connect(w);
      w.connect(b.wet);
    }
  }

  function put(n, key, param, value, t, tc) {
    if (!isNum(value)) return;
    if (n.first) {
      n.last[key] = value;
      param.setValueAtTime(value, t);
      return;
    }
    const last = n.last[key];
    if (last !== undefined && Math.abs(value - last) <= Math.abs(last) * 0.003 + 1e-5) return;
    n.last[key] = value;
    param.setTargetAtTime(value, t, tc);
  }

  function makeVoice(defaults, spec, buildFn, applyFn, extra) {
    const v = { state: defaults, spec: spec, n: null, dead: false };
    v.ensure = function () {
      if (v.n || v.dead || !S.ctx || !S.buses) return;
      const n = { all: [], sources: [], last: {}, first: true, out: null, vol: null, pan: null, prevT: -1 };
      try {
        buildFn(v, n, voiceKit(n));
        const t = S.ctx.currentTime;
        applyFn(v, n, t);
        n.first = false;
        n.out.gain.setValueAtTime(0, t);
        n.out.gain.setTargetAtTime(1, t, 0.03);
        for (let i = 0; i < n.sources.length; i++) {
          const s = n.sources[i];
          if (s.buffer) s.start(t, Math.random() * s.buffer.duration * 0.9);
          else s.start(t);
        }
        v.n = n;
      } catch (_) {
        for (let i = 0; i < n.all.length; i++) {
          try {
            n.all[i].disconnect();
          } catch (__) {}
        }
        v.n = null;
        v.dead = true;
        S.voices.delete(v);
      }
    };
    const api = {
      set: function (patch) {
        if (v.dead || !patch || typeof patch !== 'object') return api;
        const s = v.state;
        for (const key in patch) {
          const val = patch[key];
          if (key === 'rpm' && Array.isArray(val)) {
            if (!Array.isArray(s.rpm)) s.rpm = [0, 0, 0, 0];
            for (let i = 0; i < 4; i++) s.rpm[i] = num(val[i], num(val[0], 0));
          } else if (typeof val === 'boolean') {
            s[key] = val ? 1 : 0;
          } else if (isNum(val)) {
            s[key] = val;
          }
        }
        if (v.n && S.ctx) {
          try {
            applyFn(v, v.n, S.ctx.currentTime);
          } catch (_) {}
        }
        return api;
      },
      stop: function () {
        if (v.dead) return;
        v.dead = true;
        S.voices.delete(v);
        const n = v.n;
        v.n = null;
        if (!n || !S.ctx) return;
        try {
          const t = S.ctx.currentTime;
          n.out.gain.cancelScheduledValues(t);
          n.out.gain.setTargetAtTime(0, t, 0.04);
          let first = null;
          for (let i = 0; i < n.sources.length; i++) {
            try {
              n.sources[i].stop(t + 0.3);
              if (!first) first = n.sources[i];
            } catch (_) {}
          }
          if (first) {
            first.onended = function () {
              for (let i = 0; i < n.all.length; i++) {
                try {
                  n.all[i].disconnect();
                } catch (_) {}
              }
            };
          }
        } catch (_) {}
      }
    };
    if (extra) extra(api, v);
    S.voices.add(v);
    v.ensure();
    return api;
  }

  function buildDrone(v, n, k) {
    n.out = k.gain(0);
    n.vol = k.gain(1);
    n.pan = k.pan();
    route(n, k, 'engine', 0.07);
    const mix = k.gain(1);
    n.drive = k.gain(1);
    const shaper = k.shaper(S.softCurve);
    n.post = k.gain(0.8);
    n.lp = k.filter('lowpass', 1200, 0.85);
    const air = k.filter('peaking', 3200, 1.2);
    air.gain.value = 2;
    mix.connect(n.drive);
    n.drive.connect(shaper);
    shaper.connect(n.post);
    n.post.connect(n.lp);
    n.lp.connect(air);
    air.connect(n.out);
    n.motors = [];
    for (let i = 0; i < 4; i++) {
      const o = k.osc('sawtooth', 120, S.propWave);
      o.detune.value = DRONE_DETUNE[i];
      const lfo = k.osc('sine', DRONE_DRIFT_RATE[i]);
      const depth = k.gain(DRONE_DRIFT_DEPTH[i]);
      lfo.connect(depth);
      depth.connect(o.detune);
      const mg = k.gain(0);
      o.connect(mg);
      mg.connect(mix);
      n.motors.push({ o: o, g: mg });
    }
    const src = k.loop(S.noise);
    n.bp = k.filter('bandpass', 900, 0.75);
    const chop = k.gain(0.55);
    n.chopOsc = k.osc('triangle', 300);
    const chopDepth = k.gain(0.45);
    n.chopOsc.connect(chopDepth);
    chopDepth.connect(chop.gain);
    n.wash = k.gain(0);
    src.connect(n.bp);
    n.bp.connect(chop);
    chop.connect(n.wash);
    n.wash.connect(air);
    n.r = [0, 0, 0, 0];
  }

  function applyDrone(v, n, t) {
    const s = v.state;
    const r = n.r;
    if (Array.isArray(s.rpm)) {
      for (let i = 0; i < 4; i++) r[i] = unit(num(s.rpm[i], 0));
    } else {
      const one = unit(num(s.rpm, 0));
      for (let i = 0; i < 4; i++) r[i] = one;
    }
    let avg = 0;
    for (let i = 0; i < 4; i++) {
      const ri = r[i];
      put(n, 'f' + i, n.motors[i].o.frequency, 70 + 430 * ri, t, 0.018);
      put(n, 'g' + i, n.motors[i].g.gain, 0.045 + 0.165 * Math.pow(ri, 1.25), t, 0.03);
      avg += ri;
    }
    avg /= 4;
    const load = unit(num(s.load, avg));
    const speed = Math.max(0, num(s.speed, 0));
    const fa = 70 + 430 * avg;
    put(n, 'lp', n.lp.frequency, 600 + 4800 * Math.pow(avg, 1.15) + 700 * load, t, 0.04);
    const drive = 1 + 2.6 * load * (0.35 + 0.65 * avg);
    put(n, 'dr', n.drive.gain, drive, t, 0.05);
    put(n, 'po', n.post.gain, 0.95 / (0.55 + 0.45 * drive), t, 0.05);
    put(n, 'bp', n.bp.frequency, 380 + fa * 4.05, t, 0.04);
    put(n, 'ch', n.chopOsc.frequency, fa * 3, t, 0.02);
    put(n, 'wa', n.wash.gain, 0.012 + 0.21 * load * (0.25 + 0.75 * avg) + 0.05 * unit(speed / 40), t, 0.05);
    put(n, 'vol', n.vol.gain, unit(num(s.volume, 1)), t, 0.05);
    if (n.pan) put(n, 'pan', n.pan.pan, within(num(s.pan, 0), -1, 1), t, 0.05);
  }

  function popAt(n, tp, level) {
    if (!n.popG) return;
    n.pbp.frequency.setValueAtTime(1300 + Math.random() * 2400, tp);
    n.popG.gain.setValueAtTime(0, tp);
    n.popG.gain.linearRampToValueAtTime(level, tp + 0.002);
    n.popG.gain.setTargetAtTime(0, tp + 0.003, 0.012 + Math.random() * 0.012);
    n.thumpG.gain.setValueAtTime(0, tp);
    n.thumpG.gain.linearRampToValueAtTime(level * 0.9, tp + 0.003);
    n.thumpG.gain.setTargetAtTime(0, tp + 0.004, 0.025);
  }

  function pops(n, t, count) {
    if (!n.popG) return;
    let tp = t + 0.03 + Math.random() * 0.05;
    for (let i = 0; i < count; i++) {
      popAt(n, tp, 0.16 + Math.random() * 0.22);
      tp += 0.045 + Math.random() * 0.13;
    }
  }

  function blowOff(n, t, amount) {
    if (!n.bovG) return;
    const level = 0.14 * unit(amount);
    n.bovF.frequency.setValueAtTime(3400, t);
    n.bovF.frequency.setTargetAtTime(1500, t, 0.18);
    n.bovG.gain.setValueAtTime(0, t);
    n.bovG.gain.linearRampToValueAtTime(level, t + 0.012);
    n.bovG.gain.setTargetAtTime(0, t + 0.06, 0.13);
  }

  function shiftAt(v, n, t, up) {
    n.cut.gain.setTargetAtTime(0.22, t, 0.01);
    n.cut.gain.setTargetAtTime(1, t + 0.075, 0.035);
    const dip = up ? -90 : 60;
    const oscs = [n.main, n.sub, n.quarter];
    for (let i = 0; i < oscs.length; i++) {
      oscs[i].detune.setTargetAtTime(dip, t, 0.012);
      oscs[i].detune.setTargetAtTime(0, t + 0.06, 0.04);
    }
    popAt(n, t + 0.012, 0.22);
    if (v.spec.turbo) blowOff(n, t, Math.max(0.35, n.spool));
  }

  function whoomp(n, t) {
    if (!n.whoompG) return;
    n.whoompG.gain.setValueAtTime(0, t);
    n.whoompG.gain.linearRampToValueAtTime(0.34, t + 0.035);
    n.whoompG.gain.setTargetAtTime(0, t + 0.06, 0.16);
    n.thumpG.gain.setValueAtTime(0, t);
    n.thumpG.gain.linearRampToValueAtTime(0.3, t + 0.01);
    n.thumpG.gain.setTargetAtTime(0, t + 0.02, 0.09);
  }

  function buildCar(v, n, k) {
    const sp = v.spec;
    n.out = k.gain(0);
    n.vol = k.gain(1);
    n.pan = k.pan();
    route(n, k, 'engine', 0.06);
    n.level = k.gain(0.4);
    n.cut = k.gain(1);
    n.pre = k.gain(1);
    const shaper = k.shaper(S.softCurve);
    n.post = k.gain(0.7);
    n.lp = k.filter('lowpass', 900, 0.75 + 0.6 * sp.tone);
    const body = k.filter('peaking', 100 + 30 * (sp.cylinders / 8), 1.1);
    body.gain.value = 4.5;
    const bite = k.filter('peaking', 1700 + 1400 * sp.tone, 1.3);
    bite.gain.value = 1.5 + 4.5 * sp.tone;
    const tame = k.filter('lowpass', 7000, 0.5);
    const hp = k.filter('highpass', 28, 0.7);
    n.main = k.osc('sawtooth', 50, engineWave(sp.cylinders, sp.tone));
    const mainG = k.gain(0.85);
    n.sub = k.osc('triangle', 25);
    n.subG = k.gain(0);
    n.quarter = k.osc('sine', 12);
    n.quarterG = k.gain(0);
    const jitterA = k.osc('sine', 5.3);
    const jitterB = k.osc('sine', 8.9);
    n.jitter = k.gain(6);
    jitterA.connect(n.jitter);
    jitterB.connect(n.jitter);
    n.jitter.connect(n.main.detune);
    n.jitter.connect(n.sub.detune);
    n.jitter.connect(n.quarter.detune);
    n.main.connect(mainG);
    mainG.connect(n.pre);
    n.sub.connect(n.subG);
    n.subG.connect(n.pre);
    n.quarter.connect(n.quarterG);
    n.quarterG.connect(n.pre);
    n.pre.connect(shaper);
    shaper.connect(n.post);
    n.post.connect(n.cut);
    n.cut.connect(n.lp);
    n.lp.connect(body);
    body.connect(bite);
    bite.connect(tame);
    tame.connect(hp);
    hp.connect(n.level);
    n.level.connect(n.out);
    const noise = k.loop(S.noise);
    n.nbp = k.filter('bandpass', 400, 1.1);
    const am = k.gain(0.5);
    const amDepth = k.gain(0.5);
    n.main.connect(amDepth);
    amDepth.connect(am.gain);
    n.nlev = k.gain(0);
    noise.connect(n.nbp);
    n.nbp.connect(am);
    am.connect(n.nlev);
    n.nlev.connect(n.cut);
    n.spool = 0;
    n.prevTh = 0;
    n.gear = null;
    n.nitroOn = false;
    if (sp.lite) return;
    n.pbp = k.filter('bandpass', 2000, 0.9);
    n.popG = k.gain(0);
    noise.connect(n.pbp);
    n.pbp.connect(n.popG);
    n.popG.connect(n.out);
    const thump = k.osc('sine', 62);
    n.thumpG = k.gain(0);
    thump.connect(n.thumpG);
    n.thumpG.connect(n.out);
    if (sp.turbo) {
      n.tw = k.osc('sine', 1800);
      n.twG = k.gain(0);
      n.tw.connect(n.twG);
      n.twG.connect(n.out);
      n.bovF = k.filter('highpass', 2600, 0.8);
      n.bovG = k.gain(0);
      noise.connect(n.bovF);
      n.bovF.connect(n.bovG);
      n.bovG.connect(n.out);
    }
    const pink = k.loop(S.pink);
    n.nbp2 = k.filter('bandpass', 500, 0.85);
    n.nitroG = k.gain(0);
    n.whoompG = k.gain(0);
    pink.connect(n.nbp2);
    n.nbp2.connect(n.nitroG);
    n.nbp2.connect(n.whoompG);
    n.nitroG.connect(n.out);
    n.whoompG.connect(n.out);
    const rumble = k.osc('sine', 46);
    n.rumG = k.gain(0);
    rumble.connect(n.rumG);
    n.rumG.connect(n.out);
    n.sbp = k.filter('bandpass', 1100, 7);
    n.sqN = k.gain(0);
    noise.connect(n.sbp);
    n.sbp.connect(n.sqN);
    n.sqN.connect(n.out);
    n.so = k.osc('sine', 1000);
    n.so2 = k.osc('sine', 1530);
    const vib = k.osc('sine', 6.3);
    const vibA = k.gain(24);
    const vibB = k.gain(36);
    vib.connect(vibA);
    vib.connect(vibB);
    vibA.connect(n.so.frequency);
    vibB.connect(n.so2.frequency);
    n.sqT = k.gain(0);
    const so2G = k.gain(0.35);
    n.so.connect(n.sqT);
    n.so2.connect(so2G);
    so2G.connect(n.sqT);
    n.sqT.connect(n.out);
    const slp = k.filter('lowpass', 520, 0.7);
    n.scrubG = k.gain(0);
    noise.connect(slp);
    slp.connect(n.scrubG);
    n.scrubG.connect(n.out);
  }

  function applyCar(v, n, t) {
    const s = v.state;
    const sp = v.spec;
    const r = unit(num(s.rpm, 0));
    const th = unit(num(s.throttle, 0));
    const nit = unit(num(s.nitro, 0));
    const sk = unit(num(s.skid, 0));
    const rpmAbs = sp.idleRpm + r * (sp.redlineRpm - sp.idleRpm);
    const ff = (rpmAbs / 60) * sp.cylinders / 2;
    const dt = n.prevT >= 0 ? within(t - n.prevT, 0, 0.25) : 0;
    n.prevT = t;
    put(n, 'f', n.main.frequency, ff, t, 0.025);
    put(n, 'fs', n.sub.frequency, ff / 2, t, 0.025);
    put(n, 'fq', n.quarter.frequency, ff / 4, t, 0.025);
    const subBase = sp.cylinders === 8 ? 0.34 : sp.cylinders <= 6 ? 0.15 : 0.08;
    put(n, 'sg', n.subG.gain, subBase * (1 - 0.55 * r), t, 0.1);
    put(n, 'qg', n.quarterG.gain, (sp.cylinders === 8 ? 0.18 : 0.03) * Math.pow(1 - r, 1.5), t, 0.1);
    const drive = 1 + (0.5 + 2.8 * th) * (0.55 + 0.9 * sp.tone);
    put(n, 'dr', n.pre.gain, drive, t, 0.06);
    put(n, 'po', n.post.gain, 0.8 / (0.5 + 0.5 * drive), t, 0.06);
    put(n, 'lp', n.lp.frequency, within(ff * (1.6 + 3.2 * th) + 200 + 1200 * th * r, 150, 9000), t, 0.05);
    put(n, 'lv', n.level.gain, 0.3 + 0.36 * th + 0.18 * r, t, 0.06);
    put(n, 'nb', n.nbp.frequency, within(ff * 3.4 + 280, 200, 9000), t, 0.04);
    put(n, 'nl', n.nlev.gain, 0.03 + 0.16 * th * (0.3 + 0.7 * r), t, 0.06);
    put(n, 'jt', n.jitter.gain, 2 + 13 * (1 - r) * (1 - r) * (1 - 0.6 * th), t, 0.2);
    put(n, 'vol', n.vol.gain, unit(num(s.volume, 1)) * sp.volume, t, 0.05);
    if (n.pan) put(n, 'pan', n.pan.pan, within(num(s.pan, 0), -1, 1), t, 0.05);
    const spoolTarget = Math.pow(r * th, 1.2);
    if (dt > 0) n.spool += (spoolTarget - n.spool) * (1 - Math.exp(-dt / (spoolTarget > n.spool ? 0.5 : 0.25)));
    if (isNum(s.gear)) {
      if (n.gear !== null && s.gear !== n.gear && !n.first) shiftAt(v, n, t, s.gear > n.gear);
      n.gear = s.gear;
    }
    if (sp.lite) {
      n.prevTh = th;
      return;
    }
    if (n.tw) {
      put(n, 'tw', n.tw.frequency, 1200 + 3800 * n.spool + 600 * r, t, 0.05);
      put(n, 'twg', n.twG.gain, 0.022 * n.spool * n.spool * (0.4 + 0.6 * th), t, 0.08);
    }
    if (!n.first) {
      if (n.prevTh > 0.5 && th < 0.2) {
        if (r > 0.4) pops(n, t, 2 + Math.round(r * 5));
        if (n.bovG && n.spool > 0.2) blowOff(n, t, n.spool);
      } else if (th < 0.12 && r > 0.5 && dt > 0 && Math.random() < dt * 2.5 * r) {
        pops(n, t, 1);
      }
    }
    n.prevTh = th;
    const nitroOn = nit > 0.05;
    if (nitroOn && !n.nitroOn && !n.first) whoomp(n, t);
    n.nitroOn = nitroOn;
    put(n, 'ng', n.nitroG.gain, 0.17 * nit, t, nitroOn ? 0.12 : 0.18);
    put(n, 'nf', n.nbp2.frequency, 420 + 1100 * nit * (0.45 + 0.55 * r), t, 0.15);
    put(n, 'rg', n.rumG.gain, 0.1 * nit, t, 0.15);
    const sq = Math.pow(sk, 1.5);
    put(n, 'sn', n.sqN.gain, 0.12 * sq, t, 0.04);
    put(n, 'st', n.sqT.gain, 0.045 * sq, t, 0.04);
    put(n, 'sf', n.sbp.frequency, 900 + 480 * sk, t, 0.08);
    put(n, 'so', n.so.frequency, 930 + 300 * sk, t, 0.1);
    put(n, 'so2', n.so2.frequency, 1420 + 420 * sk, t, 0.1);
    put(n, 'sc', n.scrubG.gain, 0.09 * sk * sk, t, 0.05);
  }

  function buildWind(v, n, k) {
    n.out = k.gain(0);
    n.vol = k.gain(1);
    n.pan = k.pan();
    route(n, k, 'engine', 0);
    const src = k.loop(S.pinkStereo);
    const whistleSrc = k.loop(S.noise);
    const hp = k.filter('highpass', 70, 0.6);
    n.lp = k.filter('lowpass', 300, 0.6);
    n.body = k.gain(0);
    const gust = k.gain(0.8);
    const lfoA = k.osc('sine', 0.13);
    const lfoAG = k.gain(0.16);
    const lfoB = k.osc('sine', 0.41);
    const lfoBG = k.gain(0.08);
    lfoA.connect(lfoAG);
    lfoAG.connect(gust.gain);
    lfoB.connect(lfoBG);
    lfoBG.connect(gust.gain);
    src.connect(hp);
    hp.connect(n.lp);
    n.lp.connect(n.body);
    n.body.connect(gust);
    gust.connect(n.out);
    n.wbp = k.filter('bandpass', 2000, 8);
    n.whistle = k.gain(0);
    whistleSrc.connect(n.wbp);
    n.wbp.connect(n.whistle);
    n.whistle.connect(gust);
  }

  function applyWind(v, n, t) {
    const s = v.state;
    const k = unit(Math.max(0, num(s.speed, 0)) / 55);
    put(n, 'lp', n.lp.frequency, 250 + 3800 * Math.pow(k, 1.3), t, 0.08);
    put(n, 'bd', n.body.gain, 0.34 * Math.pow(k, 1.5), t, 0.08);
    put(n, 'wh', n.whistle.gain, 0.012 * k * k, t, 0.1);
    put(n, 'wf', n.wbp.frequency, 1100 + 1300 * k, t, 0.1);
    put(n, 'vol', n.vol.gain, unit(num(s.volume, 1)), t, 0.05);
    if (n.pan) put(n, 'pan', n.pan.pan, within(num(s.pan, 0), -1, 1), t, 0.05);
  }

  function droneMotors(o) {
    const p = o && typeof o === 'object' ? o : {};
    return makeVoice({ rpm: 0, load: 0, speed: 0, volume: unit(num(p.volume, 1)), pan: 0 }, {}, buildDrone, applyDrone, null);
  }

  function carEngine(spec) {
    const p = spec && typeof spec === 'object' ? spec : {};
    const idle = within(num(p.idleRpm, 900), 300, 3000);
    const sp = {
      cylinders: nearestCylinders(p.cylinders),
      idleRpm: idle,
      redlineRpm: Math.max(idle + 500, within(num(p.redlineRpm, 7800), 1500, 20000)),
      turbo: !!p.turbo,
      tone: unit(num(p.tone, 0.5)),
      volume: unit(num(p.volume, 1)),
      lite: !!p.lite
    };
    return makeVoice(
      { rpm: 0, throttle: 0, nitro: 0, skid: 0, volume: 1, pan: 0 },
      sp,
      buildCar,
      applyCar,
      function (api, v) {
        api.shift = function (up) {
          if (!v.n || !S.ctx || v.dead) return api;
          try {
            shiftAt(v, v.n, S.ctx.currentTime, up !== false);
          } catch (_) {}
          return api;
        };
      }
    );
  }

  function wind() {
    return makeVoice({ speed: 0, volume: 1, pan: 0 }, {}, buildWind, applyWind, null);
  }

  function newBag() {
    return { nodes: [], last: null, lastEnd: 0 };
  }

  function bagSource(b, src, end) {
    b.nodes.push(src);
    if (end >= b.lastEnd) {
      b.lastEnd = end;
      b.last = src;
    }
  }

  function bagClose(b) {
    if (!b.last) return;
    const list = b.nodes;
    b.last.onended = function () {
      for (let i = 0; i < list.length; i++) {
        try {
          list[i].disconnect();
        } catch (_) {}
      }
    };
  }

  function shotOut(b, busName, wet, pan, volume) {
    const out = gainNode(volume);
    b.nodes.push(out);
    let tail = out;
    if (isNum(pan) && pan !== 0 && typeof S.ctx.createStereoPanner === 'function') {
      const p = S.ctx.createStereoPanner();
      p.pan.value = within(pan, -1, 1);
      out.connect(p);
      b.nodes.push(p);
      tail = p;
    }
    const bus = S.buses[busName] || S.buses.sfx;
    tail.connect(bus.dry);
    if (wet > 0) {
      const w = gainNode(wet);
      tail.connect(w);
      w.connect(bus.wet);
      b.nodes.push(w);
    }
    return out;
  }

  function shape(param, t0, level, attack, hold, decay) {
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(level, t0 + attack);
    if (hold > 0) param.setValueAtTime(level, t0 + attack + hold);
    param.setTargetAtTime(0, t0 + attack + hold, decay / 4.5);
    return t0 + attack + hold + decay * 1.3 + 0.05;
  }

  function tone(b, out, t0, o) {
    const x = S.ctx.createOscillator();
    x.type = o.type || 'sine';
    const f0 = Math.max(20, num(o.f, 440));
    x.frequency.setValueAtTime(f0, t0);
    if (isNum(o.fTo)) x.frequency.exponentialRampToValueAtTime(Math.max(20, o.fTo), t0 + num(o.fTime, 0.1));
    if (isNum(o.detune)) x.detune.value = o.detune;
    const e = gainNode(0);
    const end = shape(e.gain, t0, num(o.level, 0.1), Math.max(0.001, num(o.attack, 0.004)), Math.max(0, num(o.hold, 0)), Math.max(0.01, num(o.decay, 0.2)));
    x.connect(e);
    let tail = e;
    if (isNum(o.lp)) {
      const f = filterNode('lowpass', o.lp, num(o.lpq, 0.8));
      e.connect(f);
      b.nodes.push(f);
      tail = f;
    }
    tail.connect(out);
    b.nodes.push(e);
    x.start(t0);
    x.stop(end);
    bagSource(b, x, end);
  }

  function hiss(b, out, t0, o) {
    const s = S.ctx.createBufferSource();
    s.buffer = o.buf || S.noise;
    if (isNum(o.rate)) s.playbackRate.value = o.rate;
    const f0 = Math.max(30, num(o.f, 1000));
    const f = filterNode(o.type || 'bandpass', f0, num(o.q, 1));
    if (isNum(o.sweepTo)) {
      f.frequency.setValueAtTime(f0, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(30, o.sweepTo), t0 + num(o.sweepTime, 0.2));
    }
    const e = gainNode(0);
    const end = shape(e.gain, t0, num(o.level, 0.1), Math.max(0.001, num(o.attack, 0.002)), Math.max(0, num(o.hold, 0)), Math.max(0.01, num(o.decay, 0.1)));
    s.connect(f);
    f.connect(e);
    e.connect(out);
    b.nodes.push(f, e);
    const span = s.buffer.duration - (end - t0) - 0.05;
    s.start(t0, span > 0 ? Math.random() * span : 0);
    s.stop(end);
    bagSource(b, s, end);
  }

  function bell(b, out, t0, f, level, decay) {
    tone(b, out, t0, { f: f, level: level, attack: 0.002, decay: decay });
    tone(b, out, t0, { f: f * 2, level: level * 0.32, attack: 0.002, decay: decay * 0.55 });
    tone(b, out, t0, { f: f * 3, level: level * 0.12, attack: 0.002, decay: decay * 0.3 });
    tone(b, out, t0, { f: f * 4.16, level: level * 0.06, attack: 0.001, decay: decay * 0.18 });
  }

  function brass(b, out, t0, f, hold, level) {
    const lpf = filterNode('lowpass', 700, 1.2);
    lpf.frequency.setValueAtTime(600, t0);
    lpf.frequency.linearRampToValueAtTime(3400, t0 + 0.04);
    lpf.frequency.setTargetAtTime(1500, t0 + 0.05, 0.12);
    lpf.connect(out);
    b.nodes.push(lpf);
    tone(b, lpf, t0, { type: 'sawtooth', f: f, level: level, attack: 0.018, hold: hold, decay: 0.35 });
    tone(b, lpf, t0, { type: 'sawtooth', f: f, detune: 8, level: level * 0.7, attack: 0.022, hold: hold, decay: 0.35 });
  }

  function scrapeShot(b, out, t, i) {
    const dur = 0.16 + 0.4 * i;
    const level = 0.2 * (0.4 + 0.6 * i);
    const s = S.ctx.createBufferSource();
    s.buffer = S.noise;
    const bandA = filterNode('bandpass', 3300, 2.4);
    bandA.frequency.setValueAtTime(3300, t);
    bandA.frequency.linearRampToValueAtTime(2500, t + dur);
    const am = gainNode(0.5);
    const lfo = S.ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 38 + 30 * Math.random();
    const lfoG = gainNode(0.5);
    lfo.connect(lfoG);
    lfoG.connect(am.gain);
    const e = gainNode(0);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(level, t + 0.012);
    e.gain.setValueAtTime(level, t + dur);
    e.gain.setTargetAtTime(0, t + dur, 0.04);
    s.connect(bandA);
    bandA.connect(am);
    am.connect(e);
    e.connect(out);
    const bandB = filterNode('bandpass', 5600, 4);
    const e2 = gainNode(0);
    e2.gain.setValueAtTime(0, t);
    e2.gain.linearRampToValueAtTime(level * 0.35, t + 0.02);
    e2.gain.setValueAtTime(level * 0.35, t + dur);
    e2.gain.setTargetAtTime(0, t + dur, 0.03);
    s.connect(bandB);
    bandB.connect(e2);
    e2.connect(out);
    const end = t + dur + 0.25;
    b.nodes.push(bandA, am, lfoG, e, bandB, e2, lfo);
    s.start(t, Math.random() * Math.max(0, S.noise.duration - dur - 0.3));
    s.stop(end);
    lfo.start(t);
    lfo.stop(end);
    bagSource(b, s, end);
  }

  function uiShot(b, out, t, p) {
    const kind = p.kind || 'move';
    if (kind === 'select') {
      tone(b, out, t, { f: 659.25, level: 0.07, attack: 0.002, decay: 0.07 });
      tone(b, out, t + 0.055, { f: 987.77, level: 0.08, attack: 0.002, decay: 0.16 });
      tone(b, out, t + 0.055, { type: 'triangle', f: 1975.53, level: 0.012, attack: 0.002, decay: 0.08 });
    } else if (kind === 'back') {
      tone(b, out, t, { f: 987.77, level: 0.065, attack: 0.002, decay: 0.07 });
      tone(b, out, t + 0.055, { f: 659.25, level: 0.07, attack: 0.002, decay: 0.14 });
    } else if (kind === 'toggle') {
      tone(b, out, t, { f: 880, level: 0.06, attack: 0.002, decay: 0.06 });
      hiss(b, out, t, { type: 'highpass', f: 6000, q: 0.7, level: 0.03, attack: 0.001, decay: 0.02 });
    } else if (kind === 'error') {
      tone(b, out, t, { type: 'square', f: 98, level: 0.06, attack: 0.003, hold: 0.05, decay: 0.05, lp: 700 });
      tone(b, out, t + 0.11, { type: 'square', f: 92, level: 0.06, attack: 0.003, hold: 0.05, decay: 0.06, lp: 700 });
    } else {
      const idx = Math.abs(Math.round(num(p.index, 0))) % 10;
      const semis = PENTATONIC[idx % 5] + 12 * Math.floor(idx / 5);
      const f = 587.33 * Math.pow(2, semis / 12);
      tone(b, out, t, { f: f, level: 0.055, attack: 0.002, decay: 0.09 });
      tone(b, out, t, { type: 'triangle', f: f * 2, level: 0.012, attack: 0.002, decay: 0.05 });
    }
  }

  function medalShot(b, out, t, medal) {
    if (medal === 'gold') {
      tone(b, out, t, { type: 'triangle', f: 220, level: 0.05, attack: 0.02, hold: 0.3, decay: 0.6 });
      bell(b, out, t, 440, 0.09, 0.3);
      bell(b, out, t + 0.1, 554.37, 0.09, 0.3);
      bell(b, out, t + 0.2, 659.25, 0.1, 0.35);
      bell(b, out, t + 0.3, 880, 0.12, 1.1);
      tone(b, out, t + 0.42, { f: 1760, level: 0.05, attack: 0.003, decay: 0.4 });
      tone(b, out, t + 0.33, { f: 1318.51, level: 0.025, attack: 0.16, hold: 0.12, decay: 0.5 });
      hiss(b, out, t + 0.42, { type: 'highpass', f: 6400, q: 0.7, level: 0.025, attack: 0.002, decay: 0.2 });
    } else if (medal === 'silver') {
      bell(b, out, t, 440, 0.09, 0.3);
      bell(b, out, t + 0.12, 659.25, 0.1, 0.32);
      bell(b, out, t + 0.24, 880, 0.11, 0.9);
      hiss(b, out, t + 0.24, { type: 'bandpass', f: 3600, sweepTo: 7000, sweepTime: 0.4, q: 1.1, level: 0.016, attack: 0.17, hold: 0.05, decay: 0.36 });
    } else {
      bell(b, out, t, 440, 0.09, 0.3);
      bell(b, out, t + 0.14, 659.25, 0.1, 0.7);
    }
  }

  function play(name, o) {
    if (!S.ctx || !S.buses || S.disposed) return false;
    const p = o && typeof o === 'object' ? o : {};
    const vol = unit(num(p.volume, 1));
    const pan = num(p.pan, 0);
    const i = unit(num(p.intensity, 0.7));
    const b = newBag();
    try {
      const t = S.ctx.currentTime + 0.005;
      if (name === 'gate') {
        const out = shotOut(b, 'sfx', 0.28, pan, vol);
        bell(b, out, t, 1318.51, 0.12, 0.35);
        bell(b, out, t + 0.07, 1975.53, 0.13, 0.7);
        hiss(b, out, t + 0.07, { type: 'highpass', f: 6500, q: 0.7, level: 0.045, attack: 0.002, decay: 0.16 });
        tone(b, out, t + 0.1, { f: 3951.07, level: 0.02, attack: 0.001, decay: 0.12 });
        tone(b, out, t + 0.14, { f: 5274.04, level: 0.014, attack: 0.001, decay: 0.1 });
      } else if (name === 'checkpoint') {
        const out = shotOut(b, 'sfx', 0.24, pan, vol);
        bell(b, out, t, 1046.5, 0.11, 0.3);
        bell(b, out, t + 0.07, 1567.98, 0.11, 0.5);
        hiss(b, out, t + 0.07, { type: 'highpass', f: 5200, q: 0.7, level: 0.025, attack: 0.002, decay: 0.12 });
      } else if (name === 'lap') {
        const out = shotOut(b, 'sfx', 0.3, pan, vol);
        bell(b, out, t, 783.99, 0.1, 0.3);
        bell(b, out, t + 0.09, 987.77, 0.1, 0.3);
        bell(b, out, t + 0.18, 1174.66, 0.12, 0.8);
        tone(b, out, t + 0.18, { type: 'triangle', f: 587.33, level: 0.04, attack: 0.02, hold: 0.15, decay: 0.6 });
      } else if (name === 'countdown') {
        const out = shotOut(b, 'sfx', 0.12, pan, vol);
        tone(b, out, t, { f: 880, level: 0.17, attack: 0.003, hold: 0.07, decay: 0.12 });
        tone(b, out, t, { type: 'triangle', f: 1760, level: 0.025, attack: 0.003, hold: 0.05, decay: 0.08 });
      } else if (name === 'go') {
        const out = shotOut(b, 'sfx', 0.3, pan, vol);
        tone(b, out, t, { f: 1760, level: 0.15, attack: 0.003, hold: 0.25, decay: 0.45 });
        tone(b, out, t, { type: 'triangle', f: 880, level: 0.06, attack: 0.01, hold: 0.25, decay: 0.6 });
        tone(b, out, t, { type: 'triangle', f: 1108.73, level: 0.045, attack: 0.012, hold: 0.25, decay: 0.6 });
        tone(b, out, t, { type: 'triangle', f: 1318.51, level: 0.045, attack: 0.014, hold: 0.25, decay: 0.6 });
        hiss(b, out, t, { buf: S.pink, f: 900, sweepTo: 3600, sweepTime: 0.4, q: 0.9, level: 0.05, attack: 0.05, decay: 0.4 });
      } else if (name === 'finish') {
        const out = shotOut(b, 'sfx', 0.32, pan, vol);
        const notes = [523.25, 659.25, 783.99, 1046.5];
        for (let k = 0; k < notes.length; k++) brass(b, out, t + k * 0.11, notes[k], k === 3 ? 0.7 : 0.06, 0.07);
        brass(b, out, t + 0.33, 523.25, 0.6, 0.035);
        brass(b, out, t + 0.33, 659.25, 0.6, 0.03);
        brass(b, out, t + 0.33, 783.99, 0.6, 0.03);
        hiss(b, out, t + 0.33, { type: 'highpass', f: 6000, q: 0.7, level: 0.03, attack: 0.01, hold: 0.1, decay: 0.4 });
      } else if (name === 'crash') {
        const out = shotOut(b, 'sfx', 0.22, pan, vol);
        const k = 0.35 + 0.65 * i;
        tone(b, out, t, { f: 95, fTo: 36, fTime: 0.25, level: 0.5 * k, attack: 0.002, decay: 0.3 });
        hiss(b, out, t, { type: 'lowpass', f: 3200, sweepTo: 260, sweepTime: 0.45, q: 0.8, level: 0.42 * k, attack: 0.002, decay: 0.5 });
        hiss(b, out, t, { type: 'bandpass', f: 140, q: 0.9, level: 0.3 * k, attack: 0.002, decay: 0.2 });
        const count = 3 + Math.round(4 * i);
        for (let j = 0; j < count; j++) {
          const tj = t + 0.02 + Math.random() * 0.28;
          const f = 1900 + Math.random() * 3600;
          hiss(b, out, tj, { f: f, q: 9, level: (0.1 + 0.08 * Math.random()) * k, attack: 0.001, decay: 0.07 });
          tone(b, out, tj, { f: f * 0.5, level: 0.03 * k, attack: 0.001, decay: 0.16 });
          tone(b, out, tj, { f: f * 0.73, level: 0.02 * k, attack: 0.001, decay: 0.12 });
        }
      } else if (name === 'scrape') {
        const out = shotOut(b, 'sfx', 0.12, pan, vol);
        scrapeShot(b, out, t, i);
      } else if (name === 'boost') {
        const out = shotOut(b, 'sfx', 0.2, pan, vol);
        hiss(b, out, t, { buf: S.pink, f: 260, sweepTo: 3400, sweepTime: 0.55, q: 1.3, level: 0.26, attack: 0.09, hold: 0.25, decay: 0.45 });
        tone(b, out, t, { type: 'sawtooth', f: 70, fTo: 190, fTime: 0.5, level: 0.07, attack: 0.05, hold: 0.2, decay: 0.4, lp: 600 });
        hiss(b, out, t + 0.05, { type: 'highpass', f: 4500, q: 0.7, level: 0.035, attack: 0.1, hold: 0.15, decay: 0.3 });
      } else if (name === 'medal') {
        const out = shotOut(b, 'sfx', 0.36, pan, vol);
        medalShot(b, out, t, p.medal);
      } else if (name === 'ui') {
        const out = shotOut(b, 'ui', 0.1, pan, vol);
        uiShot(b, out, t, p);
      } else {
        return false;
      }
    } catch (_) {
      bagClose(b);
      return false;
    }
    bagClose(b);
    return true;
  }

  function dispose() {
    if (S.disposed) return;
    S.voices.forEach(function (v) {
      try {
        v.dead = true;
        if (v.n) {
          for (let i = 0; i < v.n.sources.length; i++) {
            try {
              v.n.sources[i].stop();
            } catch (_) {}
          }
          for (let i = 0; i < v.n.all.length; i++) {
            try {
              v.n.all[i].disconnect();
            } catch (_) {}
          }
        }
        v.n = null;
      } catch (_) {}
    });
    S.voices.clear();
    unwatch();
    S.disposed = true;
    if (S.ctx && S.owned) {
      try {
        const p = S.ctx.close();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (_) {}
    }
  }

  const api = {
    get context() {
      return S.ctx;
    },
    get unlocked() {
      return !!S.ctx && !S.disposed && (S.offline || S.ctx.state === 'running');
    },
    get muted() {
      return S.muted;
    },
    get master() {
      return S.levels.master;
    },
    unlock: unlock,
    setMaster: setMaster,
    setMuted: setMuted,
    setLevels: setLevels,
    droneMotors: droneMotors,
    carEngine: carEngine,
    wind: wind,
    play: play,
    dispose: dispose
  };

  if (options.context) unlock();
  return api;
}
