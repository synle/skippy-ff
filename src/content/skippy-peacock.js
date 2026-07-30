/** Skippy Peacock adapter. Detects and clicks Skip Intro / Skip Recap / Up Next on peacocktv.com. */

/**
 * Throttled adapter-scoped debug logger — wraps `SkippyCore.skippyDLog` with a site prefix
 * and dedupe key namespace. Silent unless `settings.verboseLogging` is on.
 * @param {string} key Stable identifier for the log line (e.g. "scan").
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
function dlog(key, message, ...extras) {
  SkippyCore.skippyDLog(`peacock:${key}`, `[Skippy/Peacock] ${message}`, ...extras);
}

/**
 * Normalize a button's visible text into a comparable form: trim, collapse internal
 * whitespace, lowercase.
 * @param {Element|null|undefined} el Element to read text from.
 * @returns {string} Normalized text content, or "" if null/empty.
 */
function normText(el) {
  return ((el && el.textContent) || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Collect every `<button>` (and `[role="button"]`) on the page. Peacock's web player
 * (based on Sky's player) renders skip buttons as real `<button>` elements in light DOM.
 * @returns {HTMLElement[]} All clickable button-like elements on the page.
 */
function collectButtons() {
  return /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll('button, [role="button"]'))
  );
}

/**
 * Find a button matching one of:
 *   1. A `data-testid` attribute whose value contains `testidToken` (e.g.
 *      "skip-intro", "skip-recap", "up-next"). Substring match tolerates the
 *      `player-skip-intro-button` and similar suffix variants.
 *   2. A normalized text content equal to one of `textLabels` (case-insensitive,
 *      whitespace-collapsed).
 *
 * Returns the first VISIBLE match, with a `skippyIsPresent` permissive fallback for
 * mid-fade chrome states.
 * @param {string} testidToken Substring to match against `data-testid`.
 * @param {string[]} textLabels Normalized text labels (case-insensitive) the button's visible label may equal.
 * @returns {HTMLElement|null} The matched button, or null.
 */
function findButton(testidToken, textLabels) {
  const byTestId = /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll(`[data-testid*="${testidToken}"]`))
  );
  const candidates = /** @type {HTMLElement[]} */ ([]);
  for (const el of byTestId) {
    if (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button") {
      if (!candidates.includes(el)) candidates.push(el);
    }
  }

  const wantedSet = new Set(textLabels.map((t) => t.toLowerCase()));
  for (const btn of collectButtons()) {
    if (wantedSet.has(normText(btn)) && !candidates.includes(btn)) candidates.push(btn);
  }

  for (const node of candidates) {
    if (SkippyCore.skippyIsVisible(node)) return node;
  }
  for (const node of candidates) {
    if (SkippyCore.skippyIsPresent(node)) {
      dlog(
        `fallback-${testidToken}`,
        `no fully-visible candidate for "${textLabels[0]}", using present fallback`,
        node,
      );
      return node;
    }
  }
  return null;
}

/**
 * Probe one Peacock button label and report counts so a verbose-log reader can tell
 * whether the page is currently rendering that prompt.
 * @param {string} testidToken Substring of the expected `data-testid` value.
 * @param {string[]} textLabels Normalized text labels to match.
 * @returns {{label: string, testidCount: number, textCount: number, visibleCount: number}} Snapshot.
 */
function probe(testidToken, textLabels) {
  const byTestId = Array.from(document.querySelectorAll(`[data-testid*="${testidToken}"]`)).filter(
    (el) => el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button",
  );
  const wantedSet = new Set(textLabels.map((t) => t.toLowerCase()));
  const byText = collectButtons().filter((b) => wantedSet.has(normText(b)));
  const all = new Set([.../** @type {HTMLElement[]} */ (byTestId), ...byText]);
  let visibleCount = 0;
  for (const el of all) if (SkippyCore.skippyIsVisible(el)) visibleCount++;
  return {
    label: textLabels[0],
    testidCount: byTestId.length,
    textCount: byText.length,
    visibleCount,
  };
}

/**
 * Site adapter for Peacock. Returns the visible button to click, or null.
 *
 * Order: Skip Intro → Skip Recap → Up Next (end-of-episode autoplay).
 *
 * Peacock surfaces Skip Intro / Skip Recap / Up Next. There is no distinct "Skip
 * Credits" — the end-of-episode hand-off goes through the Up Next prompt, which we
 * gate behind the `nextEpisode` flag.
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findPeacockSkipButton(settings) {
  const effective = SkippyStorage.getEffectiveSiteSettings(settings, "peacocktv.com");
  if (!effective.enabled) {
    dlog("disabled", "disabled for peacocktv.com via settings");
    return null;
  }

  const introProbe = probe("skip-intro", ["Skip Intro", "Skip intro", "SKIP INTRO"]);
  const recapProbe = probe("skip-recap", ["Skip Recap", "Skip recap", "SKIP RECAP"]);
  const nextProbe = probe("up-next", ["Up Next", "Watch Next", "Next Episode", "Play Next"]);

  dlog(
    "scan",
    `scan(source=${effective.source}): intro(testid=${introProbe.testidCount} text=${introProbe.textCount} visible=${introProbe.visibleCount}), ` +
      `recap(testid=${recapProbe.testidCount} text=${recapProbe.textCount} visible=${recapProbe.visibleCount}), ` +
      `next(testid=${nextProbe.testidCount} text=${nextProbe.textCount} visible=${nextProbe.visibleCount})`,
  );

  if (effective.skipIntro) {
    const btn = findButton("skip-intro", ["Skip Intro", "Skip intro", "SKIP INTRO"]);
    if (btn) {
      dlog("decide-intro", "→ return Skip Intro");
      return btn;
    }
  }
  if (effective.skipRecap) {
    const btn = findButton("skip-recap", ["Skip Recap", "Skip recap", "SKIP RECAP"]);
    if (btn) {
      dlog("decide-recap", "→ return Skip Recap");
      return btn;
    }
  }
  if (effective.nextEpisode) {
    const btn = findButton("up-next", ["Up Next", "Watch Next", "Next Episode", "Play Next"]);
    if (btn) {
      dlog("decide-next", "→ return Up Next");
      return btn;
    }
  }
  return null;
}

SkippyCore.skippyLog("[Skippy/Peacock] adapter loaded on", location.href);

/**
 * Live inspector — paste `__skippy()` in DevTools to dump the adapter's current view of
 * the page.
 * @returns {object} Snapshot of current adapter state.
 */
globalThis.__skippy = function __skippy() {
  const snapshot = {
    href: location.href,
    skipIntro: probe("skip-intro", ["Skip Intro", "Skip intro", "SKIP INTRO"]),
    skipRecap: probe("skip-recap", ["Skip Recap", "Skip recap", "SKIP RECAP"]),
    nextEpisode: probe("up-next", ["Up Next", "Watch Next", "Next Episode", "Play Next"]),
    allButtonsSample: collectButtons()
      .slice(0, 20)
      .map((b) => ({
        text: normText(b).slice(0, 60),
        testid: b.getAttribute("data-testid"),
        visible: SkippyCore.skippyIsVisible(b),
      })),
  };
  console.log("[Skippy/Peacock] snapshot", snapshot);
  return snapshot;
};

SkippyCore.skippyStart(findPeacockSkipButton);
