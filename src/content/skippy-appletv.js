/** Skippy Apple TV adapter. Detects and clicks the Skip overlay button and the Play Next Episode button. */

/**
 * Throttled adapter-scoped debug logger — wraps `SkippyCore.skippyDLog` with a site prefix
 * and dedupe key namespace. Silent unless `settings.verboseLogging` is on.
 * @param {string} key Stable identifier for the log line (e.g. "scan").
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
function dlog(key, message, ...extras) {
  SkippyCore.skippyDLog(`appletv:${key}`, `[Skippy/AppleTV] ${message}`, ...extras);
}

/**
 * Recursively collect every element matching `selector` across the document AND every open
 * shadow root. Apple TV's player may render parts of the UI behind shadow boundaries; a flat
 * `document.querySelectorAll` would miss those candidates. BFS through every shadow root we
 * can reach. Closed shadow roots are invisible to us.
 * @param {Document|ShadowRoot|Element} root Subtree to start walking from.
 * @param {string} selector CSS selector to match.
 * @returns {Element[]} Flat list of all matches across shadow boundaries.
 */
function deepQueryAll(root, selector) {
  const results = /** @type {Element[]} */ ([]);
  const queue = /** @type {(Document|ShadowRoot|Element)[]} */ ([root]);
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof (/** @type {any} */ (node).querySelectorAll) !== "function") continue;
    for (const el of /** @type {any} */ (node).querySelectorAll(selector)) results.push(el);
    for (const el of /** @type {any} */ (node).querySelectorAll("*")) {
      if (el.shadowRoot) queue.push(el.shadowRoot);
    }
  }
  return results;
}

/**
 * Find the Apple TV overlay Skip button. Apple TV renders a single "Skip" button in the
 * bottom-right corner for Skip Intro / Recap / Credits — the label is always literally
 * "Skip" regardless of which segment is being skipped. We try, in order:
 *   1. Stable `data-testid="skip-overlay-button-skip-button"` (deep across shadow roots).
 *   2. Class-based fallback `button.skip-overlay__button` for builds where the testid drifts.
 *   3. Text-based fallback: any visible `<button>` whose trimmed text content is exactly "Skip".
 * Fires when ANY of the skip flags is enabled (we can't distinguish intro vs recap vs credits
 * from the label alone). Logs candidate counts each poll so you can see whether the DOM ever
 * exposes the button to us.
 * @param {{skipIntro: boolean, skipRecap: boolean, skipCredits: boolean}} settings Current Skippy settings.
 * @returns {HTMLElement|null} The Skip button to click, or null.
 */
function findAppleTvSkipOverlayButton(settings) {
  if (!settings.skipIntro && !settings.skipRecap && !settings.skipCredits) return null;

  // 1. Stable data-testid attribute.
  const byTestId = deepQueryAll(document, 'button[data-testid="skip-overlay-button-skip-button"]');
  // 2. Class-based fallback.
  const byClass = deepQueryAll(document, "button.skip-overlay__button");
  // 3. Broad text fallback — every <button> on the page; filter to literal "Skip" below.
  const allButtons = deepQueryAll(document, "button");
  const byText = allButtons.filter((b) => (b.textContent || "").trim().toLowerCase() === "skip");

  dlog("scan-skip", `scan: testid=${byTestId.length}, class=${byClass.length}, text="Skip"=${byText.length}, allBtns=${allButtons.length}`);

  // Dedup while preserving order: testid > class > text.
  const candidates = /** @type {Element[]} */ ([]);
  for (const list of [byTestId, byClass, byText]) {
    for (const el of list) if (!candidates.includes(el)) candidates.push(el);
  }

  for (const node of candidates) {
    const visible = SkippyCore.skippyIsVisible(node);
    const present = SkippyCore.skippyIsPresent(node);
    dlog(`cand-${candidates.indexOf(node)}`, `candidate visible=${visible} present=${present}`, node);
    if (visible) return /** @type {HTMLElement} */ (node);
  }
  // Permissive fallback: present-but-low-opacity (Apple TV may fade controls while still wired).
  for (const node of candidates) {
    if (SkippyCore.skippyIsPresent(node)) {
      dlog("fallback-skip", "no fully-visible Skip button, using present fallback", node);
      return /** @type {HTMLElement} */ (node);
    }
  }
  return null;
}

/**
 * Find the Apple TV "Play Next Episode" button rendered at the end of an episode.
 * Identified by the stable `data-testid="countdown-play-icon"` on the inner icon —
 * its enclosing `<button>` is the click target. Also accepts a text fallback for builds
 * where the testid drifts. Gated on the standalone `nextEpisode` flag (separate from
 * `skipCredits`) so users can toggle the post-credits autoplay independently.
 * @param {{nextEpisode: boolean}} settings Current Skippy settings.
 * @returns {HTMLElement|null} The Play Next Episode button, or null when hidden / disabled.
 */
function findAppleTvNextEpisodeButton(settings) {
  if (!settings.nextEpisode) return null;
  const icons = deepQueryAll(document, '[data-testid="countdown-play-icon"]');
  const candidates = /** @type {HTMLButtonElement[]} */ ([]);
  for (const icon of icons) {
    const btn = /** @type {HTMLButtonElement|null} */ (icon.closest("button"));
    if (btn && !candidates.includes(btn)) candidates.push(btn);
  }
  // Text fallback — any <button> whose text contains "play next episode".
  const allButtons = deepQueryAll(document, "button");
  for (const btn of allButtons) {
    const text = (btn.textContent || "").trim().toLowerCase();
    if (text.includes("play next episode") && !candidates.includes(/** @type {HTMLButtonElement} */ (btn))) {
      candidates.push(/** @type {HTMLButtonElement} */ (btn));
    }
  }
  dlog("scan-next", `scan: ${candidates.length} Play Next Episode candidate(s)`);
  for (const btn of candidates) {
    const visible = SkippyCore.skippyIsVisible(btn);
    dlog(`next-${candidates.indexOf(btn)}`, `Play Next Episode candidate visible=${visible}`, btn);
    if (visible) return btn;
  }
  return null;
}

/**
 * Site adapter for Apple TV. Returns the visible button to click, or null.
 * Skip overlay takes precedence over Play Next Episode when both are simultaneously visible.
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findAppleTvSkipButton(settings) {
  if (settings.enabledSites && settings.enabledSites["tv.apple.com"] === false) {
    dlog("disabled", "disabled for tv.apple.com via settings");
    return null;
  }
  return findAppleTvSkipOverlayButton(settings) || findAppleTvNextEpisodeButton(settings);
}

SkippyCore.skippyLog("[Skippy/AppleTV] adapter loaded on", location.href, "frame=", window === window.top ? "top" : "iframe");

/**
 * Live inspector — paste `__skippy()` in the console to dump current state.
 * @returns {object} Snapshot of current adapter state, for manual debugging from DevTools.
 */
globalThis.__skippy = function __skippy() {
  const byTestId = deepQueryAll(document, 'button[data-testid="skip-overlay-button-skip-button"]');
  const byClass = deepQueryAll(document, "button.skip-overlay__button");
  const allButtons = deepQueryAll(document, "button");
  const byText = allButtons.filter((b) => (b.textContent || "").trim().toLowerCase() === "skip");
  const next = deepQueryAll(document, '[data-testid="countdown-play-icon"]')
    .map((i) => i.closest("button"))
    .filter(Boolean);
  const snapshot = {
    href: location.href,
    frame: window === window.top ? "top" : "iframe",
    totalButtons: allButtons.length,
    skipByTestId: byTestId.map((b) => ({
      visible: SkippyCore.skippyIsVisible(b),
      rect: b.getBoundingClientRect(),
      text: (b.textContent || "").trim(),
    })),
    skipByClass: byClass.map((b) => ({
      visible: SkippyCore.skippyIsVisible(b),
      rect: b.getBoundingClientRect(),
      text: (b.textContent || "").trim(),
    })),
    skipByText: byText.map((b) => ({
      visible: SkippyCore.skippyIsVisible(b),
      rect: b.getBoundingClientRect(),
      text: (b.textContent || "").trim(),
    })),
    nextEpisode: next.map((b) => ({
      visible: SkippyCore.skippyIsVisible(b),
      rect: b.getBoundingClientRect(),
      text: (b.textContent || "").trim().slice(0, 40),
    })),
  };
  // Inspector is invoked manually from DevTools — always emit, regardless of verboseLogging.
  console.log("[Skippy/AppleTV] snapshot", snapshot);
  return snapshot;
};

SkippyCore.skippyStart(findAppleTvSkipButton);
