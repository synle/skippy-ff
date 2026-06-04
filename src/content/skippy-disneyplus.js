/** Skippy Disney+ adapter. Detects and clicks the Skip overlay button and the Up-Next "Next Episode" button. */

/**
 * Throttled debug logger — keeps a polling-loop friendly trickle of state out of the console
 * by only emitting when the message text differs from the last emission. Pass the same `key`
 * with the same `message` to suppress duplicates.
 * @param {string} key Stable identifier for the log line (e.g. "scan").
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
const _lastLog = /** @type {Record<string, string>} */ ({});
function dlog(key, message, ...extras) {
  if (_lastLog[key] === message) return;
  _lastLog[key] = message;
  console.log(`[Skippy/Disney+] ${message}`, ...extras);
}

/**
 * Recursively collect every element matching `selector` across the document AND every open
 * shadow root. Disney+ encapsulates its player UI (`<disney-web-player-ui>`, `<skip-overlay>`,
 * etc.) behind open shadow roots, so a flat `document.querySelectorAll` returns 0 candidates
 * even when the skip button is visually on screen. We BFS through every shadow root we can
 * reach. Closed shadow roots are invisible to us — those require the `elementFromPoint`
 * fallback in `skippy-core.js`.
 * @param {Document|ShadowRoot|Element} root Subtree to start walking from.
 * @param {string} selector CSS selector to match.
 * @returns {Element[]} Flat list of all matches across shadow boundaries.
 */
function deepQueryAll(root, selector) {
  const results = /** @type {Element[]} */ ([]);
  const queue = /** @type {(Document|ShadowRoot|Element)[]} */ ([root]);
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof /** @type {any} */ (node).querySelectorAll !== "function") continue;
    for (const el of /** @type {any} */ (node).querySelectorAll(selector)) results.push(el);
    // Enqueue every descendant's shadow root for further traversal.
    for (const el of /** @type {any} */ (node).querySelectorAll("*")) {
      if (el.shadowRoot) queue.push(el.shadowRoot);
    }
  }
  return results;
}

/**
 * Find a visible Disney+ skip button. Disney+ uses a single `<skip-button>` custom element
 * (rendered inside the `<disney-web-player-ui>` shadow root, often further nested in
 * `<skip-overlay>`) for Skip Intro / Recap / Credits. The label may live in light DOM, shadow
 * text, or an inner button's aria-label — we probe every source. Falls back to clicking when
 * any skip flag is enabled if no label is readable.
 * @param {{skipIntro: boolean, skipRecap: boolean, skipCredits: boolean}} settings Current Skippy settings.
 * @returns {HTMLElement|null} The skip-button (or inner clickable) to click, or null.
 */
function findDisneyPlusSkipOverlayButton(settings) {
  const hosts = deepQueryAll(document, "skip-button");
  dlog("scan-skip", `scan: ${hosts.length} <skip-button> candidate(s) (deep)`);
  for (const host of hosts) {
    const visible = SkippyCore.skippyIsVisible(host);
    if (!visible) continue;

    // Prefer the inner <button> inside an open shadow root — that's the real click target.
    const inner = /** @type {HTMLElement|null} */ (host.shadowRoot?.querySelector("button, [role='button']") || null);
    const target = inner || /** @type {HTMLElement} */ (host);

    const label = (
      host.getAttribute("aria-label") ||
      inner?.getAttribute("aria-label") ||
      host.shadowRoot?.textContent ||
      host.textContent ||
      ""
    )
      .toLowerCase()
      .trim();

    dlog("found-skip", `visible <skip-button> found, label="${label || "(empty)"}", inner=${inner ? "yes" : "no"}`);

    if (label.includes("intro")) {
      if (settings.skipIntro) return target;
      continue;
    }
    if (label.includes("recap")) {
      if (settings.skipRecap) return target;
      continue;
    }
    if (label.includes("credit")) {
      if (settings.skipCredits) return target;
      continue;
    }
    // Label not exposed (closed shadow root, no aria) — click when any skip flag is on.
    if (settings.skipIntro || settings.skipRecap || settings.skipCredits) return target;
  }
  return null;
}

/**
 * Find the Disney+ "Next Episode" button rendered by the up-next-lite overlay near credits.
 * Tied to `skipCredits` since both advance the viewer past end-of-episode chrome. Searches
 * deep through shadow roots, same reason as `findDisneyPlusSkipOverlayButton`.
 * @param {{skipCredits: boolean}} settings Current Skippy settings.
 * @returns {HTMLElement|null} The next-episode button, or null when hidden / disabled.
 */
function findDisneyPlusNextEpisodeButton(settings) {
  if (!settings.skipCredits) return null;
  const matches = deepQueryAll(document, "button.up-next-lite-v1-overlay__button");
  if (matches.length === 0) return null;
  for (const btn of matches) {
    const visible = SkippyCore.skippyIsVisible(btn);
    dlog("found-next", `Next Episode button present, visible=${visible}`);
    if (visible) return /** @type {HTMLElement} */ (btn);
  }
  return null;
}

/**
 * Site adapter for Disney+. Returns the visible button to click, or null.
 * Skip overlay takes precedence over Next Episode when both are simultaneously visible.
 * @param {object} settings Current Skippy settings.
 * @returns {HTMLElement|null}
 */
function findDisneyPlusSkipButton(settings) {
  if (settings.enabledSites && settings.enabledSites["disneyplus.com"] === false) {
    dlog("disabled", "disabled for disneyplus.com via settings");
    return null;
  }
  return findDisneyPlusSkipOverlayButton(settings) || findDisneyPlusNextEpisodeButton(settings);
}

console.log("[Skippy/Disney+] adapter loaded on", location.href);

// Live inspector — paste `__skippy()` in the console to dump current state.
/** @returns {object} Snapshot of current adapter state, for manual debugging from DevTools. */
globalThis.__skippy = function __skippy() {
  const hosts = deepQueryAll(document, "skip-button");
  const next = deepQueryAll(document, "button.up-next-lite-v1-overlay__button")[0] || null;
  const snapshot = {
    href: location.href,
    skipButtonCount: hosts.length,
    skipButtons: hosts.map((h) => ({
      visible: SkippyCore.skippyIsVisible(h),
      rect: h.getBoundingClientRect(),
      ariaLabel: h.getAttribute("aria-label"),
      hasShadowRoot: !!h.shadowRoot,
      shadowInner: h.shadowRoot?.querySelector("button, [role='button']") || null,
      textContent: (h.textContent || "").slice(0, 80),
    })),
    nextEpisode: next ? { visible: SkippyCore.skippyIsVisible(next), rect: next.getBoundingClientRect() } : null,
  };
  console.log("[Skippy/Disney+] snapshot", snapshot);
  return snapshot;
};

SkippyCore.skippyStart(findDisneyPlusSkipButton);
