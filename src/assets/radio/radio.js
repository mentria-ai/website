import { RadioPlayer } from "./player.js";
import { loadCatalog } from "./catalog-loader.js";
import { selectNextTrack } from "./selector.js";
import {
  getAllPreferences,
  updatePreference,
  exportJSONL,
} from "./preferences.js";

const ART_BASE = "https://mentria-ai.github.io/radio-catalog/";
const RESUME_KEY = "mentria-radio-resume";
const RESUME_MAX_AGE = 12 * 3600000;

const COPY = window.RADIO_COPY || {
  ready: "Ready",
  paused: "Paused",
  playing: "Playing",
  selectingTrack: "Selecting track…",
  loadingTrack: "Loading track…",
  loadingCatalog: "Loading catalog…",
  errLoadCatalog: "Failed to load catalog",
  errLoadTrack: "Failed to load track",
  trackCountFmt: "{n} tracks",
  untitled: "Untitled",
  btnPlayAria: "Play",
  btnPauseAria: "Pause",
};

const PLAY_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
const PAUSE_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

class MentriaRadio {
  constructor() {
    this.player = new RadioPlayer();
    this.catalog = [];
    this.preferences = {};
    this.history = [];
    this.currentTrack = null;
    this.currentDuration = 0;
    this.loading = null;
    this.next = null;
    this.seq = 0;
    this.wantPlay = false;
    this.resumeAt = null;
    this.progressTimer = null;
    this.player.onblocked = () => this.pausePlayback();

    this.el = {
      statusDot: document.getElementById("rd-status-dot"),
      statusText: document.getElementById("rd-status-text"),
      trackCount: document.getElementById("rd-track-count"),
      title: document.getElementById("rd-title"),
      mood: document.getElementById("rd-mood"),
      art: document.getElementById("rd-art"),
      progress: document.getElementById("rd-progress"),
      progressFill: document.getElementById("rd-progress-fill"),
      elapsed: document.getElementById("rd-elapsed"),
      duration: document.getElementById("rd-duration"),
      play: document.getElementById("rd-play"),
      skip: document.getElementById("rd-skip"),
      like: document.getElementById("rd-like"),
      volume: document.getElementById("rd-volume"),
      nextTitle: document.getElementById("rd-next-title"),
      retry: document.getElementById("rd-retry"),
      likedList: document.getElementById("rd-liked-list"),
      likedCount: document.getElementById("rd-liked-count"),
      sleepSeg: document.getElementById("rd-sleep-seg"),
      float: document.getElementById("rd-float"),
      sleepLeft: document.getElementById("rd-sleep-left"),
    };
    this.sleepAt = 0;
    this.sleepTimer = null;
    this.sleepControl = null;
  }

  // ── Init ──────────────────────────────────────────

  async init() {
    this.bindUI();
    await this.loadCatalogAndInit();
  }

  async loadCatalogAndInit() {
    this.setStatus("loading", COPY.loadingCatalog);
    if (this.el.retry) this.el.retry.hidden = true;

    try {
      this.catalog = await loadCatalog();
      if (!this.canPlayCatalog()) {
        this.setStatus("error", COPY.errFormat);
        this.el.play.disabled = true;
        return;
      }
      this.preferences = await getAllPreferences();
      this.renderLiked();
      this.el.trackCount.textContent = COPY.trackCountFmt.replace("{n}", this.catalog.length);
      this.setStatus("ready", COPY.ready);
      this.el.play.disabled = false;
    } catch (err) {
      console.error("[radio] init failed:", err);
      this.setStatus("error", COPY.errLoadCatalog);
      if (this.el.retry) this.el.retry.hidden = false;
      return;
    }
    this.restore();
  }

  canPlayCatalog() {
    const first = this.catalog && this.catalog[0];
    if (!first || !/\.(opus|ogg)(\?|$)/i.test(String(first.url || ""))) return true;
    const probe = document.createElement("audio");
    return !!(probe.canPlayType && (probe.canPlayType('audio/ogg; codecs="opus"') || probe.canPlayType("audio/ogg; codecs=opus")));
  }

  // ── Transport ─────────────────────────────────────

  syncTransport(playing) {
    this.el.play.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    this.el.play.classList.toggle("playing", playing);
    this.el.play.setAttribute("aria-label", playing ? COPY.btnPauseAria : COPY.btnPlayAria);
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = playing ? "playing" : "paused";
      } catch (_) {}
    }
  }

  togglePlayback() {
    if (this.wantPlay) this.pausePlayback();
    else this.resumePlayback();
  }

  pausePlayback() {
    this.player.pause();
    if (!this.wantPlay) return;
    this.wantPlay = false;
    this.syncTransport(false);
    this.setStatus("ready", COPY.paused);
    this.stopProgressTimer();
  }

  resumePlayback() {
    if (this.wantPlay) return;
    if (!this.player._a && !this.loading) {
      this.play();
      return;
    }
    this.wantPlay = true;
    this.syncTransport(true);
    if (this.loading) {
      this.setStatus("loading", COPY.loadingTrack);
      return;
    }
    this.player.resume();
    this.setStatus("playing", COPY.playing);
    this.startProgressTimer();
  }

  // ── Playback ──────────────────────────────────────

  play() {
    const seq = ++this.seq;
    this.wantPlay = true;
    this.syncTransport(true);
    this.player.setVolume(this.el.volume.value / 100);
    this.setStatus("loading", COPY.selectingTrack);
    this.dropNext();
    return this.loadAndPlay(this.pick(this.history, this.lastPlayed()), seq);
  }

  lastPlayed() {
    return this.history[this.history.length - 1] || null;
  }

  pick(history, after, pool) {
    return selectNextTrack(
      pool || this.catalog,
      history,
      this.preferences,
      after ? after.mood : null,
      after ? after.energy : null
    );
  }

  async loadAndPlay(track, seq, failedIds, req) {
    if (!track) {
      this.failLoad();
      return;
    }
    failedIds = failedIds || new Set();
    this.setCurrent(track);
    req = req || this.player.load(track.url);
    this.loading = req;
    let loaded = null;
    let error = null;
    try {
      loaded = await req.ready;
    } catch (err) {
      error = err;
    }
    if (seq !== this.seq) {
      this.player.discard(req.audio);
      return;
    }
    this.loading = null;
    if (loaded) {
      this.begin(loaded);
      return;
    }
    console.error("[radio] loadAndPlay failed:", error);
    this.player.discard(req.audio);
    failedIds.add(track.id);
    const okCatalog = this.catalog.filter((t) => !failedIds.has(t.id));
    if (okCatalog.length > 0 && failedIds.size < 5) {
      const next = this.pick(this.history, this.lastPlayed(), okCatalog);
      if (next) return this.loadAndPlay(next, seq, failedIds);
    }
    this.failLoad();
  }

  failLoad() {
    this.loading = null;
    this.wantPlay = false;
    this.player.pause();
    this.stopProgressTimer();
    this.setStatus("error", COPY.errLoadTrack);
    this.syncTransport(false);
    this.el.play.disabled = false;
    this.el.skip.disabled = false;
  }

  setCurrent(track) {
    this.currentTrack = track;
    this.currentDuration = 0;
    this.stopProgressTimer();
    this.updateNowPlaying();
    if (this.wantPlay) this.setStatus("loading", COPY.loadingTrack);
  }

  begin(loaded) {
    const { audio, duration } = loaded;
    const at = this.resumeAt;
    this.resumeAt = null;
    this.currentDuration = duration;
    this.watch(audio);
    if (at && at.id === this.currentTrack.id && at.t > 0 && !(at.t >= duration)) {
      try {
        audio.currentTime = at.t;
      } catch (_) {}
    }
    this.player.start(audio, this.wantPlay);
    this.updateNowPlaying();
    this.renderProgress();
    this.el.play.disabled = false;
    this.el.skip.disabled = false;
    this.el.like.disabled = false;
    if (this.wantPlay) {
      this.setStatus("playing", COPY.playing);
      this.startProgressTimer();
    } else {
      this.setStatus("ready", COPY.paused);
    }
    this.syncTransport(this.wantPlay);
    this.prepareNext();
  }

  watch(audio) {
    audio.onended = () => {
      if (audio === this.player._a) this.advance(false);
    };
    audio.addEventListener("pause", () => {
      if (audio === this.player._a && this.wantPlay && audio.paused && !audio.ended) this.pausePlayback();
    });
    audio.addEventListener("play", () => {
      if (audio === this.player._a && !this.wantPlay && !audio.paused) this.resumePlayback();
    });
  }

  endCurrent(skipped, restart) {
    this.stopProgressTimer();
    const track = this.currentTrack;
    if (this.loading) {
      this.player.discard(this.loading.audio);
      this.loading = null;
    } else if (track && this.player._a && !restart) {
      this.recordEnd(track, this.player.currentTime, this.currentDuration, skipped);
    }
    this.player.discard(this.player._a);
    if (track && !restart) this.history.push(track);
    return track;
  }

  advance(skipped) {
    const seq = ++this.seq;
    const last = this.endCurrent(skipped);
    this.wantPlay = true;
    this.syncTransport(true);
    const next = this.next;
    this.next = null;
    this.el.nextTitle.textContent = "\u2014";
    if (next) return this.loadAndPlay(next.track, seq, null, next);
    return this.loadAndPlay(this.pick(this.history, last), seq);
  }

  skip() {
    return this.advance(true);
  }

  prepareNext() {
    this.dropNext();
    const current = this.currentTrack;
    const track = this.pick([...this.history, current].filter(Boolean), current);
    if (!track) return;
    this.el.nextTitle.textContent = track.title || track.id;
    const req = this.player.load(track.url);
    this.next = { track, audio: req.audio, ready: req.ready };
    req.ready.catch((err) => console.warn("[radio] pre-load failed:", err));
  }

  dropNext() {
    if (!this.next) return;
    this.player.discard(this.next.audio);
    this.next = null;
  }

  async toggleLike() {
    if (!this.currentTrack) return;
    const current = this.preferences[this.currentTrack.id];
    await this.setLiked(this.currentTrack.id, current ? !current.liked : true);
  }

  async setLiked(trackId, liked) {
    const updated = await updatePreference(trackId, { liked });
    this.preferences[trackId] = updated;
    if (this.currentTrack && this.currentTrack.id === trackId) {
      this.el.like.classList.toggle("liked", liked);
      this.el.like.setAttribute("aria-pressed", liked ? "true" : "false");
    }
    this.renderLiked();
  }

  async playTrack(track) {
    if (!track) return;
    const seq = ++this.seq;
    this.endCurrent(false, !!(this.currentTrack && this.currentTrack.id === track.id));
    this.wantPlay = true;
    this.syncTransport(true);
    this.player.setVolume(this.el.volume.value / 100);
    this.dropNext();
    this.el.nextTitle.textContent = "\u2014";
    await this.loadAndPlay(track, seq);
    if (seq === this.seq) this.renderLiked();
  }

  renderLiked() {
    const list = this.el.likedList;
    if (!list) return;
    const liked = this.catalog.filter((t) => this.preferences[t.id] && this.preferences[t.id].liked);
    this.el.likedCount.textContent = liked.length ? String(liked.length) : "";
    list.textContent = "";
    if (!liked.length) {
      const li = document.createElement("li");
      li.className = "rd__liked-empty";
      li.textContent = COPY.likedEmpty || "";
      list.appendChild(li);
      return;
    }
    liked.forEach((t) => {
      const title = t.title || t.id;
      const li = document.createElement("li");
      li.className = "rd__liked-item";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "rd__liked-play" + (this.currentTrack && this.currentTrack.id === t.id ? " is-current" : "");
      play.setAttribute("aria-label", (COPY.likedPlay || "{title}").replace("{title}", title));
      const name = document.createElement("span");
      name.className = "rd__liked-title";
      name.textContent = title;
      const mood = document.createElement("span");
      mood.className = "rd__liked-mood";
      mood.textContent = (t.mood || "").replace(/_/g, " ");
      play.append(name, mood);
      play.addEventListener("click", () => this.playTrack(t));
      const unlike = document.createElement("button");
      unlike.type = "button";
      unlike.className = "rd__liked-unlike";
      unlike.textContent = "\u2665";
      const unlikeLabel = (COPY.likedRemove || "{title}").replace("{title}", title);
      unlike.setAttribute("aria-label", unlikeLabel);
      unlike.title = unlikeLabel;
      unlike.addEventListener("click", () => this.setLiked(t.id, false));
      li.append(play, unlike);
      list.appendChild(li);
    });
  }

  async floatPlayer() {
    const win = await window.MentriaUI.floatWindow({
      width: 340,
      height: 150,
      title: COPY.floatDocTitle || "Radio",
      css: ".pip{display:flex;align-items:center;gap:12px;height:100%;padding:12px;box-sizing:border-box}" +
        ".pip__art{width:96px;height:96px;flex:0 0 auto;border-radius:8px;object-fit:cover;background:var(--raised)}" +
        ".pip__art[hidden]{display:none}.pip__info{min-width:0;flex:1;display:flex;flex-direction:column;gap:4px}" +
        ".pip__title{font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        ".pip__mood{font-size:11px;color:var(--muted)}.pip__row{display:flex;gap:6px;margin-top:6px}" +
        ".pip__row button{padding:6px 10px}.pip__like[aria-pressed=true]{color:var(--pink);border-color:var(--pink)}",
    });
    if (!win) return;
    this.floatWin = win;
    const d = win.document;
    d.body.innerHTML = '<main class="pip"><img class="pip__art" alt=""><div class="pip__info"><div class="pip__title"></div><div class="pip__mood"></div><div class="pip__row"><button type="button" data-act="play"></button><button type="button" data-act="skip">\u23ED</button><button type="button" class="pip__like" data-act="like">\u2665</button></div></div></main>';
    const sync = () => {
      if (win.closed || this.floatWin !== win) { clearInterval(timer); return; }
      const art = d.querySelector(".pip__art");
      const src = this.el.art.getAttribute("src") || "";
      if (art.getAttribute("src") !== src) art.setAttribute("src", src);
      art.hidden = !src;
      d.querySelector(".pip__title").textContent = this.el.title.textContent;
      d.querySelector(".pip__mood").textContent = this.el.mood.textContent;
      const play = d.querySelector('[data-act="play"]');
      play.textContent = this.wantPlay ? "\u275A\u275A" : "\u25B6";
      play.setAttribute("aria-label", this.el.play.getAttribute("aria-label") || "");
      play.disabled = this.el.play.disabled;
      const skip = d.querySelector('[data-act="skip"]');
      skip.setAttribute("aria-label", this.el.skip.getAttribute("aria-label") || "");
      skip.disabled = this.el.skip.disabled;
      const like = d.querySelector('[data-act="like"]');
      like.setAttribute("aria-label", this.el.like.getAttribute("aria-label") || "");
      like.setAttribute("aria-pressed", this.el.like.getAttribute("aria-pressed") || "false");
      like.disabled = this.el.like.disabled;
    };
    d.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || b.disabled) return;
      if (b.dataset.act === "play") this.el.play.click();
      else if (b.dataset.act === "skip") this.el.skip.click();
      else this.el.like.click();
      setTimeout(sync, 60);
    });
    const timer = setInterval(sync, 400);
    sync();
    win.addEventListener("pagehide", () => { clearInterval(timer); if (this.floatWin === win) this.floatWin = null; });
  }

  setSleep(minutes) {
    if (this.sleepTimer) { clearInterval(this.sleepTimer); this.sleepTimer = null; }
    this.sleepAt = minutes > 0 ? Date.now() + minutes * 60000 : 0;
    if (!this.sleepAt) { this.el.sleepLeft.textContent = ""; return; }
    const tick = () => {
      const left = this.sleepAt - Date.now();
      if (left <= 0) { this.fireSleep(); return; }
      this.el.sleepLeft.textContent = (COPY.sleepLeft || "{time}").replace("{time}", formatTime(Math.ceil(left / 1000)));
    };
    tick();
    this.sleepTimer = setInterval(tick, 1000);
  }

  fireSleep() {
    if (this.sleepTimer) { clearInterval(this.sleepTimer); this.sleepTimer = null; }
    this.sleepAt = 0;
    this.el.sleepLeft.textContent = "";
    if (this.sleepControl) this.sleepControl.set("0");
    if (!this.wantPlay) return;
    const target = this.el.volume.value / 100;
    const steps = 40;
    let i = 0;
    const fade = setInterval(() => {
      i += 1;
      this.player.setVolume(target * Math.max(0, 1 - i / steps));
      if (i >= steps) {
        clearInterval(fade);
        this.pausePlayback();
        this.player.setVolume(target);
      }
    }, 200);
  }

  async recordEnd(track, elapsed, duration, skipped) {
    const trackId = track.id;
    const listenedRatio =
      duration > 0
        ? Math.min(1, elapsed / duration)
        : 0;

    const existing = this.preferences[trackId] || {};
    const playCount = (existing.play_count || 0) + 1;

    const sessionContext = {
      timestamp: Date.now(),
      mood: track.mood,
      energy: track.energy,
      listened_ratio: listenedRatio,
      skipped,
    };

    const contexts = existing.session_contexts
      ? [...existing.session_contexts, sessionContext]
      : [sessionContext];

    try {
      const updated = await updatePreference(trackId, {
        listened_ratio: listenedRatio,
        skipped,
        play_count: playCount,
        session_contexts: contexts,
      });
      this.preferences[trackId] = updated;
    } catch (err) {
      console.warn("[radio] could not save play history:", err);
    }
  }

  // ── Progress timer ────────────────────────────────

  startProgressTimer() {
    this.stopProgressTimer();
    this.progressTimer = setInterval(() => this.renderProgress(), 250);
  }

  stopProgressTimer() {
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  renderProgress() {
    const elapsed = this.player.currentTime;
    const pct =
      this.currentDuration > 0
        ? Math.min(100, (elapsed / this.currentDuration) * 100)
        : 0;

    this.el.progressFill.style.width = `${pct}%`;
    this.el.elapsed.textContent = formatTime(elapsed);
    if (this.el.progress) this.el.progress.setAttribute("aria-valuenow", Math.round(pct));
    if ("mediaSession" in navigator && "setPositionState" in navigator.mediaSession && this.currentDuration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.currentDuration,
          position: Math.min(elapsed, this.currentDuration),
        });
      } catch (_) {}
    }
  }

  // ── UI updates ────────────────────────────────────

  updateNowPlaying() {
    if (!this.currentTrack) return;

    const title = this.currentTrack.title || this.currentTrack.id;
    if (this.el.title.textContent !== title) this.el.title.textContent = title;
    this.el.mood.textContent = (this.currentTrack.mood || "").replace(/_/g, " ");
    this.el.duration.textContent = formatTime(this.currentDuration);
    this.el.elapsed.textContent = "0:00";
    this.el.progressFill.style.width = "0%";
    if (this.el.progress) this.el.progress.setAttribute("aria-valuenow", "0");

    // Album art
    const artFile = this.currentTrack.art;
    if (artFile) {
      this.el.art.src = ART_BASE + artFile;
      this.el.art.alt = this.currentTrack.mood;
    } else {
      this.el.art.src = "";
    }

    // Media Session API — shows track info in OS media widgets
    if ("mediaSession" in navigator) {
      const artUrl = artFile ? ART_BASE + artFile : "";
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.currentTrack.title || COPY.untitled,
        artist: this.currentTrack.artist || "Mentria Infinite Radio",
        album: this.currentTrack.album_title || (this.currentTrack.mood || "").replace(/_/g, " "),
        artwork: artUrl ? [
          { src: artUrl, sizes: "512x512", type: "image/jpeg" },
        ] : [],
      });
      const setHandler = (action, fn) => {
        try { navigator.mediaSession.setActionHandler(action, fn); } catch (_) {}
      };
      setHandler("play", () => this.resumePlayback());
      setHandler("pause", () => this.pausePlayback());
      setHandler("nexttrack", () => this.skip());
      try {
        navigator.mediaSession.playbackState = this.wantPlay ? "playing" : "paused";
        if ("setPositionState" in navigator.mediaSession && this.currentDuration > 0) {
          navigator.mediaSession.setPositionState({ duration: this.currentDuration, position: 0 });
        }
      } catch (_) {}
    }

    const pref = this.preferences[this.currentTrack.id];
    const liked = !!(pref && pref.liked);
    this.el.like.classList.toggle("liked", liked);
    this.el.like.setAttribute("aria-pressed", liked ? "true" : "false");
  }

  setStatus(state, text) {
    this.el.statusDot.className = "rd__status-dot";
    this.el.statusDot.classList.add(`rd__status-dot--${state}`);
    this.el.statusText.textContent = text;
  }

  relabel() {
    const i18n = window.MentriaI18n;
    if (!i18n || typeof i18n.t !== "function") return;
    const before = Object.assign({}, COPY);
    Object.keys(COPY).forEach((key) => {
      const name = key === "trackCountFmt" ? "track_count_format" : key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
      const value = i18n.t("tool.radio." + name);
      if (typeof value === "string") COPY[key] = value;
    });
    const shown = this.el.statusText.textContent;
    const statusKey = Object.keys(before).find((key) => before[key] === shown);
    if (statusKey) this.el.statusText.textContent = COPY[statusKey];
    if (this.catalog.length) this.el.trackCount.textContent = COPY.trackCountFmt.replace("{n}", this.catalog.length);
    this.renderLiked();
    if (this.el.sleepSeg) {
      Array.prototype.forEach.call(this.el.sleepSeg.querySelectorAll("button[data-value]"), (b) => {
        const v = Number(b.dataset.value);
        if (v > 0) b.setAttribute("aria-label", (COPY.sleepMinutes || "{n}").replace("{n}", String(v)));
      });
    }
    this.syncTransport(this.wantPlay);
  }

  minimize() {
    if (!window.MentriaMini) return;
    const track = this.currentTrack;
    if (track && (this.player._a || this.loading)) {
      this.saveResume({
        id: track.id,
        t: this.loading ? 0 : this.player.currentTime,
        history: this.history.slice(-20).map((t) => t.id),
        at: Date.now(),
      });
    }
    this.pausePlayback();
    window.MentriaMini.minimizeTool();
  }

  saveResume(state) {
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  forgetResume() {
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch (_) {}
  }

  takeResume() {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) || "null");
    } catch (_) {}
    this.forgetResume();
    if (!saved || saved.id == null || !(Date.now() - saved.at < RESUME_MAX_AGE)) return null;
    return saved;
  }

  restore() {
    const saved = this.takeResume();
    if (!saved) return;
    const byId = new Map(this.catalog.map((t) => [t.id, t]));
    const track = byId.get(saved.id);
    if (!track) return;
    this.history = (Array.isArray(saved.history) ? saved.history : []).map((id) => byId.get(id)).filter(Boolean);
    this.resumeAt = { id: track.id, t: Number(saved.t) || 0 };
    this.player.setVolume(this.el.volume.value / 100);
    this.setStatus("loading", COPY.loadingTrack);
    this.loadAndPlay(track, ++this.seq);
  }

  // ── UI binding ────────────────────────────────────

  bindUI() {
    this.el.play.addEventListener("click", () => this.togglePlayback());

    this.el.skip.addEventListener("click", () => this.skip());
    this.el.like.addEventListener("click", () => this.toggleLike());
    if (this.el.float && window.MentriaUI && window.MentriaUI.floatSupported && window.MentriaUI.floatSupported()) {
      this.el.float.hidden = false;
      this.el.float.addEventListener("click", () => this.floatPlayer());
    }
    if (this.el.sleepSeg && window.MentriaUI && window.MentriaUI.segmented) {
      this.sleepControl = window.MentriaUI.segmented(this.el.sleepSeg, (value) => this.setSleep(Number(value) || 0));
      this.sleepControl.set("0");
      Array.prototype.forEach.call(this.el.sleepSeg.querySelectorAll("button[data-value]"), (b) => {
        const v = Number(b.dataset.value);
        if (v > 0) b.setAttribute("aria-label", (COPY.sleepMinutes || "{n}").replace("{n}", String(v)));
      });
    }
    if (this.el.retry) {
      this.el.retry.addEventListener("click", () => this.loadCatalogAndInit());
    }
    document.addEventListener("mentria:localechange", () => this.relabel());
    const mini = document.querySelector('[data-mini="radio"]');
    if (mini) mini.addEventListener("click", () => this.minimize());
    window.addEventListener("pagehide", (e) => {
      if (e.persisted) this.pausePlayback();
    });
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) this.forgetResume();
    });

    if (window.MentriaStore) {
      const saved = window.MentriaStore.get("tools", "radio_volume");
      if (typeof saved === "number" && saved >= 0 && saved <= 100) {
        this.el.volume.value = saved;
      }
    }

    this.el.volume.addEventListener("input", () => {
      this.player.setVolume(this.el.volume.value / 100);
    });
    this.el.volume.addEventListener("change", () => {
      if (window.MentriaStore) window.MentriaStore.set("tools", "radio_volume", Number(this.el.volume.value));
    });

    // Ctrl+Shift+E → export JSONL
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        exportJSONL(this.catalog);
      }
    });
  }
}

// ── Bootstrap ─────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  new MentriaRadio().init();
});
