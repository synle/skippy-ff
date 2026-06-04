/** Skippy Crunchyroll adapter. Detects and clicks Skip Intro/Recap/Credits buttons and the Next Episode button. */

/** Delay before the Next Episode button is allowed to be clicked, measured from the last time Skip Credits was returned to the core. Gives the player a moment to surface the up-next chrome and lets the credits-skip animation finish before we advance the episode. */
const NEXT_EPISODE_DELAY_AFTER_CREDITS_MS = 5000;

/** Wall-clock timestamp (ms) at which Skip Credits was last handed to the polling loop for clicking. `0` means "never within this page lifetime". Used to gate the Next Episode click on `Date.now() - lastSkipCreditsAt >= NEXT_EPISODE_DELAY_AFTER_CREDITS_MS`. */
let lastSkipCreditsAt = 0;

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
 * Find the Crunchyroll "Next Episode" button rendered after credits roll. The button
 * carries a stable `data-testid="next-episode-button"` plus `aria-label="Next Episode"`;
 * we probe the testid first and fall back to the aria-label so the adapter survives
 * either attribute drifting. Same visible-then-present probe ladder as
 * `findButtonByAriaLabel` because Crunchyroll fades the player controls on idle.
 *
 * Caller is responsible for the `nextEpisode` flag and the post-credits delay gate —
 * this function just resolves the DOM candidate.
 * @returns {HTMLElement|null} The Next Episode button, or null when not yet rendered.
 */
function findNextEpisodeButton() {
  const nodes = document.querySelectorAll('button[data-testid="next-episode-button"], button[aria-label="Next Episode"]');
  for (const node of nodes) {
    if (SkippyCore.skippyIsVisible(node)) return /** @type {HTMLElement} */ (node);
  }
  for (const node of nodes) {
    if (SkippyCore.skippyIsPresent(node)) return /** @type {HTMLElement} */ (node);
  }
  return null;
}

/**
 * Site adapter for Crunchyroll. Returns the visible skip button to click, or null.
 *
 * Order matters: Skip Intro → Skip Recap → Skip Credits → Next Episode. When Skip Credits
 * is returned we stamp `lastSkipCreditsAt` so the Next Episode branch waits
 * `NEXT_EPISODE_DELAY_AFTER_CREDITS_MS` before firing — the player needs a moment to
 * dismiss the credits-skip animation and surface the up-next chrome, and clicking too
 * eagerly lands on a stale handler.
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
    if (btn) {
      lastSkipCreditsAt = Date.now();
      return btn;
    }
  }
  if (settings.nextEpisode) {
    if (Date.now() - lastSkipCreditsAt < NEXT_EPISODE_DELAY_AFTER_CREDITS_MS) return null;
    const btn = findNextEpisodeButton();
    if (btn) return btn;
  }
  return null;
}

SkippyCore.skippyStart(findCrunchyrollSkipButton);
