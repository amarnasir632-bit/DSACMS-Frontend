/**
 * DSACMS - Audio Player Component
 * Robust HTML5 audio player supporting buffering indicators and seamless failover
 * between primary Cloudflare R2 and secondary Internet Archive backup.
 */

import { formatDuration, showToast, escapeHtml } from "../core/ui-states.js";
import { resolveMediaUrl } from "../core/api.js";

const ICONS = {
  play: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
  pause: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
  spinner: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
  audioChip: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
};

export const AudioPlayer = {
  audio: null,
  activeId: null,
  activeSources: [],
  activeSourceIndex: 0,
  isMuted: false,
  volume: 0.85,
  rate: 1,
  widgets: {},
  _failoverInProgress: false,

  init() {
    if (this.audio) return;
    this.audio = new Audio();
    this.audio.preload = "metadata";

    // Event Listeners
    this.audio.addEventListener("play", () => {
      this._setBuffering(false);
      this._notify("onPlay");
    });

    this.audio.addEventListener("playing", () => {
      this._setBuffering(false);
      this._notify("onPlay");
    });

    this.audio.addEventListener("pause", () => {
      this._setBuffering(false);
      this._notify("onPause");
    });

    this.audio.addEventListener("loadstart", () => {
      if (this.audio.paused || this.audio.currentTime === 0) {
        this._setBuffering(true);
        this._notify("onLoading");
      }
    });

    this.audio.addEventListener("waiting", () => {
      this._setBuffering(true);
      this._notify("onBuffering");
    });

    this.audio.addEventListener("canplay", () => {
      this._setBuffering(false);
      if (!this.audio.paused) {
        this._notify("onPlay");
      } else {
        this._notify("onReady");
      }
    });

    this.audio.addEventListener("canplaythrough", () => {
      this._setBuffering(false);
      if (!this.audio.paused) {
        this._notify("onPlay");
      }
    });

    this.audio.addEventListener("timeupdate", () => {
      this._notify("onTime", this.audio.currentTime, this.audio.duration);
    });

    this.audio.addEventListener("loadedmetadata", () => {
      this._notify("onMeta", this.audio.duration);
    });

    this.audio.addEventListener("ended", () => {
      this._setBuffering(false);
      this._notify("onEnd");
    });

    this.audio.addEventListener("error", () => {
      this._handleFailoverOrError();
    });

    this.audio.addEventListener("stalled", () => {
      // If stalled for > 4s, trigger failover
      if (this.audio && !this.audio.paused && this.audio.networkState === 2) {
        this._setBuffering(true);
      }
    });
  },

  register(id, callbacks) {
    this.init();
    this.widgets[id] = callbacks;
  },

  unregister(id) {
    delete this.widgets[id];
    if (this.activeId === id) {
      this.pause();
      this.activeId = null;
    }
  },

  _notify(name, ...args) {
    if (!this.activeId) return;
    const cb = this.widgets[this.activeId];
    if (cb && typeof cb[name] === "function") cb[name](...args);
  },

  _setBuffering(isBuffering) {
    const activeWidget = this.activeId ? document.querySelector(`[data-player-id="${this.activeId}"]`) : null;
    if (activeWidget) {
      activeWidget.classList.toggle("is-buffering", isBuffering);
    }
  },

  _handleFailoverOrError() {
    if (this.activeSourceIndex < this.activeSources.length - 1) {
      const prev = this.activeSources[this.activeSourceIndex];
      this.activeSourceIndex++;
      const next = this.activeSources[this.activeSourceIndex];
      console.warn(`[AudioPlayer] تبديل المصدر الصوتي من (${prev}) إلى الخادم الاحتياطي (${next})`);

      this._failoverInProgress = true;
      this._setBuffering(true);
      showToast("جاري التشغيل عبر الخادم الاحتياطي…", "info", 3500);

      const a = this.audio;
      const savedTime = a.currentTime || 0;
      a.setAttribute("data-src", next);
      a.src = next;
      a.load();

      if (savedTime > 0) {
        const restoreTime = () => {
          try { a.currentTime = savedTime; } catch (_) {}
          a.removeEventListener("loadedmetadata", restoreTime);
        };
        a.addEventListener("loadedmetadata", restoreTime, { once: true });
      }

      const p = a.play();
      if (p && p.catch) {
        p.catch(() => this._handleFailoverOrError());
      }
      return;
    }

    this._failoverInProgress = false;
    this._setBuffering(false);
    this._notify("onError");
    showToast("تعذر تشغيل الملف الصوتي حالياً.", "error");
  },

  play(id, src, backupSrc = null) {
    this.init();
    if (this.activeId && this.activeId !== id && this.widgets[this.activeId]) {
      this.widgets[this.activeId].onPause();
    }
    this.activeId = id;
    this.activeSources = [src, backupSrc].filter((s, idx, arr) => s && (!idx || s !== arr[0]));
    this.activeSourceIndex = 0;
    this._failoverInProgress = false;

    const a = this.audio;
    a.pause();
    const currentSrc = this.activeSources[0];
    const sameSource = a.getAttribute("data-src") === currentSrc;

    this._setBuffering(true);
    this._notify("onLoading");

    if (!sameSource) {
      a.setAttribute("data-src", currentSrc);
      a.src = currentSrc;
      a.load();
    } else if (a.error || a.networkState === 3) {
      a.load();
    }

    a.volume = this.isMuted ? 0 : this.volume;
    a.playbackRate = this.rate;

    const p = a.play();
    if (p && p.catch) {
      p.catch(() => this._handleFailoverOrError());
    }
  },

  pause() {
    this._failoverInProgress = false;
    this._setBuffering(false);
    if (this.audio) this.audio.pause();
  },

  seekTo(seconds) {
    if (this.audio && !isNaN(seconds)) this.audio.currentTime = seconds;
  },

  setVolume(v) {
    this.volume = Number(v);
    if (this.audio) this.audio.volume = this.isMuted ? 0 : this.volume;
  },

  toggle(id, src, backupSrc = null) {
    if (this.activeId === id && this.audio && !this.audio.paused) {
      this.pause();
      return;
    }
    this.play(id, src, backupSrc);
  },
};

/**
 * Builds Mini Player button for content cards
 */
export function renderMiniPlayer(btn, content) {
  if (!content || !content.audio) {
    btn.setAttribute("aria-disabled", "true");
    btn.classList.add("is-disabled");
    btn.innerHTML = `<span class="icon" aria-hidden="true">${ICONS.play}</span><span data-label>لا يتوفر صوت</span>`;
    return;
  }

  const id = "mini-" + content.id;
  btn.setAttribute("data-player-id", id);
  const audioFile = content.audio || content.audio_url || "";
  const src = resolveMediaUrl(audioFile);
  const archiveFile = content.audioArchive || content.archiveUrl || content.archive_url;
  const backupSrc = archiveFile && archiveFile !== audioFile ? resolveMediaUrl(archiveFile) : null;

  btn.setAttribute("aria-pressed", "false");
  btn.classList.add("mini-player-btn");
  btn.innerHTML = `<span class="icon" aria-hidden="true">${ICONS.play}</span><span data-label>تشغيل</span>`;

  const setLabel = (playing) => {
    btn.setAttribute("aria-pressed", String(playing));
    btn.classList.toggle("is-playing", playing);
    btn.classList.remove("is-buffering");
    const iconEl = btn.querySelector(".icon");
    const labelEl = btn.querySelector("[data-label]");
    if (iconEl) iconEl.innerHTML = playing ? ICONS.pause : ICONS.play;
    if (labelEl) labelEl.textContent = playing ? "إيقاف" : "تشغيل";
  };

  AudioPlayer.register(id, {
    onPlay: () => setLabel(true),
    onPause: () => setLabel(false),
    onLoading: () => {
      if (AudioPlayer.activeId === id && (!AudioPlayer.audio || AudioPlayer.audio.paused || AudioPlayer.audio.currentTime === 0)) {
        btn.classList.add("is-buffering");
        const labelEl = btn.querySelector("[data-label]");
        if (labelEl) labelEl.textContent = "جارٍ التحميل…";
      } else if (AudioPlayer.activeId === id && AudioPlayer.audio && !AudioPlayer.audio.paused) {
        setLabel(true);
      }
    },
    onBuffering: () => {
      if (AudioPlayer.activeId === id) {
        btn.classList.add("is-buffering");
      }
    },
    onReady: () => {
      btn.classList.remove("is-buffering");
      if (AudioPlayer.activeId === id && AudioPlayer.audio) {
        setLabel(!AudioPlayer.audio.paused);
      }
    },
    onTime: () => {
      if (AudioPlayer.activeId === id && AudioPlayer.audio && !AudioPlayer.audio.paused) {
        btn.classList.remove("is-buffering");
        const labelEl = btn.querySelector("[data-label]");
        if (labelEl && labelEl.textContent !== "إيقاف") {
          setLabel(true);
        }
      }
    },
    onError: () => setLabel(false),
    onEnd: () => setLabel(false),
  });

  btn.addEventListener("click", () => {
    AudioPlayer.toggle(id, src, backupSrc);
  });
}

/**
 * Builds Full Player for material detail view
 */
export function renderFullPlayer(container, config) {
  const root = typeof container === "string" ? document.querySelector(container) : container;
  if (!root || !config || !config.src) return;

  const id = "full-" + config.id;
  const initialDuration = config.duration ? formatDuration(config.duration) : "";

  root.innerHTML = `
    <div class="player" data-player-id="${id}">
      <div class="player__top">
        <button type="button" class="player__main-btn" data-role="toggle" aria-pressed="false" aria-label="تشغيل أو إيقاف الملف الصوتي">
          <span class="icon" aria-hidden="true">${ICONS.play}</span>
        </button>
        <div class="player__info">
          <p class="player__title" dir="rtl">${escapeHtml(config.title)}</p>
          <div class="player__timestamps" dir="ltr">
            <span data-role="current">00:00</span>
            <span>/</span>
            <span data-role="duration">${initialDuration || "--:--"}</span>
          </div>
        </div>
      </div>
      <div class="player__timeline">
        <input type="range" class="player__progress" data-role="progress" min="0" max="100" value="0" step="0.1" aria-label="شريط التقدم الصوتي">
      </div>
    </div>
  `;

  const toggleBtn = root.querySelector('[data-role="toggle"]');
  const curEl = root.querySelector('[data-role="current"]');
  const durEl = root.querySelector('[data-role="duration"]');
  const progEl = root.querySelector('[data-role="progress"]');

  const setPlaying = (playing) => {
    toggleBtn.setAttribute("aria-pressed", String(playing));
    toggleBtn.querySelector(".icon").innerHTML = playing ? ICONS.pause : ICONS.play;
  };

  AudioPlayer.register(id, {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onLoading: () => {},
    onReady: () => {
      if (AudioPlayer.audio && AudioPlayer.audio.paused) setPlaying(false);
    },
    onTime: (cur, dur) => {
      if (curEl) curEl.textContent = formatDuration(cur) || "00:00";
      if (durEl && dur && !isNaN(dur)) durEl.textContent = formatDuration(dur);
      if (progEl && dur && !isNaN(dur) && dur > 0) {
        progEl.value = (cur / dur) * 100;
      }
    },
    onMeta: (dur) => {
      if (durEl && dur && !isNaN(dur)) durEl.textContent = formatDuration(dur);
    },
    onError: () => setPlaying(false),
    onEnd: () => {
      setPlaying(false);
      if (progEl) progEl.value = 0;
    },
  });

  toggleBtn.addEventListener("click", () => {
    AudioPlayer.toggle(id, config.src, config.backupSrc);
  });

  if (progEl) {
    progEl.addEventListener("input", () => {
      const pct = Number(progEl.value) / 100;
      const dur = AudioPlayer.audio?.duration || 0;
      if (dur > 0) AudioPlayer.seekTo(pct * dur);
    });
  }
}
