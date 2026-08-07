/** Tests for `skippy-core.js` surfaces not covered by `visibility.test.js` — robust click
 * dispatch, the verbose-log gate + per-key dedupe, and the polling-loop cooldown / settings
 * reactivity. The visibility predicates (`skippyIsVisible`, `skippyIsPresent`,
 * `skippyFindVisible`) live in `visibility.test.js`; the once-per-lifetime startup paths
 * (pre-settings log buffer, settings-read failure) live in `core-startup.test.js`. Do not
 * duplicate either here. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createChromeMock } from "./_chromeMock.js";

const { chrome, reset } = createChromeMock();
vi.stubGlobal("chrome", chrome);

// skippy-core.js attaches helpers to globalThis.SkippyCore. The polling loop reads from
// SkippyStorage, so import that first.
await import("../src/helpers/storage.js");
await import("../src/content/skippy-core.js");

const { skippyClick, skippyStart, skippyLog, skippyDLog, skippySetVerbose } = globalThis.SkippyCore;

beforeEach(() => {
  reset();
  document.body.innerHTML = "";
  skippySetVerbose(false);
});

describe("SkippyCore.skippyClick", () => {
  it("clicks a <button> directly", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const spy = vi.fn();
    btn.addEventListener("click", spy);
    skippyClick(btn);
    expect(spy).toHaveBeenCalled();
  });

  it("clicks an <a> directly", () => {
    const a = document.createElement("a");
    document.body.appendChild(a);
    const spy = vi.fn();
    a.addEventListener("click", spy);
    skippyClick(a);
    expect(spy).toHaveBeenCalled();
  });

  it("clicks a [role=button] element directly", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "button");
    document.body.appendChild(el);
    const spy = vi.fn();
    el.addEventListener("click", spy);
    skippyClick(el);
    expect(spy).toHaveBeenCalled();
  });

  it("drills into an open shadow root and clicks the inner <button>", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    root.appendChild(inner);
    const spy = vi.fn();
    inner.addEventListener("click", spy);
    skippyClick(host);
    expect(spy).toHaveBeenCalled();
  });

  it("drills into an open shadow root and clicks the inner [role=button]", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("div");
    inner.setAttribute("role", "button");
    root.appendChild(inner);
    const spy = vi.fn();
    inner.addEventListener("click", spy);
    skippyClick(host);
    expect(spy).toHaveBeenCalled();
  });

  it("falls back to elementFromPoint hit-test for a plain wrapper", () => {
    const wrap = document.createElement("div");
    document.body.appendChild(wrap);
    const hit = document.createElement("button");
    document.body.appendChild(hit);
    const spy = vi.fn();
    hit.addEventListener("click", spy);
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => hit;
    try {
      skippyClick(wrap);
      expect(spy).toHaveBeenCalled();
    } finally {
      document.elementFromPoint = orig;
    }
  });

  it("does not throw when elementFromPoint returns the same element", () => {
    const wrap = document.createElement("div");
    document.body.appendChild(wrap);
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => wrap;
    try {
      expect(() => skippyClick(wrap)).not.toThrow();
    } finally {
      document.elementFromPoint = orig;
    }
  });

  it("does not throw when elementFromPoint returns null", () => {
    const wrap = document.createElement("div");
    document.body.appendChild(wrap);
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => null;
    try {
      expect(() => skippyClick(wrap)).not.toThrow();
    } finally {
      document.elementFromPoint = orig;
    }
  });

  it("does not throw when the direct .click() implementation throws", () => {
    const btn = document.createElement("button");
    btn.click = () => {
      throw new Error("boom");
    };
    document.body.appendChild(btn);
    expect(() => skippyClick(btn)).not.toThrow();
  });

  it("does not throw on a wrapper with no shadow root and no hit-test target", () => {
    const wrap = document.createElement("div");
    document.body.appendChild(wrap);
    expect(() => skippyClick(wrap)).not.toThrow();
  });
});

describe("SkippyCore.skippyLog / skippyDLog / skippySetVerbose", () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("skippyLog is silent when verbose is off", () => {
    skippySetVerbose(false);
    skippyLog("ignored");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("skippyLog forwards every argument when verbose is on", () => {
    skippySetVerbose(true);
    skippyLog("hello", 1, { a: 1 });
    expect(logSpy).toHaveBeenCalledWith("hello", 1, { a: 1 });
  });

  it("skippySetVerbose coerces truthy / falsy values via !!", () => {
    skippySetVerbose("yes");
    skippyLog("via truthy string");
    expect(logSpy).toHaveBeenCalledTimes(1);
    skippySetVerbose(0);
    skippyLog("ignored");
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("skippyDLog dedupes identical consecutive messages per key", () => {
    skippySetVerbose(true);
    skippyDLog("k1", "same");
    skippyDLog("k1", "same");
    skippyDLog("k1", "different");
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it("skippyDLog tracks dedupe per-key independently", () => {
    skippySetVerbose(true);
    skippyDLog("a", "msg");
    skippyDLog("b", "msg");
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it("skippyDLog forwards extras to console.log", () => {
    skippySetVerbose(true);
    skippyDLog("key", "msg", "extra1", { x: 1 });
    expect(logSpy).toHaveBeenCalledWith("msg", "extra1", { x: 1 });
  });

  it("skippyDLog is silent when verbose is off", () => {
    skippySetVerbose(false);
    skippyDLog("k", "msg");
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("SkippyCore.skippyStart polling loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes findSkipButton after the initial fallback wait", async () => {
    const find = vi.fn(() => null);
    skippyStart(find, { intervalMs: 200, cooldownMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(find).toHaveBeenCalled();
  });

  it("clicks the returned button and gates a second click by per-element cooldown", async () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const spy = vi.fn();
    btn.addEventListener("click", spy);
    skippyStart(() => btn, { intervalMs: 100, cooldownMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    const firstCount = spy.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(spy.mock.calls.length).toBe(firstCount);
  });

  it("clicks a different button on the next tick even within the prior button's cooldown", async () => {
    // Seed storage so the cached settings hand back a 100 ms pollIntervalMs (otherwise
    // the loop re-arms with the 500 ms default after the first tick and we'd need to
    // advance the timers by 600 ms to see the second click).
    await chrome.storage.sync.set({ skippySettings: { pollIntervalMs: 100 } });
    const a = document.createElement("button");
    const b = document.createElement("button");
    document.body.append(a, b);
    const aSpy = vi.fn();
    const bSpy = vi.fn();
    a.addEventListener("click", aSpy);
    b.addEventListener("click", bSpy);
    let toggle = false;
    skippyStart(
      () => {
        toggle = !toggle;
        return toggle ? a : b;
      },
      { intervalMs: 100, cooldownMs: 5000 },
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(aSpy).toHaveBeenCalled();
    expect(bSpy).toHaveBeenCalled();
  });

  it("reacts to storage onChanged by refreshing cached settings", async () => {
    const find = vi.fn(() => null);
    skippyStart(find, { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    await chrome.storage.sync.set({ skippySettings: { verboseLogging: true } });
    await vi.advanceTimersByTimeAsync(100);
    expect(find).toHaveBeenCalled();
  });

  it("uses the default SKIPPY_DEFAULTS.pollIntervalMs when options.intervalMs is omitted", async () => {
    const find = vi.fn(() => null);
    skippyStart(find);
    await vi.advanceTimersByTimeAsync(0);
    // Default falls back to SKIPPY_DEFAULTS.pollIntervalMs (500 ms).
    await vi.advanceTimersByTimeAsync(500);
    expect(find).toHaveBeenCalled();
  });

  it("catches an adapter throw, warns once, and keeps polling", async () => {
    // Regression: the throw escaped `tick` into the setTimeout callback. The `finally`
    // re-armed the loop, so it never stopped — it just reported an unattributed uncaught
    // error to the console on every tick, several times a second.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const find = vi.fn(() => {
      throw new Error("adapter broke");
    });
    skippyStart(find, { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(find).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[Skippy] adapter threw during poll — continuing",
      expect.any(Error),
    );

    // Same failure on later ticks is deduped rather than logged again.
    const afterFirst = warn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(warn.mock.calls.length).toBe(afterFirst);
    warn.mockRestore();
  });
});
