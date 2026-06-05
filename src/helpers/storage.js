/** Skippy storage helpers. Wraps chrome.storage.sync with defaults. */

/** Lower bound for `pollIntervalMs`. Below this the polling loop wastes CPU without buying responsiveness — the per-element cooldown is 2000 ms, so sub-100 ms ticks just thrash. */
const SKIPPY_POLL_MIN_MS = 100;

/** Upper bound for `pollIntervalMs`. 5000 ms is the user-facing ceiling — anything slower and skip buttons would visibly linger before Skippy fires. */
const SKIPPY_POLL_MAX_MS = 5000;

/** Default skip flags. All on by default; verbose logging off by default (opt-in for testing). */
const SKIPPY_DEFAULTS = {
  skipIntro: true,
  skipRecap: true,
  skipCredits: true,
  /** When true, content scripts click the "Next Episode" / "Play Next Episode" button at end-of-episode chrome (separate step from Skip Credits). Default on so existing behavior — clicking the up-next button on Disney+ / Apple TV / Crunchyroll — is preserved for users who upgrade past v0.9.x. Toggle off to let the post-credits screen sit. */
  nextEpisode: true,
  /** When true, content scripts emit `[Skippy]` / `[Skippy/<site>]` console logs. Off by default to keep the DevTools console quiet for normal users; toggle on in the options page to debug a misbehaving adapter. */
  verboseLogging: false,
  /** Polling interval in milliseconds. Clamped to `[SKIPPY_POLL_MIN_MS, SKIPPY_POLL_MAX_MS]` at save time and again at read time as a defensive fallback. 500 ms keeps skip-button latency under half a second on a fresh install. */
  pollIntervalMs: 500,
  enabledSites: {
    "crunchyroll.com": true,
    "disneyplus.com": true,
    "tv.apple.com": true,
    "netflix.com": true,
    "primevideo.com": true,
  },
};

/**
 * Clamp a candidate polling interval to the allowed range. Non-numeric or NaN input
 * collapses to the default so storage never holds an unusable value.
 * @param {unknown} value Candidate interval in milliseconds.
 * @returns {number} A safe integer inside `[SKIPPY_POLL_MIN_MS, SKIPPY_POLL_MAX_MS]`.
 */
function clampPollIntervalMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SKIPPY_DEFAULTS.pollIntervalMs;
  return Math.max(SKIPPY_POLL_MIN_MS, Math.min(SKIPPY_POLL_MAX_MS, Math.round(n)));
}

/** Storage key for all Skippy settings. */
const SKIPPY_STORAGE_KEY = "skippySettings";

/**
 * Load Skippy settings from chrome.storage.sync, merged with defaults.
 * @returns {Promise<typeof SKIPPY_DEFAULTS>} Merged settings object.
 */
async function getSkippySettings() {
  const stored = await chrome.storage.sync.get(SKIPPY_STORAGE_KEY);
  const userSettings = stored[SKIPPY_STORAGE_KEY] || {};
  return {
    ...SKIPPY_DEFAULTS,
    ...userSettings,
    enabledSites: {
      ...SKIPPY_DEFAULTS.enabledSites,
      ...(userSettings.enabledSites || {}),
    },
  };
}

/**
 * Save partial Skippy settings to chrome.storage.sync. Merges with existing.
 * @param {Partial<typeof SKIPPY_DEFAULTS>} patch Fields to overwrite.
 * @returns {Promise<void>}
 */
async function saveSkippySettings(patch) {
  const current = await getSkippySettings();
  const next = { ...current, ...patch };
  // Validate `pollIntervalMs` at the trust boundary so storage can never hold a value
  // outside the supported range, even if the options page is bypassed.
  if (patch && Object.prototype.hasOwnProperty.call(patch, "pollIntervalMs")) {
    next.pollIntervalMs = clampPollIntervalMs(patch.pollIntervalMs);
  }
  await chrome.storage.sync.set({ [SKIPPY_STORAGE_KEY]: next });
}

/**
 * Subscribe to settings changes. Callback fires with latest merged settings.
 * @param {(settings: typeof SKIPPY_DEFAULTS) => void} callback Listener.
 * @returns {void}
 */
function onSkippySettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[SKIPPY_STORAGE_KEY]) return;
    getSkippySettings().then(callback);
  });
}

// Expose globals for non-module content scripts.
globalThis.SkippyStorage = {
  getSkippySettings,
  saveSkippySettings,
  onSkippySettingsChanged,
  clampPollIntervalMs,
  SKIPPY_DEFAULTS,
  SKIPPY_POLL_MIN_MS,
  SKIPPY_POLL_MAX_MS,
};
