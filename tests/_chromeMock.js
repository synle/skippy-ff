/** Minimal chrome.storage + chrome.storage.onChanged mock for tests. */
import { vi } from "vitest";

/**
 * Create a fresh chrome mock with in-memory sync storage.
 * @returns {{chrome: object, storageData: Record<string, unknown>, fireChange: (changes: object) => void, reset: () => void}}
 */
export function createChromeMock() {
  /** @type {Record<string, unknown>} */
  let storageData = {};
  /** @type {Array<Function>} */
  let changeListeners = [];

  const chrome = {
    storage: {
      sync: {
        get: vi.fn(async (keys) => {
          if (typeof keys === "string") {
            return { [keys]: storageData[keys] };
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((k) => [k, storageData[k]]));
          }
          return { ...storageData };
        }),
        set: vi.fn(async (items) => {
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: storageData[k], newValue: v };
            storageData[k] = v;
          }
          changeListeners.forEach((cb) => cb(changes, "sync"));
        }),
      },
      onChanged: {
        addListener: vi.fn((cb) => {
          changeListeners.push(cb);
        }),
        removeListener: vi.fn((cb) => {
          changeListeners = changeListeners.filter((l) => l !== cb);
        }),
      },
    },
  };

  return {
    chrome,
    storageData,
    fireChange: (changes) => changeListeners.forEach((cb) => cb(changes, "sync")),
    reset: () => {
      storageData = {};
      changeListeners = [];
      chrome.storage.sync.get.mockClear();
      chrome.storage.sync.set.mockClear();
    },
  };
}
