import { normalize } from './dsp/settings.js';

const WORKLET_URL = new URL('./worklet.js', import.meta.url).href;

function code(name) {
  const e = new Error(name);
  e.code = name;
  return e;
}

let primed = null;

export function primeAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || (primed && primed.state !== 'closed')) return;
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (_) {}
  try {
    primed = new Ctx({ latencyHint: 'interactive' });
    primed.resume().catch(() => {});
  } catch (_) {
    primed = null;
  }
}

export function createAudio(handlers = {}) {
  let ctx = null, stream = null, source = null, node = null, gain = null, limiter = null;
  let mode = 'wired', monitorDb = -6, settings = normalize(null), state = 'idle', lastDelay = 3;
  const a = {};
  Object.defineProperty(a, 'state', { get: () => state });
  Object.defineProperty(a, 'sampleRate', { get: () => (ctx ? ctx.sampleRate : 48000) });

  function emit(name, data) {
    const fn = handlers[name];
    if (fn) try { fn(data); } catch (_) {}
  }

  function setState(s) {
    if (state === s) return;
    state = s;
    emit('state', s);
  }

  function onMessage(m) {
    if (!m) return;
    if (m.type === 'telemetry') { lastDelay = m.delayMs || lastDelay; emit('telemetry', m); }
    else if (m.type === 'chunk') emit('chunk', m);
    else if (m.type === 'howl') emit('howl', m);
    else if (m.type === 'key') emit('key', m);
  }

  function onDeviceChange() {
    emit('devicechange');
  }

  function post(msg, transfer) {
    if (node) node.port.postMessage(msg, transfer || []);
  }

  function applyMonitor() {
    if (!gain || !ctx) return;
    const target = mode === 'bluetooth' ? 0 : Math.pow(10, monitorDb / 20);
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
    post({ type: 'monitor', speaker: mode === 'speaker', db: mode === 'bluetooth' ? -120 : monitorDb });
  }

  a.start = async () => {
    if (!window.isSecureContext) throw code('insecure');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || typeof AudioWorkletNode === 'undefined') throw code('unsupported');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw code('no-mic');
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (_) {}
    if (!ctx || ctx.state === 'closed') {
      ctx = primed && primed.state !== 'closed' ? primed : new Ctx({ latencyHint: 'interactive' });
      primed = null;
    }
    const resumed = ctx.resume().catch(() => {});
    if (!ctx.audioWorklet) throw code('unsupported');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      const n = e && e.name;
      throw code(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'no-mic' : 'failed');
    }
    try {
      await Promise.race([resumed, new Promise((r) => setTimeout(r, 1500))]);
      await ctx.audioWorklet.addModule(WORKLET_URL);
      node = new AudioWorkletNode(ctx, 'vocal-tuner', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: { settings }
      });
    } catch (e) {
      a.stop();
      throw code('unsupported');
    }
    if (ctx.state !== 'running') {
      a.stop();
      throw code('suspended');
    }
    node.port.onmessage = (e) => onMessage(e.data);
    source = ctx.createMediaStreamSource(stream);
    gain = ctx.createGain();
    gain.gain.value = 0;
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;
    source.connect(node);
    node.connect(gain);
    gain.connect(limiter);
    limiter.connect(ctx.destination);
    applyMonitor();
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.addEventListener('ended', () => { if (state === 'running') setState('interrupted'); });
      track.addEventListener('mute', () => { if (state === 'running') setState('interrupted'); });
    }
    ctx.onstatechange = () => {
      if (ctx && state === 'running' && (ctx.state === 'interrupted' || ctx.state === 'suspended')) setState('interrupted');
    };
    try { navigator.mediaDevices.addEventListener('devicechange', onDeviceChange); } catch (_) {}
    setState('running');
    const s = track && track.getSettings ? track.getSettings() : {};
    return { echoOn: s.echoCancellation === true, latencyMs: a.latencyMs() };
  };

  a.stop = () => {
    try { navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange); } catch (_) {}
    if (stream) stream.getTracks().forEach((tr) => { try { tr.stop(); } catch (_) {} });
    for (const n of [source, node, gain, limiter]) { if (n) try { n.disconnect(); } catch (_) {} }
    if (node) node.port.onmessage = null;
    if (ctx) { ctx.onstatechange = null; try { ctx.close(); } catch (_) {} }
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch (_) {}
    ctx = stream = source = node = gain = limiter = null;
    setState('idle');
  };

  a.setSettings = (s) => {
    settings = normalize(s);
    post({ type: 'settings', settings });
  };

  a.setBypass = (on) => post({ type: 'bypass', on: !!on });

  a.setMonitor = (m, dbValue) => {
    mode = m === 'speaker' || m === 'bluetooth' ? m : 'wired';
    if (typeof dbValue === 'number') monitorDb = Math.max(-30, Math.min(0, dbValue));
    applyMonitor();
  };

  a.muteMonitor = () => {
    if (!gain || !ctx) return;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
  };

  a.record = (on) => post({ type: 'record', on: !!on });

  a.returnChunk = (m) => {
    if (m && m.dry && m.tuned && m.dry.length === 8192 && m.dry.buffer.byteLength) post({ type: 'return', dry: m.dry, tuned: m.tuned }, [m.dry.buffer, m.tuned.buffer]);
  };

  a.keyFind = (on) => post({ type: 'keyfind', on: !!on });
  a.keyResult = () => post({ type: 'keyresult' });
  a.howlReset = () => post({ type: 'howl-reset' });

  a.latencyMs = () => {
    if (!ctx) return 0;
    const input = /Android/i.test(navigator.userAgent) ? 20 : 10;
    return Math.round(1000 * ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) + input + lastDelay);
  };

  return a;
}
