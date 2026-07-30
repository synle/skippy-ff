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
 * @type {Promise<void>}
 */
let pendingRebuild = Promise.resolve();

/**
 * Rebuild every Skippy context-menu item from scratch.
 *
 * `chrome.contextMenus.create` is append-only and per-item `update` can't add or remove
 * children, so the cheapest way to reflect a settings change (enable toggle flipped,
 * override engaged, master flag changed) is to wipe and recreate the whole tree. The tree
 * is ~9 items × 11 sites = ~100 items; well within Chrome's contextMenu limits.
 *
 * Per-item failures are caught and logged, not rethrown — Chrome will reject duplicate ids
 * if a previous `removeAll` is still settling, and we don't want one stale id to take down
 * the rest of the rebuild.
 *
 * Callers are chained via `pendingRebuild` so concurrent triggers serialize into a single
 * queue rather than racing.
 * @returns {Promise<void>}
 */
function rebuildContextMenus() {
  pendingRebuild = pendingRebuild.then(async () => {
    await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
    const settings = await SkippyStorage.getSkippySettings();
    for (const site of SkippyStorage.SKIPPY_SITES) {
      const items = SkippyMenu.buildSkippyContextMenuItems(settings, site);
      for (const payload of items) {
        try {
          chrome.contextMenus.create(payload);
        } catch (err) {
          console.warn("[Skippy] failed to create context menu item", payload.id, err);
        }
      }
    }
  });
  return pendingRebuild;
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

// First build on load — Chrome may wake the SW without firing onInstalled / onStartup
// (e.g. event dispatch from a tab). Build now so the menu is always available.
rebuildContextMenus().catch((err) =>
  console.warn("[Skippy] context menu initial build failed", err),
);
