/** Tests for `skippy-core.js` behavior that only happens once per content-script lifetime:
 * the pre-settings log buffer and the settings-read failure path. Each case needs a fresh
 * module registry because the "have we resolved verboseLogging yet?" latch lives in module
 * scope. Steady-state polling / click / log behavior lives in `core.test.js`. */
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Load a fresh `skippy-core.js` (plus its `SkippyStorage` dependency) against a stubbed
 * `chrome.storage.sync.get`.
 * @param {() => Promise<object>} getImpl Implementation for `chrome.storage.sync.get`.
 * @returns {Promise<object>} The freshly-attached `globalThis.SkippyCore`.
 */
async function loadCore(getImpl) {
  vi.resetModules();
  vi.stubGlobal("chrome", {
    storage: {
      sync: { get: vi.fn(getImpl), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn() },
    },
  });
  await import("../src/helpers/storage.js");
  await import("../src/content/skippy-core.js");
  return globalThis.SkippyCore;
}

describe("SkippyCore startup log buffering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emits logs made before settings resolved once verbose turns out to be on", async () => {
    // Regression: adapters call `skippyLog("[Skippy/<site>] adapter loaded on", href)` at
    // load time, which is always before the async settings read lands. The flag was still
    // false then, so the single most useful "is Skippy running at all?" line could never
    // print no matter what the user set.
    const core = await loadCore(async () => ({ skippySettings: { verboseLogging: true } }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    core.skippyLog("[Skippy/Test] adapter loaded on", "https://example.test/");
    expect(logSpy).not.toHaveBeenCalled();

    core.skippyStart(() => null, { intervalMs: 100000 });
    await vi.waitFor(() => expect(logSpy).toHaveBeenCalled());

    expect(logSpy).toHaveBeenCalledWith("[Skippy/Test] adapter loaded on", "https://example.test/");
  });

  it("discards buffered logs when verbose turns out to be off", async () => {
    const core = await loadCore(async () => ({ skippySettings: { verboseLogging: false } }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    core.skippyLog("[Skippy/Test] adapter loaded on", "https://example.test/");
    core.skippyStart(() => null, { intervalMs: 100000 });
    await vi.waitFor(() => expect(globalThis.SkippyStorage).toBeTruthy());
    await Promise.resolve();
    await Promise.resolve();

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("caps the buffer so an unresolved settings read cannot grow it without bound", async () => {
    const core = await loadCore(() => new Promise(() => {}));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    for (let i = 0; i < 200; i += 1) core.skippyLog("line", i);
    core.skippySetVerbose(true);

    expect(logSpy).toHaveBeenCalledTimes(50);
    expect(logSpy).toHaveBeenLastCalledWith("line", 49);
  });
});

describe("SkippyCore.skippyStart settings-read failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("warns and clicks nothing when the initial settings read rejects", async () => {
    // Regression: the rejection was unhandled, `settings` stayed null forever, and the
    // poll loop spun silently — indistinguishable from "working, nothing to skip".
    const core = await loadCore(async () => {
      throw new Error("Extension context invalidated.");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const find = vi.fn(() => document.createElement("button"));
      core.skippyStart(find, { intervalMs: 10 });
      await vi.advanceTimersByTimeAsync(100);

      expect(warn).toHaveBeenCalledWith(
        "[Skippy] could not read settings — skipping is disabled on this page",
        expect.any(Error),
      );
      expect(find).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases buffered startup logs even when the settings read rejects", async () => {
    const core = await loadCore(async () => {
      throw new Error("Extension context invalidated.");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    core.skippyLog("[Skippy/Test] adapter loaded");
    core.skippyStart(() => null, { intervalMs: 100000 });
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());

    // Verbose state is unknowable, so buffered lines are dropped rather than printed —
    // but the latch must release so later logs aren't queued forever.
    expect(logSpy).not.toHaveBeenCalled();
    core.skippySetVerbose(true);
    core.skippyLog("after");
    expect(logSpy).toHaveBeenCalledWith("after");
  });
});
