/** Skippy Max (HBO Max) adapter. Detects and clicks Skip Intro / Skip Recap / Skip Credits / Up Next on max.com. */

/**
 * Throttled adapter-scoped debug logger — wraps `SkippyCore.skippyDLog` with a site prefix
 * and dedupe key namespace. Silent unless `settings.verboseLogging` is on. Console-filter
 * UX is consistent with the other adapters (`[Skippy/Max]` → grep).
 * @param {string} key Stable identifier for the log line (e.g. "scan").
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
function dlog(key, message, ...extras) {
  SkippyCore.skippyDLog(`max:${key}`, `[Skippy/Max] ${message}`, ...extras);
}

/**
 * Normalize a button's visible text into a comparable form: trim, collapse internal
 * whitespace, lowercase. Max's player renders labels inside `<span>` wrappers and varies
 * casing across builds, so a naive equality check misses.
 * @param {Element|null|undefined} el Element to read text from.
 * @returns {string} Normalized text content, or "" if null/empty.
 */
function normText(el) {
  return ((el && el.textContent) || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Collect every `<button>` (and `[role="button"]`) on the page. Max renders skip buttons
 * as real `<button>` elements in light DOM — no shadow roots — so a flat
 * `querySelectorAll` covers every candidate. The `role="button"` catch-all handles
 * builds where Max swaps in a `<div role="button">` wrapper around the icon.
 * @returns {HTMLElement[]} All clickable button-like elements on the page.
 */
function collectButtons() {
  return /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll('button, [role="button"]'))
  );
}

/**
 * Find a button matching one of:
 *   1. A `data-testid` attribute whose value contains `testidToken` (e.g. "skipIntro",
 *      "skipRecap", "upNext"). Substring match tolerates the Max
 *      `player-ux-skipIntro-button` / `skip-intro-button` variants seen across rebuilds.
 *   2. A normalized text content equal to one of `textLabels` (case-insensitive,
 *      whitespace-collapsed).
 *
 * Returns the first VISIBLE match. Falls back to `skippyIsPresent` if no fully-visible
 * match exists, mirroring the Apple TV / Netflix adapters' fade-handling. Max's player
 * chrome fades aggressively while keeping skip handlers wired; the permissive fallback
 * lets a click land while the overlay is mid-fade.
 *
 * Two independent strategies are intentional — Max has reshuffled `data-testid` values
 * multiple times (player-ux-skipIntro vs. skipIntro vs. skip-intro), and the visible
 * English label has also drifted ("Skip Intro" vs. "Skip intro" vs. "SKIP INTRO").
 * Either signal drifting keeps clicks firing as long as the other holds.
 * @param {string} testidToken Substring to match against `data-testid` (passed into `[data-testid*="..."]`).
 * @param {string[]} textLabels Normalized text labels (case-insensitive) the button's visible label may equal.
 * @returns {HTMLElement|null} The matched button, or null.
 */
function findButton(testidToken, textLabels) {
  const byTestId = /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll(`[data-testid*="${testidToken}"]`))
  );
  const candidates = /** @type {HTMLElement[]} */ ([]);
  for (const el of byTestId) {
    // Only keep clickable elements — the testid attribute can also live on wrapper divs.
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
 * Probe one Max button label and report counts so a verbose-log reader can tell
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
 * Site adapter for Max. Returns the visible button to click, or null.
 *
 * Order: Skip Intro → Skip Recap → Skip Credits → Up Next (end-of-episode autoplay).
 *
 * Max exposes all four — Skip Intro, Skip Recap, Skip Credits, and Up Next — through
 * separate buttons. Each maps to its corresponding settings flag.
 *
 * Forgiving matching is intentional — see `findButton`. Both the `data-testid` substring
 * and the literal label text are independently inspected, normalized, and case-folded.
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findMaxSkipButton(settings) {
  const effective = SkippyStorage.getEffectiveSiteSettings(settings, "max.com");
  if (!effective.enabled) {
    dlog("disabled", "disabled for max.com via settings");
    return null;
  }

  const introProbe = probe("skipIntro", ["Skip Intro", "Skip intro", "SKIP INTRO"]);
  const recapProbe = probe("skipRecap", ["Skip Recap", "Skip recap", "SKIP RECAP"]);
  const creditsProbe = probe("skipCredits", ["Skip Credits", "Skip credits", "SKIP CREDITS"]);
  const nextProbe = probe("upNext", ["Up Next", "Next Episode", "Watch Next", "Play Next"]);

  dlog(
    "scan",
    `scan(source=${effective.source}): intro(testid=${introProbe.testidCount} text=${introProbe.textCount} visible=${introProbe.visibleCount}), ` +
      `recap(testid=${recapProbe.testidCount} text=${recapProbe.textCount} visible=${recapProbe.visibleCount}), ` +
      `credits(testid=${creditsProbe.testidCount} text=${creditsProbe.textCount} visible=${creditsProbe.visibleCount}), ` +
      `next(testid=${nextProbe.testidCount} text=${nextProbe.textCount} visible=${nextProbe.visibleCount})`,
  );

  if (effective.skipIntro) {
    const btn = findButton("skipIntro", ["Skip Intro", "Skip intro", "SKIP INTRO"]);
    if (btn) {
      dlog("decide-intro", "→ return Skip Intro");
      return btn;
    }
  }
  if (effective.skipRecap) {
    const btn = findButton("skipRecap", ["Skip Recap", "Skip recap", "SKIP RECAP"]);
    if (btn) {
      dlog("decide-recap", "→ return Skip Recap");
      return btn;
    }
  }
  if (effective.skipCredits) {
    const btn = findButton("skipCredits", ["Skip Credits", "Skip credits", "SKIP CREDITS"]);
    if (btn) {
      dlog("decide-credits", "→ return Skip Credits");
      return btn;
    }
  }
  if (effective.nextEpisode) {
    const btn = findButton("upNext", ["Up Next", "Next Episode", "Watch Next", "Play Next"]);
    if (btn) {
      dlog("decide-next", "→ return Up Next");
      return btn;
    }
  }
  return null;
}

SkippyCore.skippyLog("[Skippy/Max] adapter loaded on", location.href);

/**
 * Live inspector — paste `__skippy()` in DevTools to dump the adapter's current view of
 * the page. Shows the visibility / counts of each Max prompt and a sample of all
 * `<button>` text on the page. Emits regardless of the verbose-logging setting.
 * @returns {object} Snapshot of current adapter state.
 */
globalThis.__skippy = function __skippy() {
  const snapshot = {
    href: location.href,
    skipIntro: probe("skipIntro", ["Skip Intro", "Skip intro", "SKIP INTRO"]),
    skipRecap: probe("skipRecap", ["Skip Recap", "Skip recap", "SKIP RECAP"]),
    skipCredits: probe("skipCredits", ["Skip Credits", "Skip credits", "SKIP CREDITS"]),
    nextEpisode: probe("upNext", ["Up Next", "Next Episode", "Watch Next", "Play Next"]),
    allButtonsSample: collectButtons()
      .slice(0, 20)
      .map((b) => ({
        text: normText(b).slice(0, 60),
        testid: b.getAttribute("data-testid"),
        visible: SkippyCore.skippyIsVisible(b),
      })),
  };
  console.log("[Skippy/Max] snapshot", snapshot);
  return snapshot;
};

SkippyCore.skippyStart(findMaxSkipButton);
