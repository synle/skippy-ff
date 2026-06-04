/** Skippy Crunchyroll adapter. Detects and clicks Skip Intro/Recap/Credits buttons. */

/**
 * Find a button by its aria-label. Crunchyroll uses aria-label="Skip Intro" etc.
 * The site keeps the button mounted with `opacity: 0` + `pointer-events: none` while
 * the player controls are faded out on mouse idle — the click handler is still wired
 * up, so a programmatic `.click()` works regardless. We try the strict visibility
 * gate first (fast path: user is moving the mouse, controls visible) and then fall
 * back to a permissive presence check (slow path: idle, button mounted but visually
 * hidden). Without the fallback Skippy would silently no-op for users who put the
 * cursor down and walk away.
 * @param {string} label Exact aria-label value.
 * @returns {HTMLElement|null} Matching button or null.
 */
function findButtonByAriaLabel(label) {
  const nodes = document.querySelectorAll(`button[aria-label="${label}"]`);
  for (const node of nodes) {
    if (SkippyCore.skippyIsVisible(node)) return node;
  }
  for (const node of nodes) {
    if (SkippyCore.skippyIsPresent(node)) return node;
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
