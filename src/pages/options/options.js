/** Skippy options page controller. Binds checkboxes to chrome.storage.sync via SkippyStorage. */

import "../../helpers/storage.js";

const FLAG_IDS = ["skipIntro", "skipRecap", "skipCredits", "nextEpisode", "verboseLogging"];

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
 * Initialize the options page: hydrate checkboxes and wire change handlers.
 * @returns {Promise<void>}
 */
async function init() {
  const settings = await SkippyStorage.getSkippySettings();

  // Hydrate top-level skip flags.
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

  // Hydrate per-site toggles.
  const siteInputs = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll("input[data-site]"));
  siteInputs.forEach((input) => {
    const site = input.dataset.site;
    if (!site) return;
    input.checked = settings.enabledSites[site] !== false;
    input.addEventListener("change", async () => {
      const current = await SkippyStorage.getSkippySettings();
      await SkippyStorage.saveSkippySettings({
        enabledSites: { ...current.enabledSites, [site]: input.checked },
      });
      showStatus("Saved");
    });
  });
}

init();
