/** Skippy Paramount+ adapter. Detects and clicks Skip Intro / Skip Preview / Skip Credits / Up Next on paramountplus.com. */

/**
 * Throttled adapter-scoped debug logger — wraps `SkippyCore.skippyDLog` with a site prefix
 * and dedupe key namespace. Silent unless `settings.verboseLogging` is on.
 * @param {string} key Stable identifier for the log line (e.g. "scan").
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
function dlog(key, message, ...extras) {
  SkippyCore.skippyDLog(`paramountplus:${key}`, `[Skippy/Paramount+] ${message}`, ...extras);
}

/**
 * Normalize a button's visible text into a comparable form: trim, collapse internal
 * whitespace, lowercase. Paramount+ varies casing across builds.
 * @param {Element|null|undefined} el Element to read text from.
 * @returns {string} Normalized text content, or "" if null/empty.
 */
function normText(el) {
  return ((el && el.textContent) || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Collect every `<button>` (and `[role="button"]`) on the page. Paramount+ renders skip
 * buttons as real `<button>` elements in light DOM — no shadow roots — so a flat
 * `querySelectorAll` covers every candidate.
 * @returns {HTMLElement[]} All clickable button-like elements on the page.
 */
function collectButtons() {
  return /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll('button, [role="button"]'))
  );
}

/**
 * Find a button matching one of:
 *   1. A class-name substring matching `classToken` (e.g. "skip-intro", "skip-button",
 *      "up-next"). Paramount+'s player uses semantic class fragments that have stayed
 *      stable across the last several rebuilds; substring match tolerates the kebab/camel
 *      prefix churn ("skip-intro-button" vs. "skipIntroButton").
 *   2. A normalized text content equal to one of `textLabels` (case-insensitive,
 *      whitespace-collapsed).
 *
 * Returns the first VISIBLE match. Falls back to `skippyIsPresent` if no fully-visible
 * match exists. Two independent strategies keep clicks firing when either signal drifts.
 * @param {string} classToken Substring to match against the `class` attribute.
 * @param {string[]} textLabels Normalized text labels (case-insensitive) the button's visible label may equal.
 * @returns {HTMLElement|null} The matched button, or null.
 */
function findButton(classToken, textLabels) {
  const byClass = /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll(`[class*="${classToken}"]`))
  );
  const candidates = /** @type {HTMLElement[]} */ ([]);
  for (const el of byClass) {
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
        `fallback-${classToken}`,
        `no fully-visible candidate for "${textLabels[0]}", using present fallback`,
        node,
      );
      return node;
    }
  }
  return null;
}

/**
 * Probe one Paramount+ button label and report counts so a verbose-log reader can tell
 * whether the page is currently rendering that prompt.
 * @param {string} classToken Substring of the expected `class` attribute.
 * @param {string[]} textLabels Normalized text labels to match.
 * @returns {{label: string, classCount: number, textCount: number, visibleCount: number}} Snapshot.
 */
function probe(classToken, textLabels) {
  const byClass = Array.from(document.querySelectorAll(`[class*="${classToken}"]`)).filter(
    (el) => el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button",
  );
  const wantedSet = new Set(textLabels.map((t) => t.toLowerCase()));
  const byText = collectButtons().filter((b) => wantedSet.has(normText(b)));
  const all = new Set([.../** @type {HTMLElement[]} */ (byClass), ...byText]);
  let visibleCount = 0;
  for (const el of all) if (SkippyCore.skippyIsVisible(el)) visibleCount++;
  return {
    label: textLabels[0],
    classCount: byClass.length,
    textCount: byText.length,
    visibleCount,
  };
}

/**
 * Site adapter for Paramount+. Returns the visible button to click, or null.
 *
 * Order: Skip Intro → Skip Preview / Recap → Skip Credits → Up Next.
 *
 * Paramount+ uses "Skip Preview" as its recap-equivalent on some titles, "Skip Recap" on
 * others. Both map to the `skipRecap` flag. The end-of-episode autoplay prompt reads
 * "Up Next" or "Watch Next Episode".
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findParamountPlusSkipButton(settings) {
  const effective = SkippyStorage.getEffectiveSiteSettings(settings, "paramountplus.com");
  if (!effective.enabled) {
    dlog("disabled", "disabled for paramountplus.com via settings");
    return null;
  }

  const introProbe = probe("skip-intro", ["Skip Intro", "Skip intro", "SKIP INTRO"]);
  const recapProbe = probe("skip-preview", [
    "Skip Preview",
    "Skip Recap",
    "Skip preview",
    "Skip recap",
  ]);
  const creditsProbe = probe("skip-credits", ["Skip Credits", "Skip credits", "SKIP CREDITS"]);
  const nextProbe = probe("up-next", [
    "Up Next",
    "Watch Next Episode",
    "Next Episode",
    "Play Next",
  ]);

  dlog(
    "scan",
    `scan(source=${effective.source}): intro(class=${introProbe.classCount} text=${introProbe.textCount} visible=${introProbe.visibleCount}), ` +
      `recap(class=${recapProbe.classCount} text=${recapProbe.textCount} visible=${recapProbe.visibleCount}), ` +
      `credits(class=${creditsProbe.classCount} text=${creditsProbe.textCount} visible=${creditsProbe.visibleCount}), ` +
      `next(class=${nextProbe.classCount} text=${nextProbe.textCount} visible=${nextProbe.visibleCount})`,
  );

  if (effective.skipIntro) {
    const btn = findButton("skip-intro", ["Skip Intro", "Skip intro", "SKIP INTRO"]);
    if (btn) {
      dlog("decide-intro", "→ return Skip Intro");
      return btn;
    }
  }
  if (effective.skipRecap) {
    const btn = findButton("skip-preview", [
      "Skip Preview",
      "Skip Recap",
      "Skip preview",
      "Skip recap",
    ]);
    if (btn) {
      dlog("decide-recap", "→ return Skip Preview/Recap");
      return btn;
    }
  }
  if (effective.skipCredits) {
    const btn = findButton("skip-credits", ["Skip Credits", "Skip credits", "SKIP CREDITS"]);
    if (btn) {
      dlog("decide-credits", "→ return Skip Credits");
      return btn;
    }
  }
  if (effective.nextEpisode) {
    const btn = findButton("up-next", [
      "Up Next",
      "Watch Next Episode",
      "Next Episode",
      "Play Next",
    ]);
    if (btn) {
      dlog("decide-next", "→ return Up Next");
      return btn;
    }
  }
  return null;
}

SkippyCore.skippyLog("[Skippy/Paramount+] adapter loaded on", location.href);

/**
 * Live inspector — paste `__skippy()` in DevTools to dump the adapter's current view of
 * the page. Emits regardless of the verbose-logging setting.
 * @returns {object} Snapshot of current adapter state.
 */
globalThis.__skippy = function __skippy() {
  const snapshot = {
    href: location.href,
    skipIntro: probe("skip-intro", ["Skip Intro", "Skip intro", "SKIP INTRO"]),
    skipRecap: probe("skip-preview", ["Skip Preview", "Skip Recap", "Skip preview", "Skip recap"]),
    skipCredits: probe("skip-credits", ["Skip Credits", "Skip credits", "SKIP CREDITS"]),
    nextEpisode: probe("up-next", ["Up Next", "Watch Next Episode", "Next Episode", "Play Next"]),
    allButtonsSample: collectButtons()
      .slice(0, 20)
      .map((b) => ({
        text: normText(b).slice(0, 60),
        className: typeof b.className === "string" ? b.className.slice(0, 60) : "",
        visible: SkippyCore.skippyIsVisible(b),
      })),
  };
  console.log("[Skippy/Paramount+] snapshot", snapshot);
  return snapshot;
};

SkippyCore.skippyStart(findParamountPlusSkipButton);
