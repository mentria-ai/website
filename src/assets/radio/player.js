export class RadioPlayer {
  constructor() {
    this._a = null;
    this._els = new Set();
    this._waits = new Map();
    this._volume = 0.8;
    this.onblocked = null;
  }

  load(url) {
    const audio = new Audio();
    audio.preload = "auto";
    this._els.add(audio);
    audio.addEventListener("play", () => this.solo(audio));
    const ready = new Promise((resolve, reject) => {
      const finish = (settle, value) => {
        audio.removeEventListener("canplaythrough", onReady);
        audio.removeEventListener("error", onError);
        this._waits.delete(audio);
        settle(value);
      };
      const onReady = () => finish(resolve, { audio, duration: audio.duration });
      const onError = () => finish(reject, new Error(`Failed to load: ${url}`));
      audio.addEventListener("canplaythrough", onReady);
      audio.addEventListener("error", onError);
      this._waits.set(audio, () => finish(resolve, null));
    });
    audio.src = url;
    audio.load();
    return { audio, ready };
  }

  solo(audio) {
    if (audio !== this._a) {
      audio.pause();
      return;
    }
    this._els.forEach((el) => {
      if (el !== audio) el.pause();
    });
  }

  discard(audio) {
    if (!audio) return;
    const wait = this._waits.get(audio);
    if (wait) wait();
    this._els.delete(audio);
    if (audio === this._a) this._a = null;
    audio.onended = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  start(audio, play) {
    if (this._a && this._a !== audio) this.discard(this._a);
    this._els.add(audio);
    this._a = audio;
    this._els.forEach((el) => {
      if (el !== audio) el.pause();
    });
    audio.volume = this._volume;
    if (play) this.resume();
  }

  setVolume(value) {
    this._volume = value;
    if (this._a) {
      this._a.volume = value;
    }
  }

  pause() {
    this._els.forEach((el) => el.pause());
  }

  resume() {
    const audio = this._a;
    if (!audio || !audio.getAttribute("src")) return;
    audio.volume = this._volume;
    const started = audio.play();
    if (!started || !started.catch) return;
    started.catch((err) => {
      if (!err || err.name !== "NotAllowedError" || audio !== this._a || !audio.paused) return;
      if (this.onblocked) this.onblocked();
    });
  }

  get currentTime() {
    return this._a ? this._a.currentTime : 0;
  }
}
