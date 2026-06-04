/** Skippy Crunchyroll adapter. Detects and clicks Skip Intro/Recap/Credits buttons. */

/**
 * Find a button by its aria-label. Crunchyroll uses aria-label="Skip Intro" etc.
 * The site keeps the button mounted with opacity/pointer-events toggling, so a CSS
 * visibility check is required before clicking.
 * @param {string} label Exact aria-label value.
 * @returns {HTMLElement|null} Visible match or null.
 */
function findButtonByAriaLabel(label) {
  const nodes = document.querySelectorAll(`button[aria-label="${label}"]`);
  for (const node of nodes) {
    if (SkippyCore.skippyIsVisible(node)) return node;
  }
  return null;
}

/**
 * Site adapter for Crunchyroll. Returns the visible skip button to click, or null.
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findCrunchyrollSkipButton(settings) {
  if (settings.enabledSites && settings.enabledSites["crunchyroll.com"] === false) return null;

  if (settings.skipIntro) {
    const btn = findButtonByAriaLabel("Skip Intro");
    if (btn) return btn;
  }
  if (settings.skipRecap) {
    const btn = findButtonByAriaLabel("Skip Recap");
    if (btn) return btn;
  }
  if (settings.skipCredits) {
    const btn = findButtonByAriaLabel("Skip Credits");
    if (btn) return btn;
  }
  return null;
}

SkippyCore.skippyStart(findCrunchyrollSkipButton);
