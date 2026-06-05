/** Skippy Crunchyroll adapter. Detects and clicks Skip Intro/Recap/Credits buttons and the Next Episode button. */

/**
 * Throttled adapter-scoped debug logger — wraps `SkippyCore.skippyDLog` with a site prefix
 * and dedupe key namespace. Silent unless `settings.verboseLogging` is on. Same shape as
 * the helper in `skippy-disneyplus.js` / `skippy-appletv.js` so the console-filter UX is
 * consistent across adapters (`[Skippy/Crunchyroll]` → grep).
 * @param {string} key Stable identifier for the log line (e.g. "scan").
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
function dlog(key, message, ...extras) {
  SkippyCore.skippyDLog(`crunchyroll:${key}`, `[Skippy/Crunchyroll] ${message}`, ...extras);
}

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
 * Probe a button by aria-label and report its full state — present / visible / rect /
 * computed opacity / pointer-events. Used by the per-tick scan log and the `__skippy()`
 * inspector to make it obvious why a button did or didn't get picked. Returns the same
 * shape regardless of whether any candidate was found, so callers can dump it directly.
 * @param {string} label Exact aria-label value to probe.
 * @returns {{label: string, count: number, visible: boolean, present: boolean, rect: DOMRect|null, opacity: string|null, pointerEvents: string|null}} Snapshot.
 */
function probeByAriaLabel(label) {
  const nodes = document.querySelectorAll(`button[aria-label="${label}"]`);
  const first = nodes[0] || null;
  if (!first) return { label, count: 0, visible: false, present: false, rect: null, opacity: null, pointerEvents: null };
  const style = window.getComputedStyle(first);
  return {
    label,
    count: nodes.length,
    visible: SkippyCore.skippyIsVisible(first),
    present: SkippyCore.skippyIsPresent(first),
    rect: first.getBoundingClientRect(),
    opacity: style.opacity,
    pointerEvents: style.pointerEvents,
  };
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
 *
 * Verbose logging emits a per-tick scan trace (dedup'd by `skippyDLog`) and a per-return
 * decision trace so you can grep the console for `[Skippy/Crunchyroll]` and see exactly
 * which branch fired and what the visibility state of each candidate was at the time.
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findCrunchyrollSkipButton(settings) {
  const effective = SkippyStorage.getEffectiveSiteSettings(settings, "crunchyroll.com");
  if (!effective.enabled) {
    dlog("disabled", "disabled for crunchyroll.com via settings");
    return null;
  }

  const skipIntro = probeByAriaLabel("Skip Intro");
  const skipRecap = probeByAriaLabel("Skip Recap");
  const skipCredits = probeByAriaLabel("Skip Credits");
  const nextEpisodeBtn = findNextEpisodeButton();

  // Throttled scan trace — repeats are dedup'd by skippyDLog so an idle player produces
  // one line per state change, not 2/sec of noise.
  dlog(
    "scan",
    `scan(source=${effective.source}): intro(count=${skipIntro.count} visible=${skipIntro.visible}), ` +
      `recap(count=${skipRecap.count} visible=${skipRecap.visible}), ` +
      `credits(count=${skipCredits.count} visible=${skipCredits.visible}), ` +
      `nextEpisodeMounted=${!!nextEpisodeBtn}`,
  );

  if (effective.skipIntro && skipIntro.visible) {
    const btn = findButtonByAriaLabel("Skip Intro");
    if (btn) {
      dlog("decide-intro", "→ return Skip Intro");
      return btn;
    }
  }
  if (effective.skipRecap && skipRecap.visible) {
    const btn = findButtonByAriaLabel("Skip Recap");
    if (btn) {
      dlog("decide-recap", "→ return Skip Recap");
      return btn;
    }
  }

  // End-of-episode dispatch — Skip Credits visibility is the trigger.
  if (skipCredits.visible) {
    const skipCreditsBtn = findButtonByAriaLabel("Skip Credits");
    if (effective.nextEpisode) {
      if (nextEpisodeBtn) {
        dlog("decide-next", "→ return Next Episode (skipCredits visible + nextEpisode flag on)");
        return nextEpisodeBtn;
      }
      dlog("decide-next-miss", "skipCredits visible + nextEpisode flag on, but Next Episode button not found in DOM");
    }
    if (effective.skipCredits && skipCreditsBtn) {
      dlog("decide-credits", "→ return Skip Credits (nextEpisode disabled or Next Episode button missing)");
      return skipCreditsBtn;
    }
    dlog("decide-credits-noop", "skipCredits visible but both nextEpisode + skipCredits flags off → no-op");
    return null;
  }

  // Optional: surface a one-time hint when Next Episode is in DOM but Skip Credits is
  // NOT visible. Pre-fix code would have clicked Next Episode here; we deliberately
  // don't. Logging it makes the new gate observable while debugging.
  if (nextEpisodeBtn) {
    dlog("guard-next", "Next Episode mounted but Skip Credits not visible → no click (mid-episode false-positive guard)");
  }
  return null;
}

SkippyCore.skippyLog("[Skippy/Crunchyroll] adapter loaded on", location.href);

/**
 * Live inspector — paste `__skippy()` in DevTools to dump the adapter's current view of
 * the page. Shows the visibility / opacity / pointer-events of each skip button and
 * whether the Next Episode button is mounted. Useful for "why didn't Skippy skip?" or
 * "why did Skippy click Next Episode?" — the snapshot tells you which branch of
 * `findCrunchyrollSkipButton` would have been taken at the moment you ran it. Emits
 * regardless of the verbose-logging setting; this is a manual probe.
 * @returns {object} Snapshot of current adapter state.
 */
globalThis.__skippy = function __skippy() {
  const nextBtn = findNextEpisodeButton();
  const snapshot = {
    href: location.href,
    skipIntro: probeByAriaLabel("Skip Intro"),
    skipRecap: probeByAriaLabel("Skip Recap"),
    skipCredits: probeByAriaLabel("Skip Credits"),
    nextEpisode: nextBtn
      ? {
          present: SkippyCore.skippyIsPresent(nextBtn),
          visible: SkippyCore.skippyIsVisible(nextBtn),
          rect: nextBtn.getBoundingClientRect(),
          ariaLabel: nextBtn.getAttribute("aria-label"),
          testid: nextBtn.getAttribute("data-testid"),
        }
      : null,
  };
  console.log("[Skippy/Crunchyroll] snapshot", snapshot);
  return snapshot;
};

SkippyCore.skippyStart(findCrunchyrollSkipButton);
