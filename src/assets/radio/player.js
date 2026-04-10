export class RadioPlayer {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.analyzer = null;
    this.currentSource = null;
    this.currentGain = null;
    this.isPlaying = false;
    this.crossfadeSec = 4;
  }

  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.analyzer = this.ctx.createAnalyser();
    this.analyzer.fftSize = 256;
    this.masterGain.connect(this.analyzer);
  }

  async loadTrack(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load: ${url}`);
    const buf = await res.arrayBuffer();
    return this.ctx.decodeAudioData(buf);
  }

  playBuffer(buffer) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + this.crossfadeSec);

    source.connect(gain);
    gain.connect(this.masterGain);

    // Fade out previous
    if (this.currentGain && this.isPlaying) {
      this.currentGain.gain.linearRampToValueAtTime(
        0, this.ctx.currentTime + this.crossfadeSec
      );
      const old = this.currentSource;
      setTimeout(() => { try { old.stop(); } catch {} }, this.crossfadeSec * 1000);
    }

    this.currentSource = source;
    this.currentGain = gain;
    source.start(0);
    this.isPlaying = true;

    return { source, duration: buffer.duration };
  }

  setVolume(value) {
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(value, this.ctx.currentTime);
    }
  }

  pause() {
    if (this.ctx && this.ctx.state === "running") {
      this.ctx.suspend();
      this.isPlaying = false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
      this.isPlaying = true;
    }
  }

  getFrequencyData() {
    if (!this.analyzer) return null;
    const data = new Uint8Array(this.analyzer.frequencyBinCount);
    this.analyzer.getByteFrequencyData(data);
    return data;
  }
}
