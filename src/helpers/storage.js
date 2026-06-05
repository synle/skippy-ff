/** Skippy storage helpers. Wraps chrome.storage.sync with defaults. */

/** Lower bound for `pollIntervalMs`. Below this the polling loop wastes CPU without buying responsiveness — the per-element cooldown is 2000 ms, so sub-100 ms ticks just thrash. */
const SKIPPY_POLL_MIN_MS = 100;

/** Upper bound for `pollIntervalMs`. 5000 ms is the user-facing ceiling — anything slower and skip buttons would visibly linger before Skippy fires. */
const SKIPPY_POLL_MAX_MS = 5000;

/**
 * Canonical list of skip-flag keys. Single source of truth for the four toggles that
 * appear on the master settings card AND on every per-site override card. Iterating
 * this array avoids drift between `SKIPPY_DEFAULTS`, `getEffectiveSiteSettings`, the
 * options page, and the per-site override hydration / merge code.
 * @type {ReadonlyArray<"skipIntro"|"skipRecap"|"skipCredits"|"nextEpisode">}
 */
const SKIPPY_FLAG_KEYS = ["skipIntro", "skipRecap", "skipCredits", "nextEpisode"];

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
    "max.com": true,
    "paramountplus.com": true,
    "peacocktv.com": true,
    "tubitv.com": true,
    "amcplus.com": true,
    "shudder.com": true,
  },
  /**
   * Per-site overrides for the four skip flags. Empty by default — every site follows the
   * master settings. A user opts a site into independent control by setting
   * `siteOverrides[host].useOverride = true`; the four flag values on that record then
   * drive that site's adapter instead of the top-level `skipIntro`/`skipRecap`/`skipCredits`/
   * `nextEpisode`. When `useOverride` is false (or the record is missing) the master flags
   * apply.
   *
   * Shape: `{ [host]: { useOverride: boolean, skipIntro: boolean, skipRecap: boolean, skipCredits: boolean, nextEpisode: boolean } }`.
   * Missing flag fields default to `true` (match the master defaults) so a half-populated
   * record can't accidentally turn skipping off.
   * @type {Record<string, {useOverride: boolean, skipIntro: boolean, skipRecap: boolean, skipCredits: boolean, nextEpisode: boolean}>}
   */
  siteOverrides: {},
};

/**
 * Default shape for a single per-site override record. Used as the merge base when a user
 * first toggles overrides on for a site, and as the read-time fallback when only a subset
 * of fields was persisted. Flag defaults match the master defaults (all on) so flipping
 * `useOverride` on doesn't surprise the user by silently disabling skips.
 * @type {{useOverride: boolean, skipIntro: boolean, skipRecap: boolean, skipCredits: boolean, nextEpisode: boolean}}
 */
const SKIPPY_SITE_OVERRIDE_DEFAULTS = {
  useOverride: false,
  skipIntro: true,
  skipRecap: true,
  skipCredits: true,
  nextEpisode: true,
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
 *
 * `enabledSites` and `siteOverrides` are object-valued so a shallow `...` spread would lose
 * any default keys the user hasn't yet touched. Both are merged one level deep instead;
 * `siteOverrides` further merges each individual site record over
 * `SKIPPY_SITE_OVERRIDE_DEFAULTS` so a partially-persisted record (e.g. only `useOverride`
 * saved before flag defaults existed) doesn't read back as missing flags.
 * @returns {Promise<typeof SKIPPY_DEFAULTS>} Merged settings object.
 */
async function getSkippySettings() {
  const stored = await chrome.storage.sync.get(SKIPPY_STORAGE_KEY);
  const userSettings = stored[SKIPPY_STORAGE_KEY] || {};
  const userOverrides = userSettings.siteOverrides || {};
  /** @type {Record<string, {useOverride: boolean, skipIntro: boolean, skipRecap: boolean, skipCredits: boolean, nextEpisode: boolean}>} */
  const mergedOverrides = {};
  for (const [host, record] of Object.entries(userOverrides)) {
    if (!record || typeof record !== "object") continue;
    mergedOverrides[host] = { ...SKIPPY_SITE_OVERRIDE_DEFAULTS, .../** @type {object} */ (record) };
  }
  return {
    ...SKIPPY_DEFAULTS,
    ...userSettings,
    enabledSites: {
      ...SKIPPY_DEFAULTS.enabledSites,
      ...(userSettings.enabledSites || {}),
    },
    siteOverrides: mergedOverrides,
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

/**
 * Resolve the effective skip-flag values for a single site, applying the per-site override
 * rule. Adapters call this once per `findXxxSkipButton(settings)` invocation and consume the
 * returned object instead of reading `settings.skipIntro` / `settings.enabledSites[host]`
 * directly — that keeps the override logic in one place.
 *
 * Rule (mirrors the user-facing copy on the options page):
 *   1. If the site is disabled (`enabledSites[siteKey] === false`), every flag returns
 *      `false` and `enabled` is `false`. The adapter should short-circuit to `null` in
 *      that case, but a defensive `false` on every flag means a half-checked adapter
 *      that forgets the early return still won't skip.
 *   2. If a per-site override record exists with `useOverride === true`, return that
 *      record's flag values (each falling back to `true` if missing, matching the master
 *      defaults).
 *   3. Otherwise, return the master flag values from `settings`.
 *
 * `siteKey` is the hostname key used in `enabledSites` / `siteOverrides` (e.g.
 * `"crunchyroll.com"`, `"tv.apple.com"`). Adapters that serve multiple hosts (AMC+ /
 * Shudder share an adapter) resolve their own per-host key first and pass it in.
 *
 * Defensive against malformed settings: an undefined/null `settings`, missing
 * `enabledSites`, missing `siteOverrides`, or non-object override record all fall back to
 * the master values (or master defaults). That keeps adapters from crashing if storage is
 * corrupted or a downgrade leaves stale shape behind.
 * @param {object | undefined | null} settings Current merged Skippy settings.
 * @param {string} siteKey Host key used in `enabledSites` / `siteOverrides`.
 * @returns {{enabled: boolean, skipIntro: boolean, skipRecap: boolean, skipCredits: boolean, nextEpisode: boolean, source: "disabled"|"site"|"master"}} Resolved per-site flags.
 */
function getEffectiveSiteSettings(settings, siteKey) {
  const s = settings || {};
  const enabledSites = s.enabledSites || {};
  const enabled = enabledSites[siteKey] !== false;
  if (!enabled) {
    return { enabled: false, skipIntro: false, skipRecap: false, skipCredits: false, nextEpisode: false, source: "disabled" };
  }
  const overrides = s.siteOverrides || {};
  const record = overrides[siteKey];
  if (record && typeof record === "object" && record.useOverride === true) {
    return {
      enabled: true,
      skipIntro: record.skipIntro !== false,
      skipRecap: record.skipRecap !== false,
      skipCredits: record.skipCredits !== false,
      nextEpisode: record.nextEpisode !== false,
      source: "site",
    };
  }
  return {
    enabled: true,
    skipIntro: s.skipIntro !== false,
    skipRecap: s.skipRecap !== false,
    skipCredits: s.skipCredits !== false,
    nextEpisode: s.nextEpisode !== false,
    source: "master",
  };
}

// Expose globals for non-module content scripts.
globalThis.SkippyStorage = {
  getSkippySettings,
  saveSkippySettings,
  onSkippySettingsChanged,
  clampPollIntervalMs,
  getEffectiveSiteSettings,
  SKIPPY_DEFAULTS,
  SKIPPY_SITE_OVERRIDE_DEFAULTS,
  SKIPPY_FLAG_KEYS,
  SKIPPY_POLL_MIN_MS,
  SKIPPY_POLL_MAX_MS,
};
