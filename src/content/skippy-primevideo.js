/** Skippy Prime Video adapter. Detects and clicks Skip Intro / Skip Recap / Next Up on Amazon Prime Video. */

/**
 * Throttled adapter-scoped debug logger — wraps `SkippyCore.skippyDLog` with a site prefix
 * and dedupe key namespace. Silent unless `settings.verboseLogging` is on. Same shape as
 * the helpers in the other adapters so the console-filter UX is consistent
 * (`[Skippy/PrimeVideo]` → grep).
 * @param {string} key Stable identifier for the log line (e.g. "scan").
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
function dlog(key, message, ...extras) {
  SkippyCore.skippyDLog(`primevideo:${key}`, `[Skippy/PrimeVideo] ${message}`, ...extras);
}

/**
 * Normalize a button's visible text into a comparable form: trim, collapse internal
 * whitespace, lowercase. Prime Video renders skip labels inside spans with extra
 * whitespace and varies casing between builds ("Skip Intro" vs. "skip intro"), so a
 * naive `=== "Skip Intro"` misses.
 * @param {Element|null|undefined} el Element to read text from.
 * @returns {string} Normalized text content, or "" if null/empty.
 */
function normText(el) {
  return ((el && el.textContent) || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Collect every `<button>` (and `[role="button"]`) under the player chrome. Prime Video's
 * web player renders skip buttons as real `<button>` elements in light DOM (class prefix
 * `atvwebplayersdk-*`), with no shadow roots involved, so a flat `querySelectorAll` covers
 * every candidate. The `role="button"` catch-all is insurance for the build variants where
 * Amazon swaps in a `<div role="button">` wrapper around the icon.
 * @returns {HTMLElement[]} All clickable button-like elements on the page.
 */
function collectButtons() {
  return /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll('button, [role="button"]'))
  );
}

/**
 * Find a button matching one of:
 *   1. A class-name substring matching `classToken` (e.g. "skipelement", "nextupcard").
 *      `[class*="..."]` substring match tolerates the Amazon "atvwebplayersdk-" prefix and
 *      the hashed Svelte-style suffix that occasionally appears on rebuilds.
 *   2. A normalized text content equal to one of `textLabels` (case-insensitive,
 *      whitespace-collapsed).
 *
 * Returns the first VISIBLE match. Falls back to `skippyIsPresent` if no fully-visible
 * match exists, mirroring the Apple TV / Netflix adapters' fade-handling. Prime Video's
 * player fades its chrome but keeps skip handlers wired; the permissive fallback lets a
 * click land while the overlay is mid-fade.
 *
 * Two independent strategies are intentional — Amazon has reshuffled class prefixes
 * multiple times (atvwebplayersdk → fwebplayersdk → various hashed forms), and the
 * visible English label has also drifted ("Skip Intro" vs. "Skip intro" vs. "Skip
 * Intro >"). Either source drifting keeps clicks firing as long as the other holds.
 * @param {string} classToken Substring to match against the `class` attribute (no quotes — passed into `[class*="..."]`).
 * @param {string[]} textLabels Normalized text labels (case-insensitive) the button's visible label may equal.
 * @returns {HTMLElement|null} The matched button, or null.
 */
function findButton(classToken, textLabels) {
  const byClass = /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll(`[class*="${classToken}"]`))
  );
  const candidates = /** @type {HTMLElement[]} */ ([]);
  for (const el of byClass) {
    // Only keep clickable elements — class-substring match can hit container divs.
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
  // Permissive fallback — Prime Video's player chrome fades aggressively while the click
  // handler stays wired. `skippyIsPresent` keeps the aria-hidden/inert/zero-rect rejections
  // but drops the opacity + pointer-events gates.
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
 * Probe one Prime Video button label and report counts so a verbose-log reader can tell
 * whether the page is currently rendering that prompt. Mirrors the Netflix `probe`
 * snapshot shape so inspector output is consistent across adapters.
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
 * Site adapter for Prime Video. Returns the visible button to click, or null.
 *
 * Order: Skip Intro → Skip Recap → Next Up (end-of-episode autoplay card).
 *
 * Prime Video has no distinct "Skip Credits" button — the equivalent UX is the Next Up
 * card that takes over the bottom-right at end-of-episode. We honor the `nextEpisode`
 * flag for that prompt; the `skipCredits` flag has no Prime Video surface.
 *
 * Forgiving matching is intentional — see `findButton`. Both the `atvwebplayersdk-*`
 * class substring and the literal label text are independently inspected, normalized,
 * and case-folded.
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findPrimeVideoSkipButton(settings) {
  const effective = SkippyStorage.getEffectiveSiteSettings(settings, "primevideo.com");
  if (!effective.enabled) {
    dlog("disabled", "disabled for primevideo.com via settings");
    return null;
  }

  const introProbe = probe("skipelement", ["Skip Intro", "Skip intro"]);
  const recapProbe = probe("skiprecap", ["Skip Recap", "Skip recap"]);
  const nextProbe = probe("nextupcard", ["Next Episode", "Next episode", "Next Up", "Next up"]);

  dlog(
    "scan",
    `scan(source=${effective.source}): intro(class=${introProbe.classCount} text=${introProbe.textCount} visible=${introProbe.visibleCount}), ` +
      `recap(class=${recapProbe.classCount} text=${recapProbe.textCount} visible=${recapProbe.visibleCount}), ` +
      `next(class=${nextProbe.classCount} text=${nextProbe.textCount} visible=${nextProbe.visibleCount})`,
  );

  if (effective.skipIntro) {
    const btn = findButton("skipelement", ["Skip Intro", "Skip intro"]);
    if (btn) {
      dlog("decide-intro", "→ return Skip Intro");
      return btn;
    }
  }
  if (effective.skipRecap) {
    const btn = findButton("skiprecap", ["Skip Recap", "Skip recap"]);
    if (btn) {
      dlog("decide-recap", "→ return Skip Recap");
      return btn;
    }
  }
  if (effective.nextEpisode) {
    const btn = findButton("nextupcard", ["Next Episode", "Next episode", "Next Up", "Next up"]);
    if (btn) {
      dlog("decide-next", "→ return Next Up");
      return btn;
    }
  }
  return null;
}

SkippyCore.skippyLog("[Skippy/PrimeVideo] adapter loaded on", location.href);

/**
 * Live inspector — paste `__skippy()` in DevTools to dump the adapter's current view of
 * the page. Shows the visibility / counts of each Prime Video prompt and a sample of all
 * `<button>` text on the page (handy when the DOM has drifted and the matcher misses).
 * Emits regardless of the verbose-logging setting; manual probe.
 * @returns {object} Snapshot of current adapter state.
 */
globalThis.__skippy = function __skippy() {
  const snapshot = {
    href: location.href,
    skipIntro: probe("skipelement", ["Skip Intro", "Skip intro"]),
    skipRecap: probe("skiprecap", ["Skip Recap", "Skip recap"]),
    nextEpisode: probe("nextupcard", ["Next Episode", "Next episode", "Next Up", "Next up"]),
    allButtonsSample: collectButtons()
      .slice(0, 20)
      .map((b) => ({
        text: normText(b).slice(0, 60),
        className: typeof b.className === "string" ? b.className.slice(0, 60) : "",
        visible: SkippyCore.skippyIsVisible(b),
      })),
  };
  console.log("[Skippy/PrimeVideo] snapshot", snapshot);
  return snapshot;
};

SkippyCore.skippyStart(findPrimeVideoSkipButton);
