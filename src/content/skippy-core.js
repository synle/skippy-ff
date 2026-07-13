/** Skippy core. Site-agnostic helpers for detecting and clicking skip buttons. */

/** Verbose-logging flag. Mirrored from `settings.verboseLogging` by `skippyStart`. */
let _verbose = false;

/** Per-key dedupe cache for `skippyDLog`. Suppresses identical consecutive messages. */
const _lastDLog = /** @type {Record<string, string>} */ ({});

/**
 * Flip the in-memory verbose flag. Called by `skippyStart` whenever settings load or change.
 * @param {boolean} value New verbose state.
 * @returns {void}
 */
function skippySetVerbose(value) {
  _verbose = !!value;
}

/**
 * Verbose-gated `console.log`. No-op unless `settings.verboseLogging` is true. Use this
 * for any diagnostic line that should be silent for normal users but visible while
 * debugging from the options page.
 * @param {...unknown} args Values to log.
 * @returns {void}
 */
function skippyLog(...args) {
  if (!_verbose) return;
  console.log(...args);
}

/**
 * Throttled verbose log — emits only when the (key, message) pair differs from the
 * previous emission for the same key. Pair with a stable `key` per call site so a
 * polling loop doesn't spam the console while state is unchanged.
 * @param {string} key Stable identifier for the log line.
 * @param {string} message Text to log; suppressed when equal to the previous message for this key.
 * @param {...unknown} extras Additional values to log alongside.
 * @returns {void}
 */
function skippyDLog(key, message, ...extras) {
  if (!_verbose) return;
  if (_lastDLog[key] === message) return;
  _lastDLog[key] = message;
  console.log(message, ...extras);
}

/**
 * Check if an element is visually present and clickable. Strict — used as the primary
 * click gate by every site adapter.
 *
 * Checks are ordered fail-fast, strongest author-intent signal first, cheapest within
 * a tier. Streaming players hide skip buttons in several different ways depending on
 * the build (`aria-hidden="true"` on a wrapper, `inert` on the chrome container,
 * `opacity:0 + pointer-events:none` during idle fade, transform-to-zero), so the gate
 * needs to handle all of them or the adapter false-positives in subtle ways.
 *
 * Order:
 *   1. `isConnected` — must be in the DOM at all (cheapest possible check).
 *   2. `closest('[aria-hidden="true"]')` — author explicitly hid this for assistive tech;
 *      covers self + every ancestor in one DOM walk because `aria-hidden` cascades semantically.
 *   3. `closest('[inert]')` — author explicitly marked this subtree non-interactive; browsers
 *      actively block focus + click on `inert`, so this is a hard "not visible" signal.
 *   4. computed `display !== "none"` (self) — ancestor `display:none` collapses the rect to
 *      0×0, which step 6 catches, so a self-check is enough here.
 *   5. computed `visibility !== "hidden"` (self) — `visibility` inherits via the CSS cascade,
 *      so `getComputedStyle(self)` already reflects ancestor state. A descendant overriding
 *      with `visibility: visible` correctly counts as visible.
 *   6. `getBoundingClientRect()` > 0×0 — catches anything the above missed: ancestor
 *      `display:none`, `transform: scale(0)`, `clip-path`, zero-height container.
 *   7. `parseFloat(opacity) > 0` — anything not fully transparent counts. Threshold is
 *      strictly > 0 (not ≥ 0.5) so a button mid-fade-in is treated as visible the moment
 *      it's painting any pixels, matching "if you can see it, it counts".
 *   8. `pointer-events !== "none"` — weakest signal because programmatic `.click()` still
 *      works on `pointer-events: none`. Kept as a tie-breaker so the Crunchyroll
 *      idle-faded combo (`opacity:0 + pointer-events:none`) is fully fenced off even if
 *      a future build animates one of the two independently.
 * @param {Element} el Candidate element.
 * @returns {boolean} True when the element passes all eight gates.
 */
function skippyIsVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  if (!el.isConnected) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if (el.closest("[inert]")) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (parseFloat(style.opacity) <= 0) return false;
  if (style.pointerEvents === "none") return false;
  return true;
}

/**
 * Permissive presence check — true when the element passes the "hard hidden" gates but
 * is allowed to be visually faded or non-interactive. Use this when a site keeps the
 * skip button mounted full-time and only animates its chrome (e.g. Apple TV's player),
 * where the underlying click handler is still wired up and would respond to a
 * programmatic `.click()` regardless of opacity.
 *
 * Matches `skippyIsVisible` steps 1–6 exactly. The opacity + pointer-events gates
 * (steps 7–8) are dropped because those are the very signals a fading-chrome site
 * toggles while keeping the handler wired. Author-intent gates (`aria-hidden`,
 * `inert`) stay on — a button the author marked semantically hidden is hidden
 * regardless of whether it's painting pixels.
 * @param {Element} el Candidate element.
 * @returns {boolean} True when the element is in the DOM with non-zero layout box and not author-hidden.
 */
function skippyIsPresent(el) {
  if (!el || !(el instanceof Element)) return false;
  if (!el.isConnected) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if (el.closest("[inert]")) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return true;
}

/**
 * Find the first visible element matching one of the candidate selectors.
 * @param {string[]} selectors CSS selectors to try in order.
 * @returns {HTMLElement|null} First visible match or null.
 */
function skippyFindVisible(selectors) {
  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (skippyIsVisible(node)) return node;
    }
  }
  return null;
}

/**
 * Click an element robustly. Streaming players often render the real `<button>` inside
 * a custom element's shadow root, so a plain MouseEvent dispatched on the host may never
 * reach the listener. Strategy depends on what the caller hands us:
 *   - **Direct click target** (`<button>`, `<a>`, or `[role="button"]`): call `.click()` AND
 *     dispatch composed mousedown/mouseup/click events so both `el.onclick` handlers and
 *     `addEventListener('click', …)` listeners (including those inside enclosing shadow
 *     roots) fire. Skip the hit-test fallback — the adapter already resolved the target,
 *     so `elementFromPoint` would only walk us back up to a wrapper that has no handler.
 *   - **Custom element with an open shadow root**: drill into the shadow root and recurse
 *     once we find an inner button.
 *   - **Anything else** (closed shadow root, plain wrapper): hit-test the center with
 *     `document.elementFromPoint`, which transparently returns the topmost paintable node.
 * @param {HTMLElement} el Element to click.
 * @returns {void}
 */
function skippyClick(el) {
  const tag = el.tagName;
  const isClickTarget = tag === "BUTTON" || tag === "A" || el.getAttribute("role") === "button";

  // 1. Caller already resolved a real click target — fire on it directly.
  if (isClickTarget) {
    try {
      // el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true, view: window }));
      // el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true, view: window }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window }));
      el.click();
      skippyLog("[Skippy] click via direct on", tag, el);
      return;
    } catch (err) {
      skippyLog("[Skippy] direct click failed, falling through", err);
    }
  }

  // 2. Open shadow root with an inner button? Drill in and recurse.
  try {
    const shadowBtn = /** @type {HTMLElement|null} */ (el.shadowRoot?.querySelector("button, [role='button']") || null);
    if (shadowBtn) {
      skippyLog("[Skippy] click via shadow inner button", shadowBtn);
      skippyClick(shadowBtn);
      return;
    }
  } catch (err) {
    skippyLog("[Skippy] shadow click attempt failed", err);
  }

  // 3. elementFromPoint hit-test — works for closed shadow roots too.
  try {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hit = /** @type {HTMLElement|null} */ (document.elementFromPoint(cx, cy));
    if (hit && hit !== el) {
      skippyLog("[Skippy] click via elementFromPoint", hit);
      hit.click();
      return;
    }
  } catch (err) {
    skippyLog("[Skippy] elementFromPoint click attempt failed", err);
  }

  // 4. Last-resort composed MouseEvent + native click on the original element.
  try {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window }));
    el.click();
    skippyLog("[Skippy] click via fallback composed + native", el);
  } catch (err) {
    skippyLog("[Skippy] fallback click failed", err);
  }
}

/**
 * Start a polling loop that asks the site adapter for the next button to click.
 * Adapter returns the element to click (or null) given current settings. The loop uses
 * a `setTimeout` re-arm pattern (not `setInterval`) so a change to `settings.pollIntervalMs`
 * takes effect on the very next tick without a restart. Per-element cooldown prevents
 * repeated clicks on the same button while the site is slow to update DOM.
 *
 * The poll loop itself does not gate visibility — adapters are responsible for handing
 * back only buttons that are actually clickable. The strict-visible gate lives in each
 * adapter so it can decide between strict (`skippyIsVisible`) and permissive
 * (`skippyIsPresent`) per its own site behavior; Crunchyroll, for example, must use
 * strict-only on Skip Intro/Recap/Credits because the player otherwise re-triggers its
 * control overlay every time we click an idle-faded button.
 * @param {(settings: object) => HTMLElement|null} findSkipButton Site adapter callback.
 * @param {object} [options] Options.
 * @param {number} [options.intervalMs] Fallback polling interval in ms when settings haven't loaded yet.
 * @param {number} [options.cooldownMs] Per-element cooldown in ms after a click.
 * @returns {void}
 */
function skippyStart(findSkipButton, options = {}) {
  const fallbackIntervalMs = options.intervalMs ?? SkippyStorage.SKIPPY_DEFAULTS.pollIntervalMs ?? 500;
  const cooldownMs = options.cooldownMs ?? 2000;
  const lastClickedAt = new WeakMap();

  let settings = null;
  SkippyStorage.getSkippySettings().then((s) => {
    settings = s;
    skippySetVerbose(s.verboseLogging);
    skippyLog("[Skippy] loaded settings", s);
  });
  SkippyStorage.onSkippySettingsChanged((s) => {
    settings = s;
    skippySetVerbose(s.verboseLogging);
    skippyLog("[Skippy] settings changed", s);
  });

  /**
   * One iteration of the poll loop. Reads the current `pollIntervalMs` from settings
   * (clamped via `SkippyStorage.clampPollIntervalMs` as a defensive fallback) and re-arms
   * itself. Runs the adapter, gates clicks by cooldown, logs the click unconditionally.
   * @returns {void}
   */
  function tick() {
    let intervalMs = fallbackIntervalMs;
    try {
      if (settings) {
        intervalMs = SkippyStorage.clampPollIntervalMs(settings.pollIntervalMs ?? fallbackIntervalMs);
        const button = findSkipButton(settings);
        if (button) {
          const last = lastClickedAt.get(button) || 0;
          if (Date.now() - last >= cooldownMs) {
            lastClickedAt.set(button, Date.now());
            const label = button.getAttribute("aria-label") || (button.textContent || "").trim().slice(0, 80);
            // Click event is the load-bearing user-visible action — log even when verboseLogging is off
            // so a user troubleshooting "did Skippy actually skip?" sees a one-liner without re-enabling
            // the full verbose stream.
            console.log("[Skippy] clicking", label || "(no label)", button);
            skippyClick(button);
          }
        }
      }
    } finally {
      setTimeout(tick, intervalMs);
    }
  }

  skippyLog("[Skippy] polling started", { host: location.host, fallbackIntervalMs, cooldownMs });
  setTimeout(tick, fallbackIntervalMs);
}

// Expose for site adapters.
globalThis.SkippyCore = {
  skippyIsVisible,
  skippyIsPresent,
  skippyFindVisible,
  skippyClick,
  skippyStart,
  skippyLog,
  skippyDLog,
  skippySetVerbose,
};
