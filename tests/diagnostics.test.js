/** End-to-end diagnostic messaging and persistence contracts with Chrome APIs mocked at the boundary. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setImmediate as settle } from "node:timers/promises";

const ROOT = "chrome-extension://skippy-test/";
const KEY = "skippyDiagnostics";
const optionsSender = {
  id: "skippy-test",
  url: `${ROOT}pages/options/options.html`,
  tab: { id: 2 },
};
const contentSender = {
  id: "skippy-test",
  url: "https://www.netflix.com/watch/private?token=secret",
  tab: { id: 1 },
};
const event = {
  kind: "adapter_error",
  name: "TypeError",
  frames: ["content/skippy-netflix.js:12:3"],
};
let chrome;
let data;
let handler;
let hooks;
let api;

/** Dispatch through the real worker message listener, including Chrome's asynchronous response contract. */
function request(action, sender = optionsSender, extra = {}) {
  return new Promise((resolve) => {
    const async = handler({ type: "SKIPPY_DIAGNOSTICS", action, ...extra }, sender, resolve);
    if (!async) resolve(undefined);
  });
}

/** Read through the real authorized export surface, not the helper's private storage representation. */
async function report() {
  return (await request("export")).report;
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  data = {};
  hooks = {};
  vi.spyOn(globalThis, "addEventListener").mockImplementation((name, listener) => {
    hooks[name] = listener;
  });
  chrome = {
    runtime: {
      id: "skippy-test",
      getURL: (path) => ROOT + path,
      getManifest: () => ({ version: "0.42.0" }),
      onMessage: {
        addListener: vi.fn((listener) => {
          handler = listener;
        }),
      },
      sendMessage: vi.fn(async (message) => {
        await request(message.action, contentSender, message);
      }),
    },
    storage: {
      local: {
        get: vi.fn(async () => globalThis.structuredClone(data)),
        set: vi.fn(async (value) => {
          Object.assign(data, globalThis.structuredClone(value));
        }),
        remove: vi.fn(async (key) => {
          delete data[key];
        }),
      },
    },
  };
  vi.stubGlobal("chrome", chrome);
  await import("../src/helpers/storage.js");
  await import("../src/helpers/menu.js");
  await import("../src/helpers/diagnostics.js");
  api = globalThis.SkippyDiagnostics;
  api.init("background");
  await settle();
});

afterEach(async () => {
  await settle();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.SkippyDiagnostics;
});

describe("local diagnostic evidence", () => {
  it("keeps worker starts informational across normal idle restarts", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    vi.resetModules();
    await import("../src/helpers/diagnostics.js");
    globalThis.SkippyDiagnostics.init("background");
    const result = await report();
    expect(result.events.map((entry) => entry.kind)).toMatchInlineSnapshot(`
      [
        "worker_start",
        "worker_start",
      ]
    `);
    expect(result.attribution).toBe(
      "unknown; JavaScript errors and lifecycle events do not prove a native crash cause",
    );
    expect(result.extensionVersion).toBe("0.42.0");
    expect(result.lastWriteFailed).toBe(false);
  });

  it("installs once with no diagnostic timer or port", async () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    api.init("background");
    api.init("invalid");
    expect((await report()).events).toHaveLength(1);
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });

  it("preserves concurrent content events with browser-supplied site identity", async () => {
    await Promise.all([
      request("record", contentSender, { event }),
      request("record", contentSender, { event: { ...event, kind: "settings_error" } }),
    ]);
    const events = (await report()).events;
    expect(events.map((entry) => entry.kind)).toMatchInlineSnapshot(`
      [
        "worker_start",
        "adapter_error",
        "settings_error",
      ]
    `);
    expect(events[1]).toMatchInlineSnapshot(`
      {
        "context": "content",
        "frames": [
          "content/skippy-netflix.js:12:3",
        ],
        "kind": "adapter_error",
        "name": "TypeError",
        "site": "netflix.com",
        "timestamp": 1767225600000,
      }
    `);
    expect(JSON.stringify(events)).not.toContain("private");
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("records global worker exceptions and primitive promise rejection without messages", async () => {
    hooks.error({
      error: {
        name: "TypeError",
        message: "private-token",
        stack: `TypeError: private-token\n at privateTitle (${ROOT}background.js:10:2)\n at https://example.com/private:2:3\n at chrome-extension://other/background.js:4:5`,
      },
    });
    hooks.unhandledrejection({ reason: "private-token" });
    const events = (await report()).events;
    expect(events[1]).toMatchInlineSnapshot(`
      {
        "context": "background",
        "frames": [
          "background.js:10:2",
        ],
        "kind": "error",
        "name": "TypeError",
        "site": null,
        "timestamp": 1767225600000,
      }
    `);
    expect(events[2].kind).toBe("unhandled_rejection");
    expect(JSON.stringify(events)).not.toContain("private");
    expect(JSON.stringify(events)).not.toContain("other");
  });

  it("keeps at most 80 validated records and ignores unknown persisted fields", async () => {
    data[KEY] = Array.from({ length: 100 }, () => ({
      ...event,
      context: "content",
      site: "netflix.com",
      timestamp: 1,
      secret: "discard",
    }));
    api.record("menu_ready", null, { menuItems: 102 });
    const events = (await report()).events;
    expect(events).toHaveLength(80);
    expect(events.at(-1)).toMatchInlineSnapshot(`
      {
        "context": "background",
        "frames": [],
        "kind": "menu_ready",
        "menuItems": 102,
        "name": null,
        "site": null,
        "timestamp": 1767225600000,
      }
    `);
    expect(JSON.stringify(events)).not.toContain("discard");
  });

  it("bounds counters on both sides and drops arbitrary fields", async () => {
    api.record("adapter_error", null, {
      menuItems: -1,
      pollIntervalMs: 1e30,
      pendingTimers: 0,
      url: "private",
      raw: "private",
    });
    expect((await report()).events.at(-1)).toMatchInlineSnapshot(`
      {
        "context": "background",
        "frames": [],
        "kind": "adapter_error",
        "menuItems": 0,
        "name": null,
        "pendingTimers": 0,
        "pollIntervalMs": 1000000,
        "site": null,
        "timestamp": 1767225600000,
      }
    `);
  });

  it("limits both bursts and admission rate, then resumes without a timer", async () => {
    Array.from({ length: 100 }, () => api.record("error", new Error("private")));
    await settle();
    const first = await report();
    expect(first.events).toHaveLength(20);
    expect(first.droppedSinceWorkerStart).toBe(81);
    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    api.record("menu_ready");
    expect((await report()).events).toHaveLength(21);
  });

  it("clears through the same queue and preserves unrelated local data", async () => {
    data.unrelated = "keep";
    await request("record", contentSender, { event });
    expect(await request("clear")).toEqual({ ok: true });
    expect((await report()).events).toEqual([]);
    expect(data).toEqual({ unrelated: "keep" });
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(KEY);
  });

  it("reports write failure and recovers on the next event without recursive logging", async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error("unavailable"));
    api.record("error");
    await settle();
    expect((await report()).lastWriteFailed).toBe(true);
    api.record("menu_ready");
    const result = await report();
    expect(result.lastWriteFailed).toBe(false);
    expect(result.failedWritesSinceWorkerStart).toBe(1);
    expect(result.events.map((entry) => entry.kind)).toMatchInlineSnapshot(`
      [
        "worker_start",
        "menu_ready",
      ]
    `);
  });

  it("surfaces export and clear storage failures as typed retry-safe errors", async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error("unavailable"));
    expect(await request("export")).toMatchInlineSnapshot(`
      {
        "error": "diagnostics_storage_unavailable",
        "ok": false,
        "retrySafe": true,
      }
    `);
    chrome.storage.local.remove.mockRejectedValueOnce(new Error("unavailable"));
    expect(await request("clear")).toMatchInlineSnapshot(`
      {
        "error": "diagnostics_storage_unavailable",
        "ok": false,
        "retrySafe": true,
      }
    `);
    expect((await report()).events).toHaveLength(1);
  });

  it.each([
    null,
    {},
    { kind: "unknown", name: null, frames: [] },
    { ...event, name: "private" },
    { ...event, frames: ["https://example.com/private"] },
    { ...event, frames: Array(9).fill("background.js:1:1") },
  ])("rejects malformed record atomically: %j", async (invalid) => {
    const writes = chrome.storage.local.set.mock.calls.length;
    expect(await request("record", contentSender, { event: invalid })).toBeUndefined();
    expect((await report()).events).toHaveLength(1);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(writes);
  });

  it.each([
    { ...optionsSender, id: "other" },
    { ...optionsSender, url: "https://example.com/" },
    { ...optionsSender, url: `${ROOT}pages/options/options.html?spoof=1` },
    contentSender,
  ])("rejects export and clear from unauthorized sender: %j", async (sender) => {
    expect(await request("export", sender)).toBeUndefined();
    expect(await request("clear", sender)).toBeUndefined();
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect((await report()).events).toHaveLength(1);
  });

  it.each([
    "https://www.netflix.com.evil.test/watch/1",
    "https://example.com/",
    "https://www.amazon.com/not-video/",
    "not a URL",
  ])("rejects content sender outside manifest scope: %s", async (url) => {
    await request("record", { ...contentSender, url }, { event });
    expect((await report()).events).toHaveLength(1);
  });

  it("tolerates corrupted storage without exporting injected content", async () => {
    data[KEY] = [
      { ...event, context: "foreign", timestamp: 1 },
      { ...event, context: "content", timestamp: -1 },
      null,
    ];
    expect((await report()).events).toEqual([]);
    data[KEY] = { private: "discard" };
    expect((await report()).events).toEqual([]);
  });
});

describe("content-world hooks", () => {
  beforeEach(async () => {
    vi.resetModules();
    await import("../src/helpers/diagnostics.js");
    api = globalThis.SkippyDiagnostics;
    api.init("content");
    await settle();
    chrome.runtime.sendMessage.mockClear();
  });

  it("ignores page/foreign errors and captures only own extension frames", async () => {
    hooks.error({ filename: "https://example.com/app.js", lineno: 1, colno: 2 });
    hooks.unhandledrejection({ reason: "page rejection" });
    hooks.error({
      error: { name: "TypeError", stack: "at chrome-extension://other/content/script.js:1:1" },
    });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    hooks.error({ filename: `${ROOT}content/skippy-netflix.js`, lineno: 12, colno: 3 });
    hooks.unhandledrejection({
      reason: { name: "RangeError", stack: `at ${ROOT}content/skippy-core.js:90:4` },
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "SKIPPY_DIAGNOSTICS",
      action: "record",
      event: { kind: "error", name: "Error", frames: ["content/skippy-netflix.js:12:3"] },
    });
    expect((await report()).events.map((entry) => entry.kind)).toMatchInlineSnapshot(`
      [
        "worker_start",
        "content_start",
        "error",
        "unhandled_rejection",
      ]
    `);
  });

  it("bounds messages during a persistent adapter failure", () => {
    Array.from({ length: 100 }, () => api.record("adapter_error", new Error("private")));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(19);
  });

  it("reports safely after runtime URL APIs become invalidated", async () => {
    const getURL = vi.spyOn(chrome.runtime, "getURL").mockImplementation(() => {
      throw new Error("context invalidated");
    });
    chrome.runtime.sendMessage.mockImplementationOnce(() => {
      throw new Error("context invalidated");
    });
    const error = { name: "TypeError", stack: `at ${ROOT}content/skippy-core.js:90:4` };
    api.record("adapter_error", error);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "SKIPPY_DIAGNOSTICS",
      action: "record",
      event: { kind: "adapter_error", name: "TypeError", frames: ["content/skippy-core.js:90:4"] },
    });
    getURL.mockRestore();
    expect((await report()).events.map((entry) => entry.kind)).toMatchInlineSnapshot(`
      [
        "worker_start",
        "content_start",
      ]
    `);
  });

  it("does not retry or create unhandled rejections when the worker is unavailable", async () => {
    chrome.runtime.sendMessage.mockRejectedValueOnce(new Error("worker unavailable"));
    api.record("settings_error");
    await settle();
    chrome.runtime.sendMessage.mockImplementationOnce(() => {
      throw new Error("context invalidated");
    });
    api.record("adapter_error");
    await settle();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect((await report()).events.map((entry) => entry.kind)).toMatchInlineSnapshot(`
      [
        "worker_start",
        "content_start",
      ]
    `);
  });
});
