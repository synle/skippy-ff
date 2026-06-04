/** Skippy core. Site-agnostic helpers for detecting and clicking skip buttons. */

/* global SkippyStorage */

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
 * Click an element with a dispatched MouseEvent. Falls back to .click().
 * @param {HTMLElement} el Element to click.
 * @returns {void}
 */
function skippyClick(el) {
  try {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  } catch {
    el.click();
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
  SkippyStorage.getSkippySettings().then((s) => (settings = s));
  SkippyStorage.onSkippySettingsChanged((s) => (settings = s));

  setInterval(() => {
    if (!settings) return;
    const button = findSkipButton(settings);
    if (!button) return;
    const last = lastClickedAt.get(button) || 0;
    if (Date.now() - last < cooldownMs) return;
    lastClickedAt.set(button, Date.now());
    skippyClick(button);
    console.debug("[Skippy] clicked", button.getAttribute("aria-label") || button.textContent);
  }, intervalMs);
}

// Expose for site adapters.
globalThis.SkippyCore = {
  skippyIsVisible,
  skippyFindVisible,
  skippyClick,
  skippyStart,
};
