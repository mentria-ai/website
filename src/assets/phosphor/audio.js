export function createAudio() {
  const S = {
    ctx: null,
    master: null,
    limiter: null,
    sfxBus: null,
    ambBus: null,
    conv: null,
    convIn: null,
    convOut: null,
    nz: null,
    nzS: null,
    voices: [],
    amb: null,
    ambOn: false,
    lastSpeed: -1,
    levels: { master: 0.9, sfx: 1, ambient: 1 },
    listener: { pos: [0, 0, 0], yaw: 0, speed01: 0 }
  };

  const rnd = Math.random;

  function num(v, d) {
    return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity ? v : d;
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function jit(a) {
    return 1 + (rnd() * 2 - 1) * a;
  }

  function gain(v) {
    const g = S.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  function filt(type, freq, q) {
    const f = S.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }

  function src(buf, loop) {
    const s = S.ctx.createBufferSource();
    s.buffer = buf || S.nz;
    s.loop = !!loop;
    return s;
  }

  function env(param, t0, peak, attack, decay) {
    const p = Math.max(0.0004, num(peak, 0.1));
    const a = Math.max(0.0003, num(attack, 0.001));
    const d = Math.max(0.005, num(decay, 0.05));
    param.cancelScheduledValues(t0);
    param.setValueAtTime(0.0002, t0);
    param.linearRampToValueAtTime(p, t0 + a);
    param.exponentialRampToValueAtTime(0.0004, t0 + a + d);
    param.setValueAtTime(0, t0 + a + d + 0.004);
  }

  function ramp(param, v, secs) {
    const t = S.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(v, t + secs);
  }

  function makeNoise(seconds, channels) {
    const sr = S.ctx.sampleRate;
    const n = Math.max(1024, Math.floor(sr * seconds));
    const b = S.ctx.createBuffer(channels, n, sr);
    for (let c = 0; c < channels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    }
    return b;
  }

  function makeImpulse(seconds, decay) {
    const sr = S.ctx.sampleRate;
    const n = Math.max(1024, Math.floor(sr * seconds));
    const b = S.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      const pre = Math.floor(sr * (c ? 0.0068 : 0.0041));
      const dk = decay * (c ? 1.07 : 0.96);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        if (i < pre) {
          d[i] = 0;
          continue;
        }
        const t = (i - pre) / sr;
        const shape = Math.max(0, 1 - t / seconds);
        const e = shape * shape * Math.exp(-t * dk);
        const k = 0.86 - Math.min(0.62, t * 0.58);
        lp = lp + (rnd() * 2 - 1 - lp) * k;
        d[i] = lp * e;
      }
      for (let r = 0; r < 8; r++) {
        const idx = pre + Math.floor(sr * (0.007 + rnd() * 0.058));
        if (idx < n) d[idx] += (rnd() * 2 - 1) * 0.55 * (1 - r / 9);
      }
    }
    return b;
  }

  function makeVoice() {
    const v = {
      last: 0,
      busyUntil: 0,
      srcs: [],
      mix: gain(1),
      out: gain(1),
      wet: gain(0.16),
      tailWet: gain(0.85),
      subG: gain(0),
      crackBP: filt('bandpass', 4200, 1.15),
      crackG: gain(0),
      bodyBP: filt('bandpass', 250, 1.4),
      bodyLP: filt('lowpass', 900, 0.9),
      bodyG: gain(0),
      tailLP: filt('lowpass', 1600, 0.85),
      tailHP: filt('highpass', 130, 0.7),
      tailG: gain(0)
    };
    v.pan = S.ctx.createStereoPanner ? S.ctx.createStereoPanner() : null;
    v.out.connect(S.sfxBus);
    v.wet.connect(S.convIn);
    v.tailWet.connect(S.convIn);
    if (v.pan) {
      v.mix.connect(v.pan);
      v.pan.connect(v.out);
      v.pan.connect(v.wet);
    } else {
      v.mix.connect(v.out);
      v.mix.connect(v.wet);
    }
    v.subG.connect(v.mix);
    v.crackBP.connect(v.crackG);
    v.crackG.connect(v.mix);
    v.bodyBP.connect(v.bodyLP);
    v.bodyLP.connect(v.bodyG);
    v.bodyG.connect(v.mix);
    v.tailHP.connect(v.tailLP);
    v.tailLP.connect(v.tailG);
    v.tailG.connect(v.mix);
    v.tailG.connect(v.tailWet);
    return v;
  }

  function buildAmbient() {
    const a = {};
    a.bed = gain(0.0002);
    a.bed.connect(S.ambBus);

    a.wSrc = src(S.nzS, true);
    a.wHp = filt('highpass', 70, 0.5);
    a.wLp = filt('lowpass', 430, 0.55);
    a.wG = gain(0.85);
    a.wSrc.connect(a.wHp);
    a.wHp.connect(a.wLp);
    a.wLp.connect(a.wG);
    a.wG.connect(a.bed);
    a.wLfo = S.ctx.createOscillator();
    a.wLfo.frequency.value = 0.071;
    a.wLfoG = gain(155);
    a.wLfo.connect(a.wLfoG);
    a.wLfoG.connect(a.wLp.frequency);

    a.rSrc = src(S.nzS, true);
    a.rSrc.playbackRate.value = 0.82;
    a.rLp = filt('lowpass', 98, 0.9);
    a.rA = gain(0.5);
    a.rB = gain(0.5);
    a.rG = gain(0.75);
    a.rSrc.connect(a.rLp);
    a.rLp.connect(a.rA);
    a.rA.connect(a.rB);
    a.rB.connect(a.rG);
    a.rG.connect(a.bed);
    a.rLfoA = S.ctx.createOscillator();
    a.rLfoA.frequency.value = 0.0434;
    a.rLfoAG = gain(0.5);
    a.rLfoA.connect(a.rLfoAG);
    a.rLfoAG.connect(a.rA.gain);
    a.rLfoB = S.ctx.createOscillator();
    a.rLfoB.frequency.value = 0.0163;
    a.rLfoBG = gain(0.5);
    a.rLfoB.connect(a.rLfoBG);
    a.rLfoBG.connect(a.rB.gain);

    a.mSrc = src(S.nzS, true);
    a.mBp = filt('bandpass', 560, 0.7);
    a.mG = gain(0.0002);
    a.mSrc.connect(a.mBp);
    a.mBp.connect(a.mG);
    a.mG.connect(S.ambBus);

    const t = S.ctx.currentTime;
    a.wSrc.start(t);
    a.rSrc.start(t);
    a.mSrc.start(t);
    a.wLfo.start(t);
    a.rLfoA.start(t);
    a.rLfoB.start(t + 3.1);
    return a;
  }

  function build() {
    S.master = gain(S.levels.master * 0.9);
    S.limiter = S.ctx.createDynamicsCompressor();
    S.limiter.threshold.value = -7;
    S.limiter.knee.value = 5;
    S.limiter.ratio.value = 6;
    S.limiter.attack.value = 0.004;
    S.limiter.release.value = 0.17;
    S.master.connect(S.limiter);
    S.limiter.connect(S.ctx.destination);

    S.sfxBus = gain(S.levels.sfx);
    S.sfxBus.connect(S.master);
    S.ambBus = gain(S.levels.ambient);
    S.ambBus.connect(S.master);

    S.nz = makeNoise(1.7, 1);
    S.nzS = makeNoise(4.2, 2);

    S.conv = S.ctx.createConvolver();
    S.conv.normalize = true;
    S.conv.buffer = makeImpulse(1.1, 5.2);
    S.convIn = gain(1);
    S.convOut = gain(0.85);
    S.convIn.connect(S.conv);
    S.conv.connect(S.convOut);
    S.convOut.connect(S.sfxBus);

    for (let i = 0; i < 8; i++) S.voices.push(makeVoice());
    S.amb = buildAmbient();
  }

  function noiseHit(t0, o) {
    const s = src(o.buf, false);
    if (o.rate) s.playbackRate.value = o.rate;
    const dur = Math.max(0.008, num(o.dur, 0.05));
    const f = filt(o.type || 'bandpass', Math.max(30, num(o.f, 1000)), o.q === undefined ? 1 : o.q);
    if (o.sweepTo) {
      f.frequency.setValueAtTime(Math.max(30, num(o.f, 1000)), t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(30, o.sweepTo), t0 + (o.sweepTime || dur));
    }
    const g = gain(0.0002);
    env(g.gain, t0, o.level, o.attack, dur);
    s.connect(f);
    f.connect(g);
    g.connect(S.sfxBus);
    if (o.wet) {
      const w = gain(o.wet);
      g.connect(w);
      w.connect(S.convIn);
    }
    const bd = s.buffer ? s.buffer.duration : 1;
    const span = bd - Math.min(bd * 0.5, dur * 1.7 + 0.12);
    s.start(t0, span > 0 ? rnd() * span : 0);
    s.stop(t0 + dur + 0.1);
  }

  function toneHit(t0, o) {
    const osc = S.ctx.createOscillator();
    osc.type = o.type || 'sine';
    const dur = Math.max(0.008, num(o.dur, 0.05));
    const f0 = Math.max(20, num(o.f, 200));
    osc.frequency.setValueAtTime(f0, t0);
    if (o.fTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.fTo), t0 + (o.fTime || dur));
    const g = gain(0.0002);
    env(g.gain, t0, o.level, o.attack === undefined ? 0.002 : o.attack, dur);
    osc.connect(g);
    let out = g;
    if (o.lp) {
      const lp = filt('lowpass', o.lp, o.lpq || 0.9);
      g.connect(lp);
      out = lp;
    }
    out.connect(S.sfxBus);
    if (o.wet) {
      const w = gain(o.wet);
      out.connect(w);
      w.connect(S.convIn);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  function swellEnv(param, t0, level, attack, hold, release) {
    const l = Math.max(0.0004, num(level, 0.06));
    const a = Math.max(0.004, num(attack, 0.04));
    const h = Math.max(0.005, num(hold, 0.2));
    const r = Math.max(0.02, num(release, 0.4));
    param.cancelScheduledValues(t0);
    param.setValueAtTime(0.0002, t0);
    param.linearRampToValueAtTime(l, t0 + a);
    param.setValueAtTime(l, t0 + a + h);
    param.exponentialRampToValueAtTime(0.0003, t0 + a + h + r);
    param.setValueAtTime(0, t0 + a + h + r + 0.004);
    return t0 + a + h + r + 0.02;
  }

  function endAt(node, chain, when) {
    node.onended = function () {
      try {
        node.disconnect();
        for (let i = 0; i < chain.length; i++) chain[i].disconnect();
      } catch (_) {}
    };
    node.stop(when);
  }

  function padTone(t0, o) {
    const osc = S.ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, num(o.f, 440)), t0);
    const g = gain(0.0002);
    const end = swellEnv(g.gain, t0, o.level, o.attack, o.hold, o.release);
    osc.connect(g);
    g.connect(S.sfxBus);
    const chain = [g];
    if (o.wet) {
      const w = gain(o.wet);
      g.connect(w);
      w.connect(S.convIn);
      chain.push(w);
    }
    osc.start(t0);
    endAt(osc, chain, end);
  }

  function padNoise(t0, o) {
    const s = src(S.nzS, true);
    const f0 = Math.max(30, num(o.f, 900));
    const f = filt('bandpass', f0, o.q === undefined ? 0.9 : o.q);
    if (o.sweepTo) {
      f.frequency.setValueAtTime(f0, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(30, o.sweepTo), t0 + (o.sweepTime || 0.35));
    }
    const g = gain(0.0002);
    const end = swellEnv(g.gain, t0, o.level, o.attack, o.hold, o.release);
    s.connect(f);
    f.connect(g);
    g.connect(S.sfxBus);
    const chain = [f, g];
    if (o.wet) {
      const w = gain(o.wet);
      g.connect(w);
      w.connect(S.convIn);
      chain.push(w);
    }
    s.start(t0, rnd() * 2);
    endAt(s, chain, end);
  }

  function pickVoice(t0) {
    let oldest = S.voices[0];
    for (let i = 0; i < S.voices.length; i++) {
      const v = S.voices[i];
      if (v.busyUntil <= t0) return v;
      if (v.last < oldest.last) oldest = v;
    }
    return oldest;
  }

  function stopSrcs(v, when) {
    for (let i = 0; i < v.srcs.length; i++) {
      try {
        v.srcs[i].stop(when);
      } catch (_) {}
    }
    v.srcs.length = 0;
  }

  function shot(t0) {
    const v = pickVoice(t0);
    if (v.busyUntil > t0) stopSrcs(v, t0 + 0.005);
    else v.srcs.length = 0;
    v.last = t0;
    v.busyUntil = t0 + 0.29;
    const lvl = jit(0.05);
    if (v.pan) v.pan.pan.setValueAtTime((rnd() * 2 - 1) * 0.07, t0);

    const sub = S.ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(62 * jit(0.05), t0);
    sub.frequency.exponentialRampToValueAtTime(40 * jit(0.05), t0 + 0.055);
    env(v.subG.gain, t0, 0.9 * lvl, 0.0016, 0.06);
    sub.connect(v.subG);
    sub.start(t0);
    sub.stop(t0 + 0.085);

    const ck = src(S.nz, false);
    ck.playbackRate.value = jit(0.14);
    v.crackBP.frequency.cancelScheduledValues(t0);
    v.crackBP.frequency.setValueAtTime(4200 * jit(0.05), t0);
    v.crackBP.frequency.exponentialRampToValueAtTime(1500 * jit(0.05), t0 + 0.03);
    v.crackBP.Q.setValueAtTime(1.05 * jit(0.12), t0);
    const cg = v.crackG.gain;
    cg.cancelScheduledValues(t0);
    cg.setValueAtTime(0.0002, t0);
    cg.linearRampToValueAtTime(1.05 * lvl, t0 + 0.0006);
    cg.exponentialRampToValueAtTime(0.3 * lvl, t0 + 0.0075);
    cg.exponentialRampToValueAtTime(0.0004, t0 + 0.034);
    cg.setValueAtTime(0, t0 + 0.038);
    ck.start(t0, rnd() * 1.2);
    ck.stop(t0 + 0.06);

    const bd = S.ctx.createOscillator();
    bd.type = 'sawtooth';
    bd.frequency.setValueAtTime(252 * jit(0.06), t0);
    bd.frequency.exponentialRampToValueAtTime(148 * jit(0.06), t0 + 0.08);
    v.bodyBP.frequency.cancelScheduledValues(t0);
    v.bodyBP.frequency.setValueAtTime(255 * jit(0.06), t0);
    v.bodyBP.frequency.exponentialRampToValueAtTime(180, t0 + 0.08);
    env(v.bodyG.gain, t0, 0.62 * lvl, 0.0012, 0.08);
    bd.connect(v.bodyBP);
    bd.start(t0);
    bd.stop(t0 + 0.1);

    const tl = src(S.nz, false);
    tl.playbackRate.value = jit(0.1);
    v.tailLP.frequency.cancelScheduledValues(t0);
    v.tailLP.frequency.setValueAtTime(1750 * jit(0.06), t0);
    v.tailLP.frequency.exponentialRampToValueAtTime(430, t0 + 0.2);
    env(v.tailG.gain, t0, 0.4 * lvl, 0.005, 0.2);
    tl.connect(v.tailHP);
    tl.start(t0, rnd() * 1.2);
    tl.stop(t0 + 0.27);

    v.srcs.push(sub, ck, bd, tl);
  }

  function impact(t0, e) {
    const h = e.hit;
    if (!h || h.targetId) return;
    const p = h.point;
    const o = e.origin;
    let d = 10;
    if (p && o && p.length >= 3 && o.length >= 3) {
      const dx = num(p[0], 0) - num(o[0], 0);
      const dy = num(p[1], 0) - num(o[1], 0);
      const dz = num(p[2], 0) - num(o[2], 0);
      d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    if (!(d >= 0) || d > 240) return;
    const delay = Math.min(0.4, d / 343);
    const att = 1 / (1 + d * 0.16);
    noiseHit(t0 + delay, {
      f: 2600 * att + 520,
      q: 1.35,
      level: 0.2 * att + 0.015,
      dur: 0.045 + 0.025 * att,
      attack: 0.0006,
      rate: jit(0.15),
      wet: 0.28
    });
    noiseHit(t0 + delay, {
      f: 320 * att + 130,
      q: 0.9,
      type: 'lowpass',
      level: 0.13 * att,
      dur: 0.07,
      attack: 0.002,
      wet: 0.2
    });
  }

  function step(t0, mat) {
    noiseHit(t0, {
      f: 1150 * jit(0.22),
      q: 1.1,
      level: 0.3 * jit(0.18),
      dur: 0.055,
      attack: 0.001,
      rate: jit(0.12),
      wet: 0.1
    });
    noiseHit(t0, { f: 195 * jit(0.15), q: 0.9, type: 'lowpass', level: 0.26 * jit(0.15), dur: 0.07, attack: 0.002 });
    if (mat === 'metal') {
      const f0 = 2850 * jit(0.09);
      const m = jit(0.22);
      noiseHit(t0 + 0.001, { f: f0, q: 6, level: 0.16 * m, dur: 0.022, attack: 0.0006, wet: 0.2 });
      toneHit(t0 + 0.001, { type: 'sine', f: f0, level: 0.13 * m, dur: 0.12, attack: 0.0008, wet: 0.3 });
      toneHit(t0 + 0.002, { type: 'sine', f: f0 * 1.71, level: 0.075 * m, dur: 0.085, attack: 0.0008, wet: 0.3 });
      toneHit(t0 + 0.002, { type: 'sine', f: f0 * 2.63, level: 0.04 * m, dur: 0.05, attack: 0.0008, wet: 0.25 });
      noiseHit(t0 + 0.001, { f: 640, q: 3, level: 0.07, dur: 0.05, attack: 0.001 });
    }
  }

  function land(t0, speed) {
    const i = clamp01((num(speed, 5) - 2.5) / 8);
    const l = 0.45 + 0.65 * i;
    noiseHit(t0, {
      f: 860 * jit(0.2),
      q: 1,
      level: 0.42 * l,
      dur: 0.09 + 0.05 * i,
      attack: 0.001,
      rate: jit(0.1),
      wet: 0.15
    });
    noiseHit(t0, { f: 155, q: 0.85, type: 'lowpass', level: 0.4 * l, dur: 0.1, attack: 0.002 });
    toneHit(t0, { type: 'sine', f: 78 * jit(0.06), fTo: 46, fTime: 0.08, level: 0.45 * l, dur: 0.1, attack: 0.002, wet: 0.1 });
    if (i > 0.55) {
      noiseHit(t0 + 0.005, { f: 2450, q: 5, level: 0.09 * i, dur: 0.03, attack: 0.0008, wet: 0.22 });
      toneHit(t0 + 0.005, { type: 'sine', f: 2450 * jit(0.08), level: 0.06 * i, dur: 0.1, attack: 0.001, wet: 0.28 });
    }
  }

  function jump(t0) {
    noiseHit(t0, { f: 2650 * jit(0.15), q: 1.6, level: 0.065, dur: 0.035, attack: 0.001, rate: jit(0.15) });
    noiseHit(t0 + 0.012, { f: 690, q: 1.2, level: 0.05, dur: 0.09, attack: 0.012 });
  }

  function mantle(t0) {
    noiseHit(t0, { f: 920, q: 2.2, sweepTo: 380, sweepTime: 0.22, level: 0.16, dur: 0.24, attack: 0.022, wet: 0.14 });
    noiseHit(t0 + 0.02, { f: 2250, q: 1.5, level: 0.08, dur: 0.06, attack: 0.004 });
    noiseHit(t0 + 0.13, { f: 400, q: 1, type: 'lowpass', level: 0.12, dur: 0.1, attack: 0.006 });
  }

  function slideStart(t0) {
    noiseHit(t0, { f: 1750, q: 2.6, sweepTo: 470, sweepTime: 0.3, level: 0.3, dur: 0.3, attack: 0.026, wet: 0.2 });
    noiseHit(t0, { f: 265, q: 0.85, type: 'lowpass', level: 0.2, dur: 0.3, attack: 0.045 });
    noiseHit(t0 + 0.01, { f: 3400, q: 1.1, level: 0.05, dur: 0.16, attack: 0.03, rate: jit(0.2) });
  }

  function slideEnd(t0) {
    noiseHit(t0, { f: 700, q: 2, sweepTo: 320, sweepTime: 0.12, level: 0.11, dur: 0.13, attack: 0.012, wet: 0.12 });
  }

  function clack(t0, f, q, level, dur, wet) {
    noiseHit(t0, { f: f, q: q, level: level, dur: dur, attack: 0.0006, wet: wet === undefined ? 0.12 : wet });
  }

  function magOut(t0) {
    clack(t0, 2600 * jit(0.08), 7, 0.22, 0.026);
    toneHit(t0, { type: 'sine', f: 2600 * jit(0.08), level: 0.09, dur: 0.05, attack: 0.0008, wet: 0.2 });
    clack(t0 + 0.013, 4300 * jit(0.08), 9, 0.13, 0.018);
    noiseHit(t0 + 0.002, { f: 430, q: 2.2, level: 0.1, dur: 0.045, attack: 0.001 });
    clack(t0 + 0.058, 1520 * jit(0.1), 6, 0.17, 0.04);
    noiseHit(t0 + 0.062, { f: 330, q: 1, type: 'lowpass', level: 0.11, dur: 0.06, attack: 0.001 });
    clack(t0 + 0.147, 3300 * jit(0.12), 8, 0.09, 0.022, 0.16);
    toneHit(t0 + 0.147, { type: 'sine', f: 1750 * jit(0.1), level: 0.05, dur: 0.07, attack: 0.001, wet: 0.24 });
  }

  function magIn(t0) {
    clack(t0, 1220 * jit(0.08), 5, 0.2, 0.045);
    noiseHit(t0, { f: 270, q: 1.1, type: 'lowpass', level: 0.19, dur: 0.07, attack: 0.001 });
    clack(t0 + 0.022, 3050 * jit(0.06), 8, 0.16, 0.026);
    toneHit(t0 + 0.022, { type: 'sine', f: 3050 * jit(0.06), level: 0.07, dur: 0.06, attack: 0.0008, wet: 0.22 });
    noiseHit(t0 + 0.16, { f: 1850, q: 3, sweepTo: 900, sweepTime: 0.07, level: 0.13, dur: 0.08, attack: 0.007, wet: 0.16 });
    clack(t0 + 0.248, 2200 * jit(0.06), 6, 0.26, 0.035, 0.2);
    clack(t0 + 0.255, 5200, 10, 0.12, 0.016, 0.14);
    toneHit(t0 + 0.249, { type: 'sine', f: 2200 * jit(0.06), level: 0.11, dur: 0.09, attack: 0.0008, wet: 0.3 });
    toneHit(t0 + 0.248, { type: 'triangle', f: 145, fTo: 92, fTime: 0.05, level: 0.16, dur: 0.06, attack: 0.001 });
  }

  function dry(t0) {
    clack(t0, 1820 * jit(0.05), 8, 0.22, 0.012, 0.06);
    clack(t0 + 0.004, 3650, 10, 0.12, 0.009, 0.05);
    toneHit(t0, { type: 'sine', f: 1820 * jit(0.05), level: 0.09, dur: 0.03, attack: 0.0006 });
    noiseHit(t0 + 0.002, { f: 730, q: 5, level: 0.09, dur: 0.04, attack: 0.0008, wet: 0.08 });
  }

  function hitTick(t0) {
    toneHit(t0, { type: 'sine', f: 2000, level: 0.28, dur: 0.03, attack: 0.0005 });
    noiseHit(t0, { f: 4200, q: 3, level: 0.07, dur: 0.012, attack: 0.0004 });
  }

  function targetDown(t0) {
    toneHit(t0, { type: 'sine', f: 1320, fTo: 880, fTime: 0.32, level: 0.2, dur: 0.36, attack: 0.004, wet: 0.36 });
    toneHit(t0 + 0.012, { type: 'sine', f: 1980, fTo: 1320, fTime: 0.3, level: 0.095, dur: 0.3, attack: 0.004, wet: 0.36 });
    noiseHit(t0, { f: 5200, q: 2.2, level: 0.05, dur: 0.03, attack: 0.0005 });
  }

  function signalLost(t0) {
    toneHit(t0, { type: 'sawtooth', f: 220, fTo: 42, fTime: 0.9, level: 0.2, dur: 1, attack: 0.012, lp: 900, wet: 0.4 });
    noiseHit(t0, { f: 3000, q: 0.7, sweepTo: 130, sweepTime: 0.9, level: 0.22, dur: 1, attack: 0.014, wet: 0.5 });
    toneHit(t0 + 0.06, { type: 'square', f: 74, fTo: 34, fTime: 0.7, level: 0.12, dur: 0.8, attack: 0.02, lp: 300 });
  }

  function completeSoft(t0) {
    toneHit(t0, { type: 'sine', f: 880, level: 0.11, dur: 0.34, attack: 0.03, wet: 0.2 });
    toneHit(t0 + 0.006, { type: 'sine', f: 440, level: 0.05, dur: 0.32, attack: 0.028, wet: 0.12 });
  }

  function completeBronze(t0) {
    toneHit(t0, { type: 'sine', f: 440, level: 0.12, dur: 0.19, attack: 0.006, wet: 0.18 });
    toneHit(t0 + 0.14, { type: 'sine', f: 659.25, level: 0.14, dur: 0.42, attack: 0.008, wet: 0.26 });
    toneHit(t0 + 0.142, { type: 'triangle', f: 329.63, level: 0.045, dur: 0.3, attack: 0.012, wet: 0.1 });
  }

  function completeSilver(t0) {
    toneHit(t0, { type: 'sine', f: 440, level: 0.115, dur: 0.17, attack: 0.006, wet: 0.16 });
    toneHit(t0 + 0.125, { type: 'sine', f: 659.25, level: 0.12, dur: 0.17, attack: 0.006, wet: 0.2 });
    toneHit(t0 + 0.25, { type: 'sine', f: 880, level: 0.135, dur: 0.46, attack: 0.008, wet: 0.28 });
    toneHit(t0 + 0.252, { type: 'triangle', f: 220, level: 0.05, dur: 0.34, attack: 0.012, wet: 0.1 });
    padTone(t0 + 0.24, { type: 'sine', f: 1760, level: 0.03, attack: 0.14, hold: 0.1, release: 0.42, wet: 0.34 });
    padNoise(t0 + 0.24, {
      f: 3600,
      sweepTo: 7000,
      sweepTime: 0.4,
      q: 1.1,
      level: 0.016,
      attack: 0.17,
      hold: 0.05,
      release: 0.36,
      wet: 0.4
    });
  }

  function completeGold(t0) {
    toneHit(t0, { type: 'sine', f: 440, level: 0.115, dur: 0.15, attack: 0.006, wet: 0.2 });
    toneHit(t0 + 0.105, { type: 'sine', f: 554.37, level: 0.115, dur: 0.15, attack: 0.006, wet: 0.22 });
    toneHit(t0 + 0.21, { type: 'sine', f: 659.25, level: 0.12, dur: 0.16, attack: 0.006, wet: 0.26 });
    toneHit(t0 + 0.315, { type: 'sine', f: 880, level: 0.14, dur: 0.5, attack: 0.008, wet: 0.36 });
    toneHit(t0 + 0.317, { type: 'triangle', f: 220, level: 0.055, dur: 0.36, attack: 0.012, wet: 0.12 });
    toneHit(t0 + 0.44, { type: 'sine', f: 1760, level: 0.058, dur: 0.34, attack: 0.004, wet: 0.42 });
    noiseHit(t0 + 0.44, { f: 6400, q: 3, level: 0.02, dur: 0.022, attack: 0.0008, wet: 0.3 });
    padTone(t0 + 0.33, { type: 'sine', f: 1318.51, level: 0.026, attack: 0.16, hold: 0.12, release: 0.45, wet: 0.4 });
  }

  function completeSignal(t0) {
    padNoise(t0, {
      f: 620,
      sweepTo: 6200,
      sweepTime: 0.34,
      q: 0.85,
      level: 0.07,
      attack: 0.26,
      hold: 0.02,
      release: 0.3,
      wet: 0.42
    });
    noiseHit(t0 + 0.278, { f: 3200, q: 1.6, level: 0.035, dur: 0.05, attack: 0.0025, wet: 0.35 });
    padTone(t0 + 0.28, { type: 'sine', f: 440, level: 0.095, attack: 0.055, hold: 0.5, release: 0.66, wet: 0.38 });
    padTone(t0 + 0.29, { type: 'sine', f: 441.75, level: 0.046, attack: 0.07, hold: 0.48, release: 0.64, wet: 0.3 });
    padTone(t0 + 0.285, { type: 'sine', f: 659.25, level: 0.078, attack: 0.06, hold: 0.48, release: 0.62, wet: 0.4 });
    padTone(t0 + 0.3, { type: 'sine', f: 661.2, level: 0.04, attack: 0.08, hold: 0.46, release: 0.6, wet: 0.3 });
    padTone(t0 + 0.28, { type: 'triangle', f: 220, level: 0.055, attack: 0.05, hold: 0.36, release: 0.5, wet: 0.12 });
    padTone(t0 + 0.5, { type: 'sine', f: 1318.51, level: 0.03, attack: 0.19, hold: 0.14, release: 0.52, wet: 0.55 });
    padTone(t0 + 0.62, { type: 'sine', f: 880, level: 0.026, attack: 0.2, hold: 0.12, release: 0.46, wet: 0.5 });
    padNoise(t0 + 0.46, {
      f: 5400,
      sweepTo: 2400,
      sweepTime: 0.6,
      q: 1.2,
      level: 0.014,
      attack: 0.3,
      hold: 0.06,
      release: 0.5,
      wet: 0.6
    });
  }

  function runComplete(t0, medal) {
    if (medal === 'bronze') completeBronze(t0);
    else if (medal === 'silver') completeSilver(t0);
    else if (medal === 'gold') completeGold(t0);
    else if (medal === 'signal') completeSignal(t0);
    else completeSoft(t0);
  }

  function countdown(t0) {
    toneHit(t0, { type: 'sine', f: 1318.51, level: 0.17, dur: 0.05, attack: 0.0016 });
  }

  function unlock() {
    try {
      if (!S.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        let c = null;
        try {
          c = new AC({ latencyHint: 'interactive' });
        } catch (_) {
          c = new AC();
        }
        if (!c) return;
        S.ctx = c;
        try {
          build();
        } catch (_) {
          S.ctx = null;
          return;
        }
      }
      const st = S.ctx.state;
      if (st === 'suspended' || st === 'interrupted') {
        const p = S.ctx.resume();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (_) {}
  }

  function event(e) {
    if (!S.ctx || !e) return;
    try {
      const t = S.ctx.currentTime + 0.004;
      const k = e.t;
      if (k === 'fire') {
        shot(t);
        impact(t, e);
      } else if (k === 'step') {
        step(t, e.mat);
      } else if (k === 'land') {
        land(t, e.speed);
      } else if (k === 'jump') {
        jump(t);
      } else if (k === 'mantle') {
        mantle(t);
      } else if (k === 'slide_start') {
        slideStart(t);
      } else if (k === 'slide_end') {
        slideEnd(t);
      } else if (k === 'reload_start') {
        magOut(t + 0.2);
        magIn(t + 1.3);
      } else if (k === 'reload_done') {
        clack(t, 1600, 6, 0.09, 0.025, 0.08);
      } else if (k === 'dry') {
        dry(t);
      } else if (k === 'hit_target') {
        hitTick(t);
      } else if (k === 'target_down') {
        targetDown(t);
      } else if (k === 'death' || k === 'signal_lost') {
        signalLost(t);
      } else if (k === 'run_complete') {
        runComplete(t, e.medal);
      } else if (k === 'countdown') {
        countdown(t);
      }
    } catch (_) {}
  }

  function setListener(pos, yaw, speed01) {
    if (!S.ctx) return;
    try {
      if (pos && pos.length >= 3) {
        S.listener.pos[0] = num(pos[0], S.listener.pos[0]);
        S.listener.pos[1] = num(pos[1], S.listener.pos[1]);
        S.listener.pos[2] = num(pos[2], S.listener.pos[2]);
      }
      S.listener.yaw = num(yaw, S.listener.yaw);
      const s = clamp01(num(speed01, 0));
      S.listener.speed01 = s;
      if (!S.amb || Math.abs(s - S.lastSpeed) < 0.02) return;
      S.lastSpeed = s;
      const t = S.ctx.currentTime;
      const g = 0.06 * s * s;
      const p = S.amb.mG.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(Math.max(0.0002, p.value), t);
      p.linearRampToValueAtTime(Math.max(0.0002, g), t + 0.09);
      S.amb.mBp.frequency.setTargetAtTime(520 + 430 * s, t, 0.09);
    } catch (_) {}
  }

  function setLevels(l) {
    if (!S.ctx || !l) return;
    try {
      if (typeof l.master === 'number') {
        S.levels.master = clamp01(l.master);
        ramp(S.master.gain, S.levels.master * 0.9, 0.05);
      }
      if (typeof l.sfx === 'number') {
        S.levels.sfx = clamp01(l.sfx);
        ramp(S.sfxBus.gain, S.levels.sfx, 0.05);
      }
      if (typeof l.ambient === 'number') {
        S.levels.ambient = clamp01(l.ambient);
        ramp(S.ambBus.gain, S.levels.ambient, 0.05);
      }
    } catch (_) {}
  }

  function startAmbient() {
    if (!S.ctx || !S.amb) return;
    try {
      S.ambOn = true;
      ramp(S.amb.bed.gain, 0.075, 0.6);
    } catch (_) {}
  }

  function stopAmbient() {
    if (!S.ctx || !S.amb) return;
    try {
      S.ambOn = false;
      ramp(S.amb.bed.gain, 0.0002, 0.3);
    } catch (_) {}
  }

  return {
    unlock: unlock,
    event: event,
    setListener: setListener,
    setLevels: setLevels,
    startAmbient: startAmbient,
    stopAmbient: stopAmbient
  };
}
