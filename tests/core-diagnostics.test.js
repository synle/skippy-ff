/** Verify diagnostic wiring without changing polling cadence, visibility ownership, or fail-closed behavior. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createChromeMock } from "./_chromeMock.js";

const { document, Event, console } = globalThis;
let core;
let diagnostics;
let chrome;
let visibility;
let visibilityHandler;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  ({ chrome } = createChromeMock());
  vi.stubGlobal("chrome", chrome);
  diagnostics = { init: vi.fn(), record: vi.fn() };
  vi.stubGlobal("SkippyDiagnostics", diagnostics);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const addListener = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((name, listener, options) => {
    if (name === "visibilitychange") visibilityHandler = listener;
    addListener(name, listener, options);
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await import("../src/helpers/storage.js");
  await import("../src/content/skippy-core.js");
  core = globalThis.SkippyCore;
});

afterEach(() => {
  document.removeEventListener("visibilitychange", visibilityHandler);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("records caught adapter errors even when verbose logging is off", async () => {
  const error = new TypeError("private message");
  core.skippyStart(
    () => {
      throw error;
    },
    { intervalMs: 100 },
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(diagnostics.init).toHaveBeenCalledWith("content");
  expect(diagnostics.record).toHaveBeenCalledWith("adapter_error", error, {
    pollIntervalMs: 500,
    pendingTimers: 0,
  });
  expect(vi.getTimerCount()).toBe(1);
});

it("records settings failure and never invokes the adapter without settings", async () => {
  const error = new Error("unavailable");
  chrome.storage.sync.get.mockRejectedValueOnce(error);
  const find = vi.fn();
  core.skippyStart(find, { intervalMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  expect(diagnostics.record).toHaveBeenCalledWith("settings_error", error);
  expect(find).not.toHaveBeenCalled();
});

it("records hidden/resumed timer state without duplicate timers across repeated visibility events", async () => {
  const find = vi.fn(() => null);
  core.skippyStart(find, { intervalMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  const before = find.mock.calls.length;
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(find).toHaveBeenCalledTimes(before);
  expect(vi.getTimerCount()).toBe(0);
  expect(diagnostics.record).toHaveBeenCalledWith("poll_paused", null, { pendingTimers: 0 });
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(vi.getTimerCount()).toBe(1);
  expect(diagnostics.record).toHaveBeenCalledWith("poll_resumed", null, { pendingTimers: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(find).toHaveBeenCalledTimes(before + 1);
  expect(vi.getTimerCount()).toBe(1);
});
