/** Skippy options page controller. Binds master + per-site controls to chrome.storage.sync via SkippyStorage. */

import "../../helpers/storage.js";

/** Top-level skip flags that appear on the master card. Mirrored in `SKIPPY_FLAG_KEYS`. */
const FLAG_IDS = ["skipIntro", "skipRecap", "skipCredits", "nextEpisode", "verboseLogging"];

/** Labels for the four skip-flag toggles on each site card. Same order as `SKIPPY_FLAG_KEYS`. */
const SITE_FLAG_LABELS = {
  skipIntro: "Skip Intro",
  skipRecap: "Skip Recap",
  skipCredits: "Skip Credits",
  nextEpisode: "Auto start next episode",
};

let statusTimer = 0;

/**
 * Show a transient status message in the footer.
 * @param {string} text Message to display.
 * @returns {void}
 */
function showStatus(text) {
  const el = /** @type {HTMLElement | null} */ (document.getElementById("status"));
  if (!el) return;
  el.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.textContent = "";
  }, 1200);
}

/**
 * Build one site card's DOM. Each card has: site title, enable toggle, follow-master
 * toggle, and a hidden block of four flag toggles that shows only when "follow master"
 * is unchecked. Returns the root `<div>` for the caller to append.
 *
 * Cards are generated in JS (rather than authored in HTML) because (a) the same five
 * controls per site means hand-authoring is 55 nearly-identical `<label>` elements and
 * (b) the override-block reveal/hide is easier to wire when the elements live next to
 * their state mutations.
 * @param {{host: string, label: string}} site Site metadata.
 * @returns {HTMLDivElement} The card root element.
 */
function buildSiteCard(site) {
  const flagKeys = SkippyStorage.SKIPPY_FLAG_KEYS;
  const card = document.createElement("div");
  card.className = "site-card";
  card.dataset.host = site.host;

  const title = document.createElement("h3");
  title.textContent = site.label;
  card.appendChild(title);

  const enableLabel = document.createElement("label");
  enableLabel.className = "toggle";
  const enableInput = document.createElement("input");
  enableInput.type = "checkbox";
  enableInput.dataset.role = "enable";
  enableLabel.appendChild(enableInput);
  const enableSpan = document.createElement("span");
  enableSpan.textContent = `Enable on ${site.label}`;
  enableLabel.appendChild(enableSpan);
  card.appendChild(enableLabel);

  const followLabel = document.createElement("label");
  followLabel.className = "toggle";
  const followInput = document.createElement("input");
  followInput.type = "checkbox";
  followInput.dataset.role = "follow-master";
  followLabel.appendChild(followInput);
  const followSpan = document.createElement("span");
  followSpan.textContent = "Follow master settings";
  followLabel.appendChild(followSpan);
  card.appendChild(followLabel);

  const overrides = document.createElement("div");
  overrides.className = "site-overrides";
  overrides.dataset.role = "overrides";
  for (const key of flagKeys) {
    const label = document.createElement("label");
    label.className = "toggle toggle--nested";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.flag = key;
    label.appendChild(input);
    const span = document.createElement("span");
    span.textContent = SITE_FLAG_LABELS[key];
    label.appendChild(span);
    overrides.appendChild(label);
  }
  card.appendChild(overrides);

  return card;
}

/**
 * Hydrate one site card from current settings and wire change handlers. The card's three
 * input groups (enable, follow-master, per-flag) all persist back to
 * `chrome.storage.sync` via `SkippyStorage.saveSkippySettings`.
 *
 * Each handler re-reads current settings before writing — chrome.storage is a shared mutable
 * surface (other tabs / `popup` instances may have written between hydration and our change),
 * so a stale closure copy would clobber concurrent edits.
 * @param {HTMLDivElement} card The card root from `buildSiteCard`.
 * @param {{host: string, label: string}} site Site metadata.
 * @param {typeof SkippyStorage.SKIPPY_DEFAULTS} settings Initial merged settings for hydration.
 * @returns {void}
 */
function bindSiteCard(card, site, settings) {
  const flagKeys = SkippyStorage.SKIPPY_FLAG_KEYS;
  const enableInput = /** @type {HTMLInputElement} */ (card.querySelector('input[data-role="enable"]'));
  const followInput = /** @type {HTMLInputElement} */ (card.querySelector('input[data-role="follow-master"]'));
  const overridesEl = /** @type {HTMLDivElement} */ (card.querySelector('[data-role="overrides"]'));
  const flagInputs = /** @type {NodeListOf<HTMLInputElement>} */ (card.querySelectorAll("input[data-flag]"));

  const enabled = settings.enabledSites[site.host] !== false;
  const record = settings.siteOverrides[site.host] || SkippyStorage.SKIPPY_SITE_OVERRIDE_DEFAULTS;
  const useOverride = record.useOverride === true;

  enableInput.checked = enabled;
  // "Follow master" reads inverse of `useOverride` — checked means "use master", unchecked
  // means "use my own settings". Phrased this way because the default state (every site
  // follows master) reads naturally as "checked = following".
  followInput.checked = !useOverride;
  for (const input of flagInputs) {
    const key = /** @type {keyof typeof SITE_FLAG_LABELS} */ (input.dataset.flag);
    input.checked = record[key] !== false;
  }

  applyCardVisibility(card, enabled, !useOverride);

  enableInput.addEventListener("change", async () => {
    const current = await SkippyStorage.getSkippySettings();
    await SkippyStorage.saveSkippySettings({
      enabledSites: { ...current.enabledSites, [site.host]: enableInput.checked },
    });
    applyCardVisibility(card, enableInput.checked, followInput.checked);
    showStatus("Saved");
  });

  followInput.addEventListener("change", async () => {
    const current = await SkippyStorage.getSkippySettings();
    const existing = current.siteOverrides[site.host] || SkippyStorage.SKIPPY_SITE_OVERRIDE_DEFAULTS;
    await SkippyStorage.saveSkippySettings({
      siteOverrides: {
        ...current.siteOverrides,
        [site.host]: { ...existing, useOverride: !followInput.checked },
      },
    });
    applyCardVisibility(card, enableInput.checked, followInput.checked);
    showStatus("Saved");
  });

  for (const input of flagInputs) {
    const key = /** @type {keyof typeof SITE_FLAG_LABELS} */ (input.dataset.flag);
    input.addEventListener("change", async () => {
      const current = await SkippyStorage.getSkippySettings();
      const existing = current.siteOverrides[site.host] || SkippyStorage.SKIPPY_SITE_OVERRIDE_DEFAULTS;
      const patch = { ...existing, [key]: input.checked };
      // Touching any individual override flag implies the user wants the override on —
      // otherwise the toggle would silently no-op. Flip `useOverride` true on first nudge.
      patch.useOverride = true;
      await SkippyStorage.saveSkippySettings({
        siteOverrides: { ...current.siteOverrides, [site.host]: patch },
      });
      followInput.checked = false;
      applyCardVisibility(card, enableInput.checked, false);
      showStatus("Saved");
    });
  }

  // Reusable visibility helper for the card's two collapse states.
  /**
   * Update card chrome: disabled cards dim, follow-master cards hide overrides.
   * @param {HTMLDivElement} cardEl The card root.
   * @param {boolean} isEnabled Site enabled toggle state.
   * @param {boolean} isFollowingMaster Follow-master toggle state.
   * @returns {void}
   */
  function applyCardVisibility(cardEl, isEnabled, isFollowingMaster) {
    cardEl.classList.toggle("site-card--disabled", !isEnabled);
    followInput.disabled = !isEnabled;
    overridesEl.hidden = isFollowingMaster || !isEnabled;
    for (const input of flagInputs) input.disabled = isFollowingMaster || !isEnabled;
  }
}

/**
 * Initialize the options page: hydrate master checkboxes, render + bind site cards, wire
 * poll interval input.
 * @returns {Promise<void>}
 */
async function init() {
  const settings = await SkippyStorage.getSkippySettings();

  // Hydrate top-level skip flags + verbose logging.
  for (const id of FLAG_IDS) {
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (!input) continue;
    input.checked = Boolean(settings[id]);
    input.addEventListener("change", async () => {
      await SkippyStorage.saveSkippySettings({ [id]: input.checked });
      showStatus("Saved");
    });
  }

  // Hydrate the poll-interval number input. Round-trip through clampPollIntervalMs so
  // a user typing an out-of-range value snaps it to the supported floor / ceiling on blur.
  const pollInput = /** @type {HTMLInputElement | null} */ (document.getElementById("pollIntervalMs"));
  if (pollInput) {
    pollInput.value = String(settings.pollIntervalMs);
    pollInput.addEventListener("change", async () => {
      const clamped = SkippyStorage.clampPollIntervalMs(pollInput.value);
      pollInput.value = String(clamped);
      await SkippyStorage.saveSkippySettings({ pollIntervalMs: clamped });
      showStatus("Saved");
    });
  }

  // Render per-site cards from the centralized SKIPPY_SITES list (shared with the
  // background service worker so the context menu and the options page can't drift).
  const container = /** @type {HTMLElement | null} */ (document.getElementById("site-cards"));
  if (container) {
    for (const site of SkippyStorage.SKIPPY_SITES) {
      const card = buildSiteCard(site);
      container.appendChild(card);
      bindSiteCard(card, site, settings);
    }
  }
}

init();
