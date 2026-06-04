/** Skippy Crunchyroll adapter. Detects and clicks Skip Intro/Recap/Credits buttons and the Next Episode button. */

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
 * Resolve the Crunchyroll "Next Episode" button without filtering on visibility.
 *
 * The button (stable `data-testid="next-episode-button"`, `aria-label="Next Episode"`)
 * lives in the player's persistent control chrome — Crunchyroll renders it any time the
 * player is up, regardless of whether the episode is mid-stream, in credits, or done.
 * That means a `skippyIsVisible` gate here is useless: it returns the button mid-episode
 * just as readily as during the up-next window, and Skippy would fire over and over.
 *
 * The discriminator instead lives at the caller: `findCrunchyrollSkipButton` only looks
 * up Next Episode when the Skip Credits prompt is *currently visible* — Crunchyroll only
 * surfaces that prompt during the credits roll, so it's a reliable "we're at end of
 * episode" signal.
 * @returns {HTMLElement|null} The Next Episode button, or null when not rendered.
 */
function findNextEpisodeButton() {
  return /** @type {HTMLElement|null} */ (
    document.querySelector('button[data-testid="next-episode-button"], button[aria-label="Next Episode"]')
  );
}

/**
 * Site adapter for Crunchyroll. Returns the visible button to click, or null.
 *
 * Order: Skip Intro → Skip Recap → end-of-episode dispatch.
 *
 * End-of-episode dispatch uses Skip Credits visibility as the "we're at credits" signal
 * (Crunchyroll only surfaces that prompt during the credits roll). Once detected:
 *   - `nextEpisode` flag on → click Next Episode (advances past the post-credits screen
 *     in one shot). The detection signal is independent of the `skipCredits` flag — a
 *     user can disable credit-skipping but still want auto-advance.
 *   - `nextEpisode` flag off + `skipCredits` flag on → click Skip Credits (lands on the
 *     post-credits "Up Next" screen).
 *   - Both off → no-op.
 *
 * Earlier versions used a 5-second timer after Skip Credits to gate the Next Episode
 * click, but the timer was a workaround for a stricter problem: the Next Episode button
 * is mounted full-time, so any time- or visibility-based gate on it alone false-positives
 * mid-episode. Anchoring on Skip Credits visibility removes the false positives without
 * any timing state.
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

  // End-of-episode dispatch — see function docstring for the trigger model.
  const skipCreditsBtn = findButtonByAriaLabel("Skip Credits");
  if (skipCreditsBtn) {
    if (settings.nextEpisode) {
      const nextBtn = findNextEpisodeButton();
      if (nextBtn) return nextBtn;
    }
    if (settings.skipCredits) return skipCreditsBtn;
  }
  return null;
}

SkippyCore.skippyStart(findCrunchyrollSkipButton);
