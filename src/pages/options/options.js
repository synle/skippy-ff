/** Skippy options page controller. Binds checkboxes to chrome.storage.sync via SkippyStorage. */

/* global SkippyStorage */

const FLAG_IDS = ["skipIntro", "skipRecap", "skipCredits"];

/**
 * Show a transient status message in the footer.
 * @param {string} text Message to display.
 * @returns {void}
 */
function showStatus(text) {
  const el = document.getElementById("status");
  el.textContent = text;
  clearTimeout(showStatus._timer);
  showStatus._timer = setTimeout(() => {
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
    const input = document.getElementById(id);
    input.checked = Boolean(settings[id]);
    input.addEventListener("change", async () => {
      await SkippyStorage.saveSkippySettings({ [id]: input.checked });
      showStatus("Saved");
    });
  }

  // Hydrate per-site toggles.
  document.querySelectorAll("input[data-site]").forEach((input) => {
    const site = input.dataset.site;
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
