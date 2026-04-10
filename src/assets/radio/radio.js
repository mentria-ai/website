import { RadioPlayer } from "./player.js";
import { loadCatalog } from "./catalog-loader.js";
import { selectNextTrack } from "./selector.js";
import {
  getAllPreferences,
  updatePreference,
  exportJSONL,
} from "./preferences.js";

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
    this.nextBuffer = null;
    this.currentDuration = 0;
    this.playStartTime = 0;
    this.pausedElapsed = 0;
    this.progressTimer = null;
    this.crossfadeTimer = null;
    this.audioInitialized = false;

    // DOM references
    this.el = {
      statusDot: document.getElementById("rd-status-dot"),
      statusText: document.getElementById("rd-status-text"),
      trackCount: document.getElementById("rd-track-count"),
      title: document.getElementById("rd-title"),
      mood: document.getElementById("rd-mood"),
      progressFill: document.getElementById("rd-progress-fill"),
      elapsed: document.getElementById("rd-elapsed"),
      duration: document.getElementById("rd-duration"),
      play: document.getElementById("rd-play"),
      skip: document.getElementById("rd-skip"),
      like: document.getElementById("rd-like"),
      volume: document.getElementById("rd-volume"),
      nextTitle: document.getElementById("rd-next-title"),
    };
  }

  // ── Init ──────────────────────────────────────────

  async init() {
    this.setStatus("loading", "Loading catalog\u2026");
    this.bindUI();

    try {
      this.catalog = await loadCatalog();
      this.preferences = await getAllPreferences();
      this.el.trackCount.textContent = `${this.catalog.length} tracks`;
      this.setStatus("ready", "Ready");
      this.el.play.disabled = false;
    } catch (err) {
      console.error("[radio] init failed:", err);
      this.setStatus("error", "Failed to load catalog");
    }
  }

  // ── Playback ──────────────────────────────────────

  async play() {
    // AudioContext must be created/resumed inside a user gesture handler
    if (!this.audioInitialized) {
      this.player.init();
      this.player.setVolume(this.el.volume.value / 100);
      this.audioInitialized = true;
    }

    if (this.player.ctx && this.player.ctx.state === "suspended") {
      await this.player.ctx.resume();
    }

    this.setStatus("loading", "Selecting track\u2026");

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

  async loadAndPlay(track) {
    this.setStatus("loading", "Loading track\u2026");
    try {
      const buffer = await this.player.loadTrack(track.url);
      const { duration } = this.player.playBuffer(buffer);

      this.currentTrack = track;
      this.currentDuration = duration;
      this.playStartTime = this.player.ctx.currentTime;
      this.pausedElapsed = 0;
      this.updateNowPlaying();
      this.startProgressTimer();
      this.scheduleCrossfade();

      this.setStatus("playing", "Playing");
      this.el.play.innerHTML = PAUSE_SVG;
      this.el.play.classList.add("playing");
      this.el.play.disabled = false;
      this.el.skip.disabled = false;
      this.el.like.disabled = false;
    } catch (err) {
      console.error("[radio] loadAndPlay failed:", err);
      this.setStatus("error", "Failed to load track");
    }
  }

  async crossfadeToNext() {
    // Record preference for ending track
    if (this.currentTrack) {
      await this.recordEnd(false);
      this.history.push(this.currentTrack);
    }

    if (this.nextBuffer && this.nextTrack) {
      const { duration } = this.player.playBuffer(this.nextBuffer);
      this.currentTrack = this.nextTrack;
      this.currentDuration = duration;
      this.playStartTime = this.player.ctx.currentTime;
      this.pausedElapsed = 0;
      this.nextTrack = null;
      this.nextBuffer = null;

      this.updateNowPlaying();
      this.startProgressTimer();
      this.scheduleCrossfade();
      this.setStatus("playing", "Playing");
      this.prepareNext();
    } else {
      // Next track wasn't ready; select and load one now
      await this.play();
    }
  }

  scheduleCrossfade() {
    if (this.crossfadeTimer) clearTimeout(this.crossfadeTimer);

    // Schedule crossfade to start `crossfadeSec` before the track ends
    const crossfadeSec = this.player.crossfadeSec || 4;
    const delayMs = Math.max(0, (this.currentDuration - crossfadeSec) * 1000);

    this.crossfadeTimer = setTimeout(() => {
      this.crossfadeToNext();
    }, delayMs);
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
      this.nextBuffer = await this.player.loadTrack(track.url);
    } catch (err) {
      console.warn("[radio] pre-load failed:", err);
      this.nextBuffer = null;
    }
  }

  async skip() {
    if (this.crossfadeTimer) clearTimeout(this.crossfadeTimer);

    // Record preference as skipped
    if (this.currentTrack) {
      await this.recordEnd(true);
      this.history.push(this.currentTrack);
    }

    if (this.nextBuffer && this.nextTrack) {
      const { duration } = this.player.playBuffer(this.nextBuffer);
      this.currentTrack = this.nextTrack;
      this.currentDuration = duration;
      this.playStartTime = this.player.ctx.currentTime;
      this.pausedElapsed = 0;
      this.nextTrack = null;
      this.nextBuffer = null;

      this.updateNowPlaying();
      this.startProgressTimer();
      this.scheduleCrossfade();
      this.setStatus("playing", "Playing");
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
  }

  async recordEnd(skipped) {
    if (!this.currentTrack) return;
    const trackId = this.currentTrack.id;

    const elapsed = this.getElapsed();
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

  getElapsed() {
    if (!this.player.ctx) return 0;
    if (!this.player.isPlaying) return this.pausedElapsed;
    return this.pausedElapsed + (this.player.ctx.currentTime - this.playStartTime);
  }

  startProgressTimer() {
    if (this.progressTimer) clearInterval(this.progressTimer);

    this.progressTimer = setInterval(() => {
      const elapsed = this.getElapsed();
      const pct =
        this.currentDuration > 0
          ? Math.min(100, (elapsed / this.currentDuration) * 100)
          : 0;

      this.el.progressFill.style.width = `${pct}%`;
      this.el.elapsed.textContent = formatTime(elapsed);
    }, 250);
  }

  // ── UI updates ────────────────────────────────────

  updateNowPlaying() {
    if (!this.currentTrack) return;

    this.el.title.textContent = this.currentTrack.title || this.currentTrack.id;
    this.el.mood.textContent = this.currentTrack.mood || "";
    this.el.duration.textContent = formatTime(this.currentDuration);
    this.el.elapsed.textContent = "0:00";
    this.el.progressFill.style.width = "0%";

    // Update like button state
    const pref = this.preferences[this.currentTrack.id];
    this.el.like.classList.toggle("liked", !!(pref && pref.liked));
  }

  setStatus(state, text) {
    // Remove all state classes
    this.el.statusDot.className = "rd__status-dot";
    // Add the new state class
    this.el.statusDot.classList.add(`rd__status-dot--${state}`);
    this.el.statusText.textContent = text;
  }

  // ── UI binding ────────────────────────────────────

  bindUI() {
    // Play / Pause
    this.el.play.addEventListener("click", () => {
      if (!this.currentTrack) {
        // First play
        this.play();
      } else if (this.player.isPlaying) {
        // Pause
        this.pausedElapsed = this.getElapsed();
        this.player.pause();
        this.el.play.innerHTML = PLAY_SVG;
        this.el.play.classList.remove("playing");
        this.setStatus("ready", "Paused");
        if (this.progressTimer) clearInterval(this.progressTimer);
      } else {
        // Resume
        this.player.resume();
        this.playStartTime = this.player.ctx.currentTime;
        this.el.play.innerHTML = PAUSE_SVG;
        this.el.play.classList.add("playing");
        this.setStatus("playing", "Playing");
        this.startProgressTimer();
      }
    });

    // Skip
    this.el.skip.addEventListener("click", () => {
      this.skip();
    });

    // Like
    this.el.like.addEventListener("click", () => {
      this.toggleLike();
    });

    // Volume
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
  const radio = new MentriaRadio();
  radio.init();
});
