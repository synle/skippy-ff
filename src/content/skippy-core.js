/** Skippy core. Site-agnostic helpers for detecting and clicking skip buttons. */

/**
 * Check if an element is visually present and clickable.
 * Streaming players hide skip buttons via opacity:0 + pointer-events:none rather than display:none.
 * @param {Element} el Candidate element.
 * @returns {boolean} True when the element occupies space and accepts pointer events.
 */
function skippyIsVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (parseFloat(style.opacity) < 0.5) return false;
  if (style.pointerEvents === "none") return false;
  return true;
}

/**
 * Permissive presence check — true when the element is attached to the document,
 * occupies layout space, and isn't `display:none` / `visibility:hidden`. Unlike
 * `skippyIsVisible`, this does NOT gate on `opacity` or `pointer-events`, because
 * some players (e.g. Crunchyroll) toggle those off while the player controls fade
 * out on mouse idle even though the underlying click handler is still wired up
 * and would respond to a programmatic `.click()`. Use this when a site keeps the
 * skip button mounted full-time and only animates its chrome.
 * @param {Element} el Candidate element.
 * @returns {boolean} True when the element is in the DOM with non-zero layout box.
 */
function skippyIsPresent(el) {
  if (!el || !(el instanceof Element)) return false;
  if (!el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
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
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true, view: window }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true, view: window }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window }));
      el.click();
      console.log("[Skippy] click via direct on", tag, el);
      return;
    } catch (err) {
      console.log("[Skippy] direct click failed, falling through", err);
    }
  }

  // 2. Open shadow root with an inner button? Drill in and recurse.
  try {
    const shadowBtn = /** @type {HTMLElement|null} */ (el.shadowRoot?.querySelector("button, [role='button']") || null);
    if (shadowBtn) {
      console.log("[Skippy] click via shadow inner button", shadowBtn);
      skippyClick(shadowBtn);
      return;
    }
  } catch (err) {
    console.log("[Skippy] shadow click attempt failed", err);
  }

  // 3. elementFromPoint hit-test — works for closed shadow roots too.
  try {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hit = /** @type {HTMLElement|null} */ (document.elementFromPoint(cx, cy));
    if (hit && hit !== el) {
      console.log("[Skippy] click via elementFromPoint", hit);
      hit.click();
      return;
    }
  } catch (err) {
    console.log("[Skippy] elementFromPoint click attempt failed", err);
  }

  // 4. Last-resort composed MouseEvent + native click on the original element.
  try {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window }));
    el.click();
    console.log("[Skippy] click via fallback composed + native", el);
  } catch (err) {
    console.log("[Skippy] fallback click failed", err);
  }
}

/**
 * Start a polling loop that asks the site adapter for the next button to click.
 * Adapter returns the element to click (or null) given current settings.
 * Cooldown prevents repeated clicks on the same button if the site is slow to update DOM.
 * @param {(settings: object) => HTMLElement|null} findSkipButton Site adapter callback.
 * @param {object} [options] Options.
 * @param {number} [options.intervalMs] Polling interval in ms.
 * @param {number} [options.cooldownMs] Per-element cooldown in ms after a click.
 * @returns {void}
 */
function skippyStart(findSkipButton, options = {}) {
  const intervalMs = options.intervalMs ?? 500;
  const cooldownMs = options.cooldownMs ?? 2000;
  const lastClickedAt = new WeakMap();

  let settings = null;
  SkippyStorage.getSkippySettings().then((s) => {
    settings = s;
    console.log("[Skippy] loaded settings", s);
  });
  SkippyStorage.onSkippySettingsChanged((s) => {
    settings = s;
    console.log("[Skippy] settings changed", s);
  });

  console.log("[Skippy] polling started", { host: location.host, intervalMs, cooldownMs });
  setInterval(() => {
    if (!settings) return;
    const button = findSkipButton(settings);
    if (!button) return;
    const last = lastClickedAt.get(button) || 0;
    if (Date.now() - last < cooldownMs) return;
    lastClickedAt.set(button, Date.now());
    const label = button.getAttribute("aria-label") || (button.textContent || "").trim().slice(0, 80);
    console.log("[Skippy] clicking", label || "(no label)", button);
    skippyClick(button);
  }, intervalMs);
}

// Expose for site adapters.
globalThis.SkippyCore = {
  skippyIsVisible,
  skippyIsPresent,
  skippyFindVisible,
  skippyClick,
  skippyStart,
};
