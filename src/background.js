/** Skippy background service worker. Builds + maintains the right-click context menu and routes clicks back into storage. */

// Classic MV3 service worker — pull in the two globals it needs. Order matters: menu.js
// reads `globalThis.SkippyStorage` at call time, but the reference itself is captured at
// load time, so storage.js must come first.
importScripts("helpers/storage.js", "helpers/menu.js");

/**
 * In-flight rebuild guard. `rebuildContextMenus` is called from multiple event sources
 * (`onInstalled`, `onStartup`, `storage.onChanged`, initial load) that can fire
 * simultaneously. Two concurrent `removeAll` + `create` sequences race and produce
 * duplicate ids. Chaining through `pendingRebuild` serializes rebuilds so only one
 * `removeAll` → create loop runs at a time.
 *
 * **Always settles fulfilled.** A rejected link poisons the whole chain: `.then(onFulfilled)`
 * on a rejected promise skips the callback and forwards the rejection, so a single failed
 * rebuild (extension context torn down mid-read, `chrome.storage.sync` unavailable) would
 * silently suppress *every* later rebuild for the life of the service worker. The rejection
 * is surfaced to the caller via a separate branch instead — see `rebuildContextMenus`.
 * @type {Promise<void>}
 */
let pendingRebuild = Promise.resolve();

/**
 * Update an existing context-menu item in place. Used as the fallback when `create`
 * fails because the id already exists (a stale item survived `removeAll`, e.g. another
 * worker instance rebuilt concurrently). `update` cannot change `id` or `type`, so both are
 * stripped from the properties passed to it.
 * @param {object} payload Create-properties object; `id` names the item to update.
 * @returns {Promise<void>} Always fulfilled; failures are logged, never thrown.
 */
function updateMenuItem(payload) {
  const { id, type, ...props } = payload;
  return new Promise((resolve) => {
    try {
      chrome.contextMenus.update(id, props, () => {
        const err = chrome.runtime.lastError;
        if (err) console.warn("[Skippy] failed to update context menu item", id, err.message);
        resolve();
      });
    } catch (err) {
      console.warn("[Skippy] context menu update threw", id, err);
      resolve();
    }
  });
}

/**
 * Show only the supported site branch matching the tab where Chrome opened the menu.
 * @param {{pageUrl?: string}} info Menu metadata supplied by Chrome.
 * @returns {void} Updates site branch visibility in place.
 */
function handleContextMenuShown(info) {
  const updates = SkippyMenu.buildSkippySiteVisibilityUpdates(
    SkippyStorage.SKIPPY_SITES,
    info?.pageUrl,
  );
  for (const update of updates) {
    chrome.contextMenus.update(update.id, { visible: update.visible }, () => {
      const err = chrome.runtime.lastError;
      if (err)
        console.warn("[Skippy] failed to update visible context menu item", update.id, err.message);
    });
  }
}

/**
 * Create one context-menu item, falling back to an in-place update when creation fails.
 *
 * `chrome.contextMenus.create` does **not** throw on failure — it reports errors
 * asynchronously through `chrome.runtime.lastError`, readable only inside the creation
 * callback. Reading it there consumes the error (no "Unchecked runtime.lastError").
 * Chrome exposes no error code, only a message, so any create failure triggers an
 * `update` attempt — for the common "duplicate id" case this converges the item to the
 * desired state; for anything else `update` fails too and is logged.
 * @param {object} payload A create-properties object from `SkippyMenu.buildSkippyContextMenuItems`.
 * @returns {Promise<void>} Resolves once Chrome has acknowledged the item. Never rejects.
 */
function createMenuItem(payload) {
  return new Promise((resolve) => {
    try {
      chrome.contextMenus.create(payload, () => {
        const err = chrome.runtime.lastError;
        if (!err) return resolve();
        console.warn("[Skippy] failed to create context menu item", payload.id, err.message);
        updateMenuItem(payload).then(resolve);
      });
    } catch (err) {
      // Synchronous throws are only possible for a malformed payload (bad `contexts` value,
      // unknown `parentId`). Log and keep going so one bad item can't abort the rebuild.
      console.warn("[Skippy] context menu create threw", payload.id, err);
      resolve();
    }
  });
}

/**
 * Rebuild every Skippy context-menu item from scratch.
 *
 * `chrome.contextMenus.create` is append-only and per-item `update` can't add or remove
 * children, so the cheapest way to reflect a settings change (enable toggle flipped,
 * override engaged, master flag changed) is to wipe and recreate the whole tree. The tree
 * has one settings row and one top-level branch per supported site.
 *
 * Per-item failures are caught and logged, not rethrown — Chrome will reject duplicate ids
 * if a previous `removeAll` is still settling, and we don't want one stale id to take down
 * the rest of the rebuild. See `createMenuItem` for why that needs a callback rather than
 * a `try/catch`.
 *
 * Callers are chained via `pendingRebuild` so concurrent triggers serialize into a single
 * queue rather than racing. The queue is deliberately kept in a fulfilled state: the
 * returned promise carries the rejection to the caller, while `pendingRebuild` swallows it
 * so the next rebuild still runs.
 * @returns {Promise<void>}
 */
function rebuildContextMenus() {
  const run = async () => {
    await new Promise((resolve) =>
      chrome.contextMenus.removeAll(() => {
        // Consume lastError so a failed wipe doesn't surface as "Unchecked runtime.lastError";
        // creates below fall back to `update` for any survivor.
        const err = chrome.runtime.lastError;
        if (err) console.warn("[Skippy] failed to clear context menu", err.message);
        resolve();
      }),
    );
    const settings = await SkippyStorage.getSkippySettings();
    const pending = [];
    const urlPatterns = SkippyStorage.SKIPPY_SITES.flatMap((site) => site.urlPatterns);
    for (const payload of SkippyMenu.buildSkippyRootMenuItems(urlPatterns)) {
      pending.push(createMenuItem(payload));
    }
    for (const site of SkippyStorage.SKIPPY_SITES) {
      const items = SkippyMenu.buildSkippyContextMenuItems(settings, site);
      for (const payload of items) pending.push(createMenuItem(payload));
    }
    // Hold the queue until Chrome acks every item, so the next rebuild's `removeAll`
    // can't interleave with this one's creates.
    await Promise.all(pending);
  };
  // `pendingRebuild.then(run, run)` — run on both settle paths so a previously failed
  // rebuild can't skip this one.
  const result = pendingRebuild.then(run, run);
  pendingRebuild = result.catch(() => {});
  return result;
}

/**
 * Handle a click on any Skippy context-menu item. Resolves the click to a action via
 * `SkippyMenu.parseSkippyMenuItemId`, then mutates settings accordingly. Toggling any flag
 * row implicitly flips `useOverride` true so the click has an observable effect (mirroring
 * the options-page card behavior).
 * @param {chrome.contextMenus.OnClickData} info Click metadata supplied by Chrome.
 * @returns {Promise<void>}
 */
async function handleContextMenuClick(info) {
  const parsed = SkippyMenu.parseSkippyMenuItemId(String(info.menuItemId));
  if (!parsed) return;

  if (parsed.action === "options") {
    chrome.runtime.openOptionsPage();
    return;
  }

  const current = await SkippyStorage.getSkippySettings();
  const existingOverride =
    current.siteOverrides[parsed.host] || SkippyStorage.SKIPPY_SITE_OVERRIDE_DEFAULTS;

  if (parsed.action === "enable") {
    await SkippyStorage.saveSkippySettings({
      enabledSites: { ...current.enabledSites, [parsed.host]: Boolean(info.checked) },
    });
    return;
  }

  if (parsed.action === "follow") {
    // "Follow master" checked → useOverride false. Inverse phrasing for the UI; flip here.
    await SkippyStorage.saveSkippySettings({
      siteOverrides: {
        ...current.siteOverrides,
        [parsed.host]: { ...existingOverride, useOverride: !info.checked },
      },
    });
    return;
  }

  if (parsed.action === "flag" && parsed.flag) {
    await SkippyStorage.saveSkippySettings({
      siteOverrides: {
        ...current.siteOverrides,
        // Touching any individual override flag implies the user wants override on —
        // otherwise the toggle would silently no-op (master would keep winning). Flip
        // useOverride true on first nudge, same as the options-page card.
        [parsed.host]: {
          ...existingOverride,
          [parsed.flag]: Boolean(info.checked),
          useOverride: true,
        },
      },
    });
    return;
  }
}

// Service worker lifecycle: rebuild on install (covers first run), on browser startup
// (Chrome wipes menus between SW restarts), and any time settings change in any tab.
chrome.runtime.onInstalled.addListener(() => {
  rebuildContextMenus().catch((err) =>
    console.warn("[Skippy] context menu install build failed", err),
  );
});

chrome.runtime.onStartup.addListener(() => {
  rebuildContextMenus().catch((err) =>
    console.warn("[Skippy] context menu startup build failed", err),
  );
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.skippySettings) return;
  rebuildContextMenus().catch((err) =>
    console.warn("[Skippy] context menu storage-change build failed", err),
  );
});

chrome.contextMenus.onClicked.addListener((info) => {
  handleContextMenuClick(info).catch((err) =>
    console.warn("[Skippy] context menu click failed", info?.menuItemId, err),
  );
});

chrome.contextMenus.onShown.addListener(handleContextMenuShown);

// First build on load — Chrome may wake the SW without firing onInstalled / onStartup
// (e.g. event dispatch from a tab). Build now so the menu is always available.
rebuildContextMenus().catch((err) =>
  console.warn("[Skippy] context menu initial build failed", err),
);
