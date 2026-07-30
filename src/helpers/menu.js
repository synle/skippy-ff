/** Skippy context-menu shape. Pure helper used by the background service worker (loaded via `importScripts`) and unit tests. */

/** Stable id prefix for every Skippy context-menu item. Click handler parses ids in this namespace. */
const SKIPPY_MENU_ID_PREFIX = "skippy:";

/** Human-facing labels for each per-site override flag. Same copy as the options page card. */
const SKIPPY_MENU_FLAG_LABELS = {
  skipIntro: "Skip Intro",
  skipRecap: "Skip Recap",
  skipCredits: "Skip Credits",
  nextEpisode: "Auto start next episode",
};

/** Submenu title used as the parent label for every site's context menu tree. */
const SKIPPY_MENU_PARENT_TITLE = "Skippy";

/**
 * Build the array of `chrome.contextMenus.create` payloads for one site, given current
 * merged settings. Order in the returned array is the order items are created — Chrome
 * preserves creation order in the rendered menu.
 *
 * Shape (when site enabled):
 *   ┌ Skippy ▶
 *   │   ☑ Enable on <Label>
 *   │   ─────
 *   │   ☑ Follow master settings
 *   │   ☑ Skip Intro
 *   │   ☑ Skip Recap
 *   │   ☑ Skip Credits
 *   │   ☑ Auto start next episode
 *   │   ─────
 *   │   Open Skippy settings…
 *
 * When site disabled, the four flag checkboxes + the "Follow master settings" row + both
 * separators are omitted — only Enable + Open settings… show. This matches the visibility
 * rule from the options-page site cards: nothing else is actionable until the site is on.
 *
 * Every item carries the site's `documentUrlPatterns` so Chrome only renders the menu on
 * pages where the corresponding content script actually runs.
 *
 * Why this is a pure function: the background service worker is hard to unit-test (no
 * chrome.* in jsdom). Extracting the menu-shape decision into a pure transformation lets
 * the test suite assert ON/OFF/follow-master/override combinations without faking the SW
 * runtime.
 * @param {object} settings Current merged Skippy settings (from `SkippyStorage.getSkippySettings`).
 * @param {{host: string, label: string, urlPatterns: ReadonlyArray<string>}} site Entry from `SKIPPY_SITES`.
 * @returns {Array<object>} Array of create-payload objects, in creation order.
 */
function buildSkippyContextMenuItems(settings, site) {
  const SkippyStorage =
    globalThis.SkippyStorage || /** @type {any} */ (globalThis).self?.SkippyStorage;
  if (!SkippyStorage)
    throw new Error(
      "SkippyStorage global not loaded — import helpers/storage.js before helpers/menu.js",
    );

  const effective = SkippyStorage.getEffectiveSiteSettings(settings, site.host);
  const parentId = `${SKIPPY_MENU_ID_PREFIX}${site.host}:root`;
  const urlPatterns = /** @type {string[]} */ ([...site.urlPatterns]);
  const items = [];

  // Parent submenu — title is constant so users learn the location regardless of which site they're on.
  items.push({
    id: parentId,
    title: SKIPPY_MENU_PARENT_TITLE,
    contexts: ["all"],
    documentUrlPatterns: urlPatterns,
  });

  // Enable toggle — always shown so a disabled site can be re-enabled in one click.
  items.push({
    id: `${SKIPPY_MENU_ID_PREFIX}${site.host}:enable`,
    parentId,
    title: `Enable on ${site.label}`,
    type: "checkbox",
    checked: effective.enabled,
    contexts: ["all"],
    documentUrlPatterns: urlPatterns,
  });

  if (effective.enabled) {
    items.push({
      id: `${SKIPPY_MENU_ID_PREFIX}${site.host}:sep-top`,
      parentId,
      type: "separator",
      contexts: ["all"],
      documentUrlPatterns: urlPatterns,
    });

    // Follow master = inverse of useOverride, expressed positively so the default state
    // (every site follows master) reads as "checked". Same phrasing as the options card.
    items.push({
      id: `${SKIPPY_MENU_ID_PREFIX}${site.host}:follow`,
      parentId,
      title: "Follow master settings",
      type: "checkbox",
      checked: effective.source === "master",
      contexts: ["all"],
      documentUrlPatterns: urlPatterns,
    });

    for (const flag of SkippyStorage.SKIPPY_FLAG_KEYS) {
      items.push({
        id: `${SKIPPY_MENU_ID_PREFIX}${site.host}:flag:${flag}`,
        parentId,
        title: SKIPPY_MENU_FLAG_LABELS[flag],
        type: "checkbox",
        checked: Boolean(effective[flag]),
        contexts: ["all"],
        documentUrlPatterns: urlPatterns,
      });
    }

    items.push({
      id: `${SKIPPY_MENU_ID_PREFIX}${site.host}:sep-bottom`,
      parentId,
      type: "separator",
      contexts: ["all"],
      documentUrlPatterns: urlPatterns,
    });
  }

  // Open settings — always shown so a power-user can jump from any page.
  items.push({
    id: `${SKIPPY_MENU_ID_PREFIX}${site.host}:options`,
    parentId,
    title: "Open Skippy settings…",
    contexts: ["all"],
    documentUrlPatterns: urlPatterns,
  });

  return items;
}

/**
 * Parse a `chrome.contextMenus.onClicked` menu item id into a structured action descriptor.
 * Pure function — handles ids built by `buildSkippyContextMenuItems`. Returns `null` for
 * unknown ids (parent rows, third-party menus) so the background worker can fall through.
 * @param {string} menuItemId Item id from `OnClickData.menuItemId`.
 * @returns {{host: string, action: "enable"|"follow"|"flag"|"options", flag?: "skipIntro"|"skipRecap"|"skipCredits"|"nextEpisode"} | null}
 */
function parseSkippyMenuItemId(menuItemId) {
  if (typeof menuItemId !== "string" || !menuItemId.startsWith(SKIPPY_MENU_ID_PREFIX)) return null;
  const parts = menuItemId.split(":");
  // Expected forms:
  //   skippy:<host>:enable
  //   skippy:<host>:follow
  //   skippy:<host>:flag:<flagKey>
  //   skippy:<host>:options
  // (root + separators are not clickable; they never reach this handler.)
  if (parts.length < 3) return null;
  const host = parts[1];
  const action = parts[2];
  if (action === "enable" || action === "follow" || action === "options") {
    return { host, action };
  }
  if (action === "flag" && parts.length === 4) {
    const flag = /** @type {"skipIntro"|"skipRecap"|"skipCredits"|"nextEpisode"} */ (parts[3]);
    return { host, action: "flag", flag };
  }
  return null;
}

globalThis.SkippyMenu = {
  buildSkippyContextMenuItems,
  parseSkippyMenuItemId,
  SKIPPY_MENU_ID_PREFIX,
  SKIPPY_MENU_FLAG_LABELS,
  SKIPPY_MENU_PARENT_TITLE,
};
