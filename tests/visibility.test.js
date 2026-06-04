/** Tests for the SkippyCore visibility engine — the eight-gate `skippyIsVisible` and the
 * permissive `skippyIsPresent`. These are pure DOM predicates so jsdom is a faithful host
 * (in contrast to the rest of `skippy-core.js`, which exercises chrome.storage and the
 * polling loop and is validated manually per CLAUDE.md). */
import { describe, it, expect, beforeEach } from "vitest";

// Importing for side effect — skippy-core.js attaches helpers to globalThis.SkippyCore.
// No SkippyStorage import needed: the visibility helpers don't touch storage; only the
// polling loop does, and we never call `skippyStart` in these tests.
await import("../src/content/skippy-core.js");

const { skippyIsVisible, skippyIsPresent } = globalThis.SkippyCore;

/**
 * Override jsdom's `getBoundingClientRect` (which returns 0×0 for every element because
 * jsdom doesn't run layout) so the rect gate doesn't mask the other gates we're trying
 * to test. Default size is 100×30 — anything non-zero is fine; specific dimensions don't
 * affect any gate downstream of rect itself.
 * @param {Element} el Element to patch.
 * @param {{width?: number, height?: number}} [rect] Optional dimensions.
 * @returns {void}
 */
function stubRect(el, rect = {}) {
  const width = rect.width ?? 100;
  const height = rect.height ?? 30;
  el.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  });
}

/**
 * Build a `<button>` with optional inline style + attributes, append it to `parent`
 * (default `document.body`), stub a non-zero rect, and return it. Keeps the test bodies
 * focused on the gate under examination rather than DOM-setup boilerplate.
 * @param {{style?: Record<string, string>, attrs?: Record<string, string>, rect?: {width?: number, height?: number}, parent?: Element}} [opts]
 * @returns {HTMLButtonElement}
 */
function mkButton(opts = {}) {
  const btn = document.createElement("button");
  btn.textContent = "X";
  if (opts.style) {
    for (const [k, v] of Object.entries(opts.style)) {
      btn.style[k] = v;
    }
  }
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      btn.setAttribute(k, v);
    }
  }
  (opts.parent ?? document.body).appendChild(btn);
  stubRect(btn, opts.rect);
  return btn;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("SkippyCore.skippyIsVisible", () => {
  it("returns true for a plain attached button with default rect", () => {
    expect(skippyIsVisible(mkButton())).toBe(true);
  });

  it("returns false for null", () => {
    expect(skippyIsVisible(null)).toBe(false);
  });

  it("returns false for a non-Element value", () => {
    expect(skippyIsVisible(/** @type {any} */ ({}))).toBe(false);
  });

  it("returns false for a detached element (gate 1 — isConnected)", () => {
    const btn = document.createElement("button");
    stubRect(btn);
    expect(skippyIsVisible(btn)).toBe(false);
  });

  it("returns false when self carries aria-hidden='true' (gate 2)", () => {
    expect(skippyIsVisible(mkButton({ attrs: { "aria-hidden": "true" } }))).toBe(false);
  });

  it("returns false when an ancestor carries aria-hidden='true' (gate 2 — closest walk)", () => {
    const wrap = document.createElement("div");
    wrap.setAttribute("aria-hidden", "true");
    document.body.appendChild(wrap);
    expect(skippyIsVisible(mkButton({ parent: wrap }))).toBe(false);
  });

  it("returns false when self carries [inert] (gate 3)", () => {
    expect(skippyIsVisible(mkButton({ attrs: { inert: "" } }))).toBe(false);
  });

  it("returns false when an ancestor carries [inert] (gate 3 — closest walk)", () => {
    const wrap = document.createElement("div");
    wrap.setAttribute("inert", "");
    document.body.appendChild(wrap);
    expect(skippyIsVisible(mkButton({ parent: wrap }))).toBe(false);
  });

  it("returns false when display:none (gate 4)", () => {
    expect(skippyIsVisible(mkButton({ style: { display: "none" } }))).toBe(false);
  });

  it("returns false when visibility:hidden (gate 5)", () => {
    expect(skippyIsVisible(mkButton({ style: { visibility: "hidden" } }))).toBe(false);
  });

  it("returns false when rect is 0×0 (gate 6)", () => {
    expect(skippyIsVisible(mkButton({ rect: { width: 0, height: 0 } }))).toBe(false);
  });

  it("returns false when opacity is exactly 0 (gate 7)", () => {
    expect(skippyIsVisible(mkButton({ style: { opacity: "0" } }))).toBe(false);
  });

  it("returns true when opacity is 0.01 — anything not fully transparent counts", () => {
    expect(skippyIsVisible(mkButton({ style: { opacity: "0.01" } }))).toBe(true);
  });

  it("returns true when opacity is 0.4 — the prior 0.5 threshold no longer applies", () => {
    expect(skippyIsVisible(mkButton({ style: { opacity: "0.4" } }))).toBe(true);
  });

  it("returns false when pointer-events:none (gate 8)", () => {
    expect(skippyIsVisible(mkButton({ style: { pointerEvents: "none" } }))).toBe(false);
  });
});

describe("SkippyCore.skippyIsPresent", () => {
  it("returns true for a plain attached button", () => {
    expect(skippyIsPresent(mkButton())).toBe(true);
  });

  it("returns false for null", () => {
    expect(skippyIsPresent(null)).toBe(false);
  });

  it("returns false for a non-Element value", () => {
    expect(skippyIsPresent(/** @type {any} */ ({}))).toBe(false);
  });

  it("returns false for a detached element", () => {
    const btn = document.createElement("button");
    stubRect(btn);
    expect(skippyIsPresent(btn)).toBe(false);
  });

  it("returns true when opacity:0 — the permissive gate drops the opacity check", () => {
    expect(skippyIsPresent(mkButton({ style: { opacity: "0" } }))).toBe(true);
  });

  it("returns true when pointer-events:none — the permissive gate drops the pointer-events check", () => {
    expect(skippyIsPresent(mkButton({ style: { pointerEvents: "none" } }))).toBe(true);
  });

  it("returns true on the Crunchyroll idle-fade combo (opacity:0 + pointer-events:none)", () => {
    expect(skippyIsPresent(mkButton({ style: { opacity: "0", pointerEvents: "none" } }))).toBe(true);
  });

  it("returns false when aria-hidden='true' on self — author-intent gate kept even on permissive", () => {
    expect(skippyIsPresent(mkButton({ attrs: { "aria-hidden": "true" } }))).toBe(false);
  });

  it("returns false when aria-hidden on an ancestor", () => {
    const wrap = document.createElement("div");
    wrap.setAttribute("aria-hidden", "true");
    document.body.appendChild(wrap);
    expect(skippyIsPresent(mkButton({ parent: wrap }))).toBe(false);
  });

  it("returns false when [inert] on self", () => {
    expect(skippyIsPresent(mkButton({ attrs: { inert: "" } }))).toBe(false);
  });

  it("returns false when [inert] on an ancestor", () => {
    const wrap = document.createElement("div");
    wrap.setAttribute("inert", "");
    document.body.appendChild(wrap);
    expect(skippyIsPresent(mkButton({ parent: wrap }))).toBe(false);
  });

  it("returns false when display:none", () => {
    expect(skippyIsPresent(mkButton({ style: { display: "none" } }))).toBe(false);
  });

  it("returns false when visibility:hidden", () => {
    expect(skippyIsPresent(mkButton({ style: { visibility: "hidden" } }))).toBe(false);
  });

  it("returns false when rect is 0×0", () => {
    expect(skippyIsPresent(mkButton({ rect: { width: 0, height: 0 } }))).toBe(false);
  });
});
