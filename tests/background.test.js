/** Tests for the background service worker's context-menu lifecycle — rebuild
 * serialization, per-item create error reporting, and click routing back into storage.
 * The pure menu-shape transformation lives in `menu.test.js`; do not duplicate it here. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Build a chrome mock covering every API `background.js` touches: sync storage, the
 * change listener, the three runtime/contextMenus listener registries, and the
 * `contextMenus.create` callback contract (errors arrive via `runtime.lastError`, not by
 * throwing).
 * @param {{getImpl?: () => Promise<object>, createLastError?: (payload: object) => {message: string} | undefined}} [opts] Overrides.
 * @returns {object} A mock `chrome` plus the captured listeners and spies.
 */
function createBackgroundChromeMock(opts = {}) {
  /** @type {Record<string, unknown>} */
  const storageData = {};
  /** @type {Function[]} */
  const changeListeners = [];
  const listeners = {
    /** @type {Function[]} */ installed: [],
    /** @type {Function[]} */ startup: [],
    /** @type {Function[]} */ menuClicked: [],
  };

  const removeAll = vi.fn((cb) => cb && cb());
  const create = vi.fn((payload, cb) => {
    chrome.runtime.lastError = opts.createLastError ? opts.createLastError(payload) : undefined;
    if (cb) cb();
    chrome.runtime.lastError = undefined;
  });
  const set = vi.fn(async (items) => {
    /** @type {Record<string, object>} */
    const changes = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: storageData[k], newValue: v };
      storageData[k] = v;
    }
    for (const cb of changeListeners) cb(changes, "sync");
  });
  const get = vi.fn(opts.getImpl || (async () => ({ ...storageData })));

  const chrome = {
    storage: {
      sync: { get, set },
      onChanged: { addListener: vi.fn((cb) => changeListeners.push(cb)) },
    },
    runtime: {
      lastError: /** @type {{message: string} | undefined} */ (undefined),
      openOptionsPage: vi.fn(),
      onInstalled: { addListener: vi.fn((cb) => listeners.installed.push(cb)) },
      onStartup: { addListener: vi.fn((cb) => listeners.startup.push(cb)) },
    },
    contextMenus: {
      removeAll,
      create,
      onClicked: { addListener: vi.fn((cb) => listeners.menuClicked.push(cb)) },
    },
  };

  return { chrome, storageData, changeListeners, listeners, removeAll, create, get, set };
}

/**
 * Load a fresh copy of `background.js` against the supplied mock. The worker keeps its
 * rebuild queue in module scope, so every test needs a clean module registry.
 * @param {object} chrome Mock chrome API.
 * @returns {Promise<void>}
 */
async function loadBackground(chrome) {
  vi.resetModules();
  vi.stubGlobal("chrome", chrome);
  // MV3 classic service worker: `importScripts` pulls the helpers into global scope. jsdom
  // has no such function, so stub it and load the helpers as modules for their side effects.
  vi.stubGlobal("importScripts", () => {});
  await import("../src/helpers/storage.js");
  await import("../src/helpers/menu.js");
  await import("../src/background.js");
}

describe("background context-menu rebuild", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps rebuilding after a failed rebuild", async () => {
    // Regression: `pendingRebuild = pendingRebuild.then(fn)` left the queue in a rejected
    // state after any failure, and `.then(onFulfilled)` on a rejected promise skips the
    // callback. One transient storage error silently froze the menu for the life of the SW.
    let getCalls = 0;
    const mock = createBackgroundChromeMock({
      getImpl: async () => {
        getCalls += 1;
        if (getCalls === 2) throw new Error("extension context invalidated");
        return {};
      },
    });
    await loadBackground(mock.chrome);

    await vi.waitFor(() => expect(mock.removeAll).toHaveBeenCalledTimes(1));
    const afterFirst = mock.create.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Rebuild #2 — fails inside the queued body.
    mock.changeListeners.forEach((cb) => cb({ skippySettings: {} }, "sync"));
    await vi.waitFor(() => expect(mock.removeAll).toHaveBeenCalledTimes(2));
    expect(mock.create.mock.calls.length).toBe(afterFirst);

    // Rebuild #3 — must still run despite #2 having rejected.
    mock.changeListeners.forEach((cb) => cb({ skippySettings: {} }, "sync"));
    await vi.waitFor(() => expect(mock.removeAll).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(mock.create.mock.calls.length).toBeGreaterThan(afterFirst));
  });

  it("creates one menu tree per supported site on the initial build", async () => {
    const mock = createBackgroundChromeMock();
    await loadBackground(mock.chrome);
    await vi.waitFor(() => expect(mock.removeAll).toHaveBeenCalledTimes(1));

    const roots = mock.create.mock.calls
      .map(([payload]) => payload.id)
      .filter((id) => id.endsWith(":root"));
    expect(roots.length).toBe(globalThis.SkippyStorage.SKIPPY_SITES.length);
  });

  it("reports a create failure surfaced through runtime.lastError", async () => {
    // `chrome.contextMenus.create` never throws — it reports asynchronously via
    // `runtime.lastError`, so the old try/catch caught nothing and Chrome logged a bare
    // "Unchecked runtime.lastError" with no item id.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mock = createBackgroundChromeMock({
      createLastError: (payload) =>
        payload.id.endsWith(":root")
          ? { message: "Cannot create item with duplicate id" }
          : undefined,
    });
    await loadBackground(mock.chrome);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());

    expect(warn).toHaveBeenCalledWith(
      "[Skippy] failed to create context menu item",
      expect.stringContaining(":root"),
      "Cannot create item with duplicate id",
    );
  });

  it("does not abort the rebuild when one item fails to create", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mock = createBackgroundChromeMock({
      createLastError: (payload) =>
        payload.id.endsWith(":enable") ? { message: "bad item" } : undefined,
    });
    await loadBackground(mock.chrome);
    await vi.waitFor(() => expect(mock.removeAll).toHaveBeenCalledTimes(1));

    const roots = mock.create.mock.calls
      .map(([payload]) => payload.id)
      .filter((id) => id.endsWith(":root"));
    expect(roots.length).toBe(globalThis.SkippyStorage.SKIPPY_SITES.length);
  });
});

describe("background context-menu click routing", () => {
  /** @type {ReturnType<typeof createBackgroundChromeMock>} */
  let mock;

  beforeEach(async () => {
    mock = createBackgroundChromeMock();
    await loadBackground(mock.chrome);
    await vi.waitFor(() => expect(mock.removeAll).toHaveBeenCalledTimes(1));
    mock.set.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Dispatch a synthetic context-menu click through the registered handler.
   * @param {string} menuItemId Item id.
   * @param {boolean} [checked] Post-toggle checkbox state Chrome reports.
   * @returns {Promise<void>}
   */
  async function click(menuItemId, checked) {
    for (const cb of mock.listeners.menuClicked) cb({ menuItemId, checked });
    await vi.waitFor(() => expect(mock.set).toHaveBeenCalled());
  }

  it("persists an enable toggle for the clicked site only", async () => {
    await click("skippy:netflix.com:enable", false);
    const saved = mock.set.mock.calls.at(-1)[0].skippySettings;
    expect(saved.enabledSites["netflix.com"]).toBe(false);
    expect(saved.enabledSites["crunchyroll.com"]).toBe(true);
  });

  it("maps 'follow master' checked to useOverride false", async () => {
    await click("skippy:max.com:follow", true);
    const saved = mock.set.mock.calls.at(-1)[0].skippySettings;
    expect(saved.siteOverrides["max.com"].useOverride).toBe(false);
  });

  it("flips useOverride true when an individual flag is toggled", async () => {
    await click("skippy:tubitv.com:flag:skipIntro", false);
    const saved = mock.set.mock.calls.at(-1)[0].skippySettings;
    expect(saved.siteOverrides["tubitv.com"]).toMatchObject({
      useOverride: true,
      skipIntro: false,
      skipRecap: true,
    });
  });

  it("opens the options page without touching storage", async () => {
    for (const cb of mock.listeners.menuClicked) cb({ menuItemId: "skippy:netflix.com:options" });
    expect(mock.chrome.runtime.openOptionsPage).toHaveBeenCalled();
    expect(mock.set).not.toHaveBeenCalled();
  });

  it("ignores menu ids from other extensions", async () => {
    for (const cb of mock.listeners.menuClicked) cb({ menuItemId: "someoneelse:thing" });
    expect(mock.set).not.toHaveBeenCalled();
    expect(mock.chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
  });
});
