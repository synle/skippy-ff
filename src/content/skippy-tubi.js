/** Skippy Tubi adapter. Detects and clicks Skip Intro / Up Next on tubitv.com. */

/**
 * Throttled adapter-scoped debug logger — wraps `SkippyCore.skippyDLog` with a site prefix
 * and dedupe key namespace. Silent unless `settings.verboseLogging` is on.
 * @param {string} key Stable identifier for the log line (e.g. "scan").
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
function dlog(key, message, ...extras) {
  SkippyCore.skippyDLog(`tubi:${key}`, `[Skippy/Tubi] ${message}`, ...extras);
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
 * Collect every `<button>` (and `[role="button"]`) on the page. Tubi renders skip
 * buttons as real `<button>` elements in light DOM — no shadow roots — so a flat
 * `querySelectorAll` covers every candidate.
 * @returns {HTMLElement[]} All clickable button-like elements on the page.
 */
function collectButtons() {
  return /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('button, [role="button"]')));
}

/**
 * Find a button matching one of:
 *   1. A `data-testid` attribute whose value contains `testidToken` (e.g.
 *      "skip-intro", "up-next"). Substring match tolerates suffix churn.
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
  const byTestId = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll(`[data-testid*="${testidToken}"]`)));
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
      dlog(`fallback-${testidToken}`, `no fully-visible candidate for "${textLabels[0]}", using present fallback`, node);
      return node;
    }
  }
  return null;
}

/**
 * Probe one Tubi button label and report counts so a verbose-log reader can tell
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
  return { label: textLabels[0], testidCount: byTestId.length, textCount: byText.length, visibleCount };
}

/**
 * Site adapter for Tubi. Returns the visible button to click, or null.
 *
 * Order: Skip Intro → Up Next (end-of-episode autoplay).
 *
 * Tubi surfaces Skip Intro on its originals and an Up Next end-of-episode card. No
 * distinct Skip Recap or Skip Credits buttons — Tubi's catalog is largely licensed
 * back-catalog where those prompts don't exist.
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findTubiSkipButton(settings) {
  if (settings.enabledSites && settings.enabledSites["tubitv.com"] === false) {
    dlog("disabled", "disabled for tubitv.com via settings");
    return null;
  }

  const introProbe = probe("skip-intro", ["Skip Intro", "Skip intro", "SKIP INTRO"]);
  const nextProbe = probe("up-next", ["Up Next", "Watch Next", "Next Episode", "Play Next"]);

  dlog(
    "scan",
    `scan: intro(testid=${introProbe.testidCount} text=${introProbe.textCount} visible=${introProbe.visibleCount}), ` +
      `next(testid=${nextProbe.testidCount} text=${nextProbe.textCount} visible=${nextProbe.visibleCount})`,
  );

  if (settings.skipIntro) {
    const btn = findButton("skip-intro", ["Skip Intro", "Skip intro", "SKIP INTRO"]);
    if (btn) {
      dlog("decide-intro", "→ return Skip Intro");
      return btn;
    }
  }
  if (settings.nextEpisode) {
    const btn = findButton("up-next", ["Up Next", "Watch Next", "Next Episode", "Play Next"]);
    if (btn) {
      dlog("decide-next", "→ return Up Next");
      return btn;
    }
  }
  return null;
}

SkippyCore.skippyLog("[Skippy/Tubi] adapter loaded on", location.href);

/**
 * Live inspector — paste `__skippy()` in DevTools to dump the adapter's current view of
 * the page.
 * @returns {object} Snapshot of current adapter state.
 */
globalThis.__skippy = function __skippy() {
  const snapshot = {
    href: location.href,
    skipIntro: probe("skip-intro", ["Skip Intro", "Skip intro", "SKIP INTRO"]),
    nextEpisode: probe("up-next", ["Up Next", "Watch Next", "Next Episode", "Play Next"]),
    allButtonsSample: collectButtons()
      .slice(0, 20)
      .map((b) => ({
        text: normText(b).slice(0, 60),
        testid: b.getAttribute("data-testid"),
        visible: SkippyCore.skippyIsVisible(b),
      })),
  };
  console.log("[Skippy/Tubi] snapshot", snapshot);
  return snapshot;
};

SkippyCore.skippyStart(findTubiSkipButton);
