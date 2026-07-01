import { RadioPlayer } from "./player.js";
import { loadCatalog } from "./catalog-loader.js";
import { selectNextTrack } from "./selector.js";
import {
  getAllPreferences,
  updatePreference,
  exportJSONL,
} from "./preferences.js";

const ART_BASE = "https://mentria-ai.github.io/radio-catalog/";

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
    this.nextTrack = null;
    this.nextLoaded = null; // { audio, duration }
    this.currentDuration = 0;
    this.progressTimer = null;
    this.crossfadeTimer = null;

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
    };
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
      this.preferences = await getAllPreferences();
      this.el.trackCount.textContent = COPY.trackCountFmt.replace("{n}", this.catalog.length);
      this.setStatus("ready", COPY.ready);
      this.el.play.disabled = false;
    } catch (err) {
      console.error("[radio] init failed:", err);
      this.setStatus("error", COPY.errLoadCatalog);
      if (this.el.retry) this.el.retry.hidden = false;
    }
  }

  // ── Transport ─────────────────────────────────────

  syncTransport(playing) {
    this.el.play.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    this.el.play.classList.toggle("playing", playing);
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = playing ? "playing" : "paused";
      } catch (_) {}
    }
  }

  pausePlayback() {
    if (!this.player.isPlaying) return;
    this.player.pause();
    this.syncTransport(false);
    this.setStatus("ready", COPY.paused);
    if (this.progressTimer) clearInterval(this.progressTimer);
    if (this.crossfadeTimer) clearTimeout(this.crossfadeTimer);
  }

  resumePlayback() {
    if (!this.currentTrack || this.player.isPlaying) return;
    this.player.resume();
    this.syncTransport(true);
    this.setStatus("playing", COPY.playing);
    this.startProgressTimer();
    this.scheduleCrossfade();
  }

  // ── Playback ──────────────────────────────────────

  async play() {
    this.player.init();
    this.player.setVolume(this.el.volume.value / 100);

    this.setStatus("loading", COPY.selectingTrack);

    const currentMood = this.currentTrack ? this.currentTrack.mood : null;
    const currentEnergy = this.currentTrack ? this.currentTrack.energy : null;
    const track = selectNextTrack(
      this.catalog,
      this.history,
      this.preferences,
      currentMood,
      currentEnergy
    );

    await this.loadAndPlay(track);
    this.prepareNext();
  }

  async loadAndPlay(track, failedIds) {
    this.setStatus("loading", COPY.loadingTrack);
    failedIds = failedIds || new Set();
    try {
      const loaded = await this.player.loadTrack(track.url);
      const { duration } = this.player.playAudio(loaded);

      this.currentTrack = track;
      this.currentDuration = duration;
      this.updateNowPlaying();
      this.startProgressTimer();
      this.scheduleCrossfade();

      this.setStatus("playing", COPY.playing);
      this.syncTransport(true);
      this.el.play.disabled = false;
      this.el.skip.disabled = false;
      this.el.like.disabled = false;
    } catch (err) {
      console.error("[radio] loadAndPlay failed:", err);
      failedIds.add(track.id);
      const okCatalog = this.catalog.filter((t) => !failedIds.has(t.id));
      if (okCatalog.length > 0 && failedIds.size < 5) {
        const next = selectNextTrack(
          okCatalog,
          this.history,
          this.preferences,
          this.currentTrack ? this.currentTrack.mood : null,
          this.currentTrack ? this.currentTrack.energy : null
        );
        if (next) return this.loadAndPlay(next, failedIds);
      }
      this.setStatus("error", COPY.errLoadTrack);
      this.syncTransport(false);
      this.el.play.disabled = false;
      this.el.skip.disabled = false;
    }
  }

  async crossfadeToNext() {
    if (!this.player.isPlaying) return;
    if (this.currentTrack) {
      await this.recordEnd(false);
      this.history.push(this.currentTrack);
    }

    if (this.nextLoaded && this.nextTrack) {
      const { duration } = this.player.playAudio(this.nextLoaded);
      this.currentTrack = this.nextTrack;
      this.currentDuration = duration;
      this.nextTrack = null;
      this.nextLoaded = null;

      this.updateNowPlaying();
      this.startProgressTimer();
      this.scheduleCrossfade();
      this.setStatus("playing", COPY.playing);
      this.syncTransport(true);
      this.prepareNext();
    } else {
      await this.play();
    }
  }

  scheduleCrossfade() {
    if (this.crossfadeTimer) clearTimeout(this.crossfadeTimer);
    const crossfadeSec = this.player.crossfadeSec || 4;
    const delayMs = Math.max(0, (this.currentDuration - this.player.currentTime - crossfadeSec) * 1000);
    this.crossfadeTimer = setTimeout(() => this.crossfadeToNext(), delayMs);
  }

  async prepareNext() {
    const currentMood = this.currentTrack ? this.currentTrack.mood : null;
    const currentEnergy = this.currentTrack ? this.currentTrack.energy : null;
    const track = selectNextTrack(
      this.catalog,
      [...this.history, this.currentTrack].filter(Boolean),
      this.preferences,
      currentMood,
      currentEnergy
    );

    this.el.nextTitle.textContent = track.title || track.id;
    this.nextTrack = track;

    try {
      this.nextLoaded = await this.player.loadTrack(track.url);
    } catch (err) {
      console.warn("[radio] pre-load failed:", err);
      this.nextLoaded = null;
    }
  }

  async skip() {
    if (this.crossfadeTimer) clearTimeout(this.crossfadeTimer);

    if (this.currentTrack) {
      await this.recordEnd(true);
      this.history.push(this.currentTrack);
    }

    if (this.nextLoaded && this.nextTrack) {
      const { duration } = this.player.playAudio(this.nextLoaded);
      this.currentTrack = this.nextTrack;
      this.currentDuration = duration;
      this.nextTrack = null;
      this.nextLoaded = null;

      this.updateNowPlaying();
      this.startProgressTimer();
      this.scheduleCrossfade();
      this.setStatus("playing", COPY.playing);
      this.syncTransport(true);
      this.prepareNext();
    } else {
      await this.play();
    }
  }

  async toggleLike() {
    if (!this.currentTrack) return;
    const trackId = this.currentTrack.id;
    const current = this.preferences[trackId];
    const isLiked = current ? !current.liked : true;

    const updated = await updatePreference(trackId, { liked: isLiked });
    this.preferences[trackId] = updated;
    this.el.like.classList.toggle("liked", isLiked);
    this.el.like.setAttribute("aria-pressed", isLiked ? "true" : "false");
  }

  async recordEnd(skipped) {
    if (!this.currentTrack) return;
    const trackId = this.currentTrack.id;

    const elapsed = this.player.currentTime;
    const listenedRatio =
      this.currentDuration > 0
        ? Math.min(1, elapsed / this.currentDuration)
        : 0;

    const existing = this.preferences[trackId] || {};
    const playCount = (existing.play_count || 0) + 1;

    const sessionContext = {
      timestamp: Date.now(),
      mood: this.currentTrack.mood,
      energy: this.currentTrack.energy,
      listened_ratio: listenedRatio,
      skipped,
    };

    const contexts = existing.session_contexts
      ? [...existing.session_contexts, sessionContext]
      : [sessionContext];

    const updated = await updatePreference(trackId, {
      listened_ratio: listenedRatio,
      skipped,
      play_count: playCount,
      session_contexts: contexts,
    });
    this.preferences[trackId] = updated;
  }

  // ── Progress timer ────────────────────────────────

  startProgressTimer() {
    if (this.progressTimer) clearInterval(this.progressTimer);

    this.progressTimer = setInterval(() => {
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
    }, 250);
  }

  // ── UI updates ────────────────────────────────────

  updateNowPlaying() {
    if (!this.currentTrack) return;

    this.el.title.textContent = this.currentTrack.title || this.currentTrack.id;
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
        artist: "Mentria Infinite Radio",
        album: (this.currentTrack.mood || "").replace(/_/g, " "),
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
        navigator.mediaSession.playbackState = this.player.isPlaying ? "playing" : "paused";
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

  // ── UI binding ────────────────────────────────────

  bindUI() {
    this.el.play.addEventListener("click", () => {
      if (!this.currentTrack) {
        this.play();
      } else if (this.player.isPlaying) {
        this.pausePlayback();
      } else {
        this.resumePlayback();
      }
    });

    this.el.skip.addEventListener("click", () => this.skip());
    this.el.like.addEventListener("click", () => this.toggleLike());
    if (this.el.retry) {
      this.el.retry.addEventListener("click", () => this.loadCatalogAndInit());
    }

    this.el.volume.addEventListener("input", () => {
      this.player.setVolume(this.el.volume.value / 100);
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
