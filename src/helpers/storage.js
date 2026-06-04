/** Skippy storage helpers. Wraps chrome.storage.sync with defaults. */

/** Default skip flags. All on by default; verbose logging off by default (opt-in for testing). */
const SKIPPY_DEFAULTS = {
  skipIntro: true,
  skipRecap: true,
  skipCredits: true,
  /** When true, content scripts emit `[Skippy]` / `[Skippy/<site>]` console logs. Off by default to keep the DevTools console quiet for normal users; toggle on in the options page to debug a misbehaving adapter. */
  verboseLogging: false,
  enabledSites: {
    "crunchyroll.com": true,
    "disneyplus.com": true,
    "tv.apple.com": true,
  },
};

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
  SKIPPY_DEFAULTS,
};
