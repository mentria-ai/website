/**
 * Audio player using <audio> elements instead of fetch() + Web Audio API.
 * This avoids CORS issues with GitHub Release asset URLs.
 * Crossfading is done via volume ramping on two alternating audio elements.
 */
export class RadioPlayer {
  constructor() {
    this._a = null; // current audio element
    this._b = null; // next audio element (for crossfade)
    this._volume = 0.8;
    this.isPlaying = false;
    this.crossfadeSec = 4;
    this._fadeInterval = null;
  }

  init() {
    this._a = new Audio();
    this._b = new Audio();
    this._a.preload = "auto";
    this._b.preload = "auto";
  }

  /**
   * Pre-load a track URL into a new Audio element.
   * Returns a promise that resolves with { audio, duration } when loadable.
   */
  loadTrack(url) {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.src = url;

      const onReady = () => {
        cleanup();
        resolve({ audio, duration: audio.duration });
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Failed to load: ${url}`));
      };
      const cleanup = () => {
        audio.removeEventListener("canplaythrough", onReady);
        audio.removeEventListener("error", onError);
      };

      audio.addEventListener("canplaythrough", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.load();
    });
  }

  /**
   * Play a loaded audio element with fade-in, crossfading out the current.
   * Returns { audio, duration }.
   */
  playAudio(loaded) {
    const { audio, duration } = loaded;

    // Fade out current
    if (this._a && !this._a.paused) {
      this._fadeOut(this._a);
    }

    // Set up new track
    audio.volume = 0;
    audio.play().catch(() => {});
    this._fadeIn(audio);

    this._a = audio;
    this.isPlaying = true;

    return { audio, duration };
  }

  _fadeIn(audio) {
    const step = 50; // ms
    const increment = this._volume / ((this.crossfadeSec * 1000) / step);
    let vol = 0;
    const id = setInterval(() => {
      vol = Math.min(this._volume, vol + increment);
      audio.volume = vol;
      if (vol >= this._volume) clearInterval(id);
    }, step);
  }

  _fadeOut(audio) {
    const step = 50;
    const decrement = audio.volume / ((this.crossfadeSec * 1000) / step);
    const id = setInterval(() => {
      const next = audio.volume - decrement;
      if (next <= 0) {
        audio.volume = 0;
        audio.pause();
        audio.src = "";
        clearInterval(id);
      } else {
        audio.volume = next;
      }
    }, step);
  }

  setVolume(value) {
    this._volume = value;
    if (this._a) {
      this._a.volume = value;
    }
  }

  pause() {
    if (this._a && !this._a.paused) {
      this._a.pause();
      this.isPlaying = false;
    }
  }

  resume() {
    if (this._a && this._a.paused && this._a.src) {
      this._a.volume = this._volume;
      this._a.play().catch(() => {});
      this.isPlaying = true;
    }
  }

  /** Get current playback time in seconds. */
  get currentTime() {
    return this._a ? this._a.currentTime : 0;
  }
}
