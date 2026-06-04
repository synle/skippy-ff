/** Skippy Crunchyroll adapter. Detects and clicks Skip Intro/Recap/Credits buttons and the Next Episode button. */

/** Delay before the Next Episode button is allowed to be clicked, measured from the last time Skip Credits was returned to the core. Gives the player a moment to surface the up-next chrome and lets the credits-skip animation finish before we advance the episode. */
const NEXT_EPISODE_DELAY_AFTER_CREDITS_MS = 5000;

/** Wall-clock timestamp (ms) at which Skip Credits was last handed to the polling loop for clicking. `0` means "never within this page lifetime". Used to gate the Next Episode click on `Date.now() - lastSkipCreditsAt >= NEXT_EPISODE_DELAY_AFTER_CREDITS_MS`. */
let lastSkipCreditsAt = 0;

/**
 * Find a button by its aria-label. Crunchyroll uses aria-label="Skip Intro" etc.
 *
 * Strict visibility only — `skippyIsVisible` requires opacity ≥ 0.5 and
 * `pointer-events ≠ "none"`. Crunchyroll keeps skip buttons mounted with
 * `opacity: 0` while the player controls are faded out on mouse idle; the click
 * handler is still wired, so a programmatic click would technically succeed.
 * Going down that path is what we used to do, and it caused a UI strobe loop —
 * every click was treated by the player as user interaction and faded the
 * control overlay back in, where the next 500 ms poll would re-click the still-
 * idle-faded button. Restricting clicks to genuinely-visible buttons means we
 * only fire when the player has already surfaced the prompt for the user, which
 * is exactly when a human would click anyway. Trade-off: an idle viewer doesn't
 * get an auto-skip until they move the mouse; that's acceptable because the
 * synthetic click was waking up the chrome regardless.
 * @param {string} label Exact aria-label value.
 * @returns {HTMLElement|null} Matching button or null.
 */
function findButtonByAriaLabel(label) {
  const nodes = document.querySelectorAll(`button[aria-label="${label}"]`);
  for (const node of nodes) {
    if (SkippyCore.skippyIsVisible(node)) return node;
  }
  return null;
}

/**
 * Find the Crunchyroll "Next Episode" button rendered after credits roll. The button
 * carries a stable `data-testid="next-episode-button"` plus `aria-label="Next Episode"`;
 * we probe the testid first and fall back to the aria-label so the adapter survives
 * either attribute drifting.
 *
 * Strict visibility only — the up-next chrome surfaces this button at full opacity
 * for the entire post-credits window, so the permissive `skippyIsPresent` fallback
 * would just find it the moment Crunchyroll mounts the element and fire long before
 * the chrome animates in.
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
