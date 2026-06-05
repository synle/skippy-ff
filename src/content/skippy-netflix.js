/** Skippy Netflix adapter. Detects and clicks Skip Intro / Skip Recap and the seamless Next Episode button. */

/**
 * Throttled adapter-scoped debug logger — wraps `SkippyCore.skippyDLog` with a site prefix
 * and dedupe key namespace. Silent unless `settings.verboseLogging` is on. Same shape as
 * the helpers in `skippy-disneyplus.js` / `skippy-appletv.js` so the console-filter UX is
 * consistent across adapters (`[Skippy/Netflix]` → grep).
 * @param {string} key Stable identifier for the log line (e.g. "scan").
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
function dlog(key, message, ...extras) {
  SkippyCore.skippyDLog(`netflix:${key}`, `[Skippy/Netflix] ${message}`, ...extras);
}

/**
 * Normalize a button's visible text into a comparable form: trim, collapse internal
 * whitespace, lowercase. Lets us match "Skip Intro", "  SKIP   INTRO ", "skip\nintro"
 * with one comparison. Netflix renders labels inside `<span>` wrappers and occasionally
 * inserts extra whitespace between icon + text, so a naive `=== "Skip Intro"` misses.
 * @param {Element|null|undefined} el Element to read text from.
 * @returns {string} Normalized text content, or "" if null/empty.
 */
function normText(el) {
  return ((el && el.textContent) || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Collect every `<button>` (and `[role="button"]`) on the page. Netflix renders skip /
 * next-episode buttons as real `<button>` elements in light DOM — no shadow roots — so a
 * flat `querySelectorAll` covers every candidate. The `role="button"` catch-all is cheap
 * insurance for builds that swap in a `<div role="button">`.
 * @returns {HTMLElement[]} All clickable button-like elements on the page.
 */
function collectButtons() {
  return /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('button, [role="button"]')));
}

/**
 * Find a button matching one of:
 *   1. A `data-uia` attribute whose value contains `uiaToken` (e.g. "skip-intro",
 *      "next-episode-seamless-button"). `*=` substring match tolerates the Netflix
 *      "-draining" variant that appears once the autoplay timer starts winding down.
 *   2. A normalized text content exactly equal to `textLabel` (case-insensitive, whitespace-collapsed).
 *
 * Returns the first VISIBLE match. Falls through to the permissive `skippyIsPresent`
 * check if no fully-visible match exists, mirroring the Apple TV adapter's fade-handling.
 *
 * The forgiving matcher is the load-bearing part of "support Netflix": label strings have
 * already drifted between "Skip Intro" and "Skip Intro >" on different builds, and the
 * `data-uia` token is more stable but not promised. Two independent sources keep working
 * when either one drifts.
 * @param {string} uiaToken Substring to match against `data-uia` (no quotes — passed into `[data-uia*="..."]`).
 * @param {string} textLabel Exact normalized text the button's visible label should equal.
 * @returns {HTMLElement|null} The matched button, or null.
 */
function findButton(uiaToken, textLabel) {
  const byUia = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll(`[data-uia*="${uiaToken}"]`)));
  const candidates = /** @type {HTMLElement[]} */ ([]);
  for (const el of byUia) if (!candidates.includes(el)) candidates.push(el);

  // Text fallback — match every button/role=button whose normalized label equals textLabel.
  const wanted = textLabel.toLowerCase();
  for (const btn of collectButtons()) {
    if (normText(btn) === wanted && !candidates.includes(btn)) candidates.push(btn);
  }

  for (const node of candidates) {
    if (SkippyCore.skippyIsVisible(node)) return node;
  }
  // Permissive fallback — Netflix occasionally fades the overlay while the click handler
  // stays wired. `skippyIsPresent` keeps the aria-hidden/inert/zero-rect rejections but
  // drops the opacity + pointer-events gates.
  for (const node of candidates) {
    if (SkippyCore.skippyIsPresent(node)) {
      dlog(`fallback-${uiaToken}`, `no fully-visible candidate for "${textLabel}", using present fallback`, node);
      return node;
    }
  }
  return null;
}

/**
 * Probe one Netflix button label and report counts so a verbose-log reader can tell
 * whether the page is currently rendering that prompt. Mirrors the Crunchyroll
 * `probeByAriaLabel` snapshot shape so the inspector output stays consistent.
 * @param {string} uiaToken Substring of the expected `data-uia` value.
 * @param {string} textLabel Normalized text label to match.
 * @returns {{label: string, uiaCount: number, textCount: number, visibleCount: number}} Snapshot.
 */
function probe(uiaToken, textLabel) {
  const byUia = Array.from(document.querySelectorAll(`[data-uia*="${uiaToken}"]`));
  const wanted = textLabel.toLowerCase();
  const byText = collectButtons().filter((b) => normText(b) === wanted);
  const all = new Set([.../** @type {HTMLElement[]} */ (byUia), ...byText]);
  let visibleCount = 0;
  for (const el of all) if (SkippyCore.skippyIsVisible(el)) visibleCount++;
  return { label: textLabel, uiaCount: byUia.length, textCount: byText.length, visibleCount };
}

/**
 * Site adapter for Netflix. Returns the visible button to click, or null.
 *
 * Order: Skip Intro → Skip Recap → Next Episode (seamless autoplay).
 *
 * Netflix has no "Skip Credits" button — the equivalent UX is the seamless Next Episode
 * autoplay that appears during the end-of-episode countdown. We honor the `nextEpisode`
 * flag for that prompt; the `skipCredits` flag has no Netflix surface.
 *
 * Forgiving matching is intentional — see `findButton`. Both `data-uia` and the literal
 * label text are independently inspected, normalized, and case-folded.
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findNetflixSkipButton(settings) {
  const effective = SkippyStorage.getEffectiveSiteSettings(settings, "netflix.com");
  if (!effective.enabled) {
    dlog("disabled", "disabled for netflix.com via settings");
    return null;
  }

  const introProbe = probe("skip-intro", "Skip Intro");
  const recapProbe = probe("skip-recap", "Skip Recap");
  const nextProbe = probe("next-episode-seamless-button", "Next Episode");

  dlog(
    "scan",
    `scan(source=${effective.source}): intro(uia=${introProbe.uiaCount} text=${introProbe.textCount} visible=${introProbe.visibleCount}), ` +
      `recap(uia=${recapProbe.uiaCount} text=${recapProbe.textCount} visible=${recapProbe.visibleCount}), ` +
      `next(uia=${nextProbe.uiaCount} text=${nextProbe.textCount} visible=${nextProbe.visibleCount})`,
  );

  if (effective.skipIntro) {
    const btn = findButton("skip-intro", "Skip Intro");
    if (btn) {
      dlog("decide-intro", "→ return Skip Intro");
      return btn;
    }
  }
  if (effective.skipRecap) {
    const btn = findButton("skip-recap", "Skip Recap");
    if (btn) {
      dlog("decide-recap", "→ return Skip Recap");
      return btn;
    }
  }
  if (effective.nextEpisode) {
    const btn = findButton("next-episode-seamless-button", "Next Episode");
    if (btn) {
      dlog("decide-next", "→ return Next Episode");
      return btn;
    }
  }
  return null;
}

SkippyCore.skippyLog("[Skippy/Netflix] adapter loaded on", location.href);

/**
 * Live inspector — paste `__skippy()` in DevTools to dump the adapter's current view of
 * the page. Shows the visibility / counts of each Netflix prompt and a sample of all
 * `<button>` text on the page (handy when the DOM has drifted and the matcher misses).
 * Emits regardless of the verbose-logging setting; manual probe.
 * @returns {object} Snapshot of current adapter state.
 */
globalThis.__skippy = function __skippy() {
  const snapshot = {
    href: location.href,
    skipIntro: probe("skip-intro", "Skip Intro"),
    skipRecap: probe("skip-recap", "Skip Recap"),
    nextEpisode: probe("next-episode-seamless-button", "Next Episode"),
    allButtonsSample: collectButtons()
      .slice(0, 20)
      .map((b) => ({
        text: normText(b).slice(0, 60),
        uia: b.getAttribute("data-uia"),
        visible: SkippyCore.skippyIsVisible(b),
      })),
  };
  console.log("[Skippy/Netflix] snapshot", snapshot);
  return snapshot;
};

SkippyCore.skippyStart(findNetflixSkipButton);
