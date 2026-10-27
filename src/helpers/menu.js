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

/** Escape a Chrome match-pattern literal before expanding its wildcard tokens. */
function escapeMatchPatternLiteral(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check whether a page URL matches one Chrome match pattern.
 * @param {string} pageUrl Current tab URL supplied by `contextMenus.onShown`.
 * @param {string} pattern Chrome match pattern registered for a supported site.
 * @returns {boolean} Whether the URL belongs to the pattern.
 */
function matchesChromeUrlPattern(pageUrl, pattern) {
  if (typeof pageUrl !== "string" || typeof pattern !== "string") return false;
  try {
    const expression = `^${escapeMatchPatternLiteral(pattern).replaceAll("*", ".*")}$`;
    return new RegExp(expression).test(pageUrl);
  } catch {
    return false;
  }
}

/**
 * Extract a likely title from context-menu click metadata.
 * @param {{selectionText?: string, pageUrl?: string}} info Chrome click metadata.
 * @returns {string} Trimmed selected text or the final URL path segment, or empty string.
 */
function extractTitleSearchQuery(info) {
  const selection = typeof info?.selectionText === "string" ? info.selectionText.trim() : "";
  if (selection) return selection;
  if (typeof info?.pageUrl !== "string") return "";
  try {
    const path = new URL(info.pageUrl).pathname.split("/").filter(Boolean).pop();
    return path ? decodeURIComponent(path).replace(/[-_]+/g, " ").trim() : "";
  } catch {
    return "";
  }
}

/**
 * Build a title search URL for an external catalog.
 * @param {"imdb"|"rottentomatoes"} service Search provider.
 * @param {string} query Movie or show title.
 * @returns {string} Encoded provider search URL, or empty string for an empty query.
 */
function buildTitleSearchUrl(service, query) {
  const encoded = typeof query === "string" ? query.trim() : "";
  if (!encoded) return "";
  const value = encodeURIComponent(encoded);
  const provider = globalThis.SkippyStorage?.SKIPPY_SEARCH_PROVIDERS?.find(
    (item) => item.id === service,
  );
  return provider?.urlTemplate.replace("<query>", value) || "";
}

/**
 * Build visibility updates for site branches when Chrome renders the toolbar menu.
 * Chrome applies `documentUrlPatterns` to right-click menus, but not consistently to
 * extension action menus, so branch visibility must be refreshed on every menu show.
 * @param {ReadonlyArray<{host: string, urlPatterns: ReadonlyArray<string>}>} sites Supported sites.
 * @param {unknown} pageUrl Current tab URL from Chrome.
 * @returns {Array<{id: string, visible: boolean}>} One update for each site branch.
 */
function buildSkippySiteVisibilityUpdates(sites, pageUrl) {
  return sites.map((site) => ({
    id: `${SKIPPY_MENU_ID_PREFIX}${site.host}:root`,
    visible: site.urlPatterns.some((pattern) => matchesChromeUrlPattern(pageUrl, pattern)),
  }));
}

/**
 * Build the top-level Skippy settings entries.
 * @param {ReadonlyArray<string>} urlPatterns URL patterns where Skippy is supported.
 * @param {object} settings Current settings, including enabled search providers.
 * @returns {Array<object>} Unique settings menu payloads; no side effects or raised errors.
 */
function buildSkippyRootMenuItems(urlPatterns, settings) {
  const providers = globalThis.SkippyStorage?.SKIPPY_SEARCH_PROVIDERS || [];
  const parentId = `${SKIPPY_MENU_ID_PREFIX}search`;
  return [
    {
      id: parentId,
      title: "Search Movie Information",
      contexts: ["all"],
      documentUrlPatterns: [...urlPatterns],
    },
    ...providers
      .filter((provider) => settings?.searchProviders?.[provider.id] === true)
      .map((provider) => ({
        id: `${parentId}:${provider.id}`,
        parentId,
        title: provider.label,
        contexts: ["all"],
        documentUrlPatterns: [...urlPatterns],
      })),
  ];
}

/**
 * Build the array of `chrome.contextMenus.create` payloads for one site, given current
 * merged settings. Order in the returned array is the order items are created — Chrome
 * preserves creation order in the rendered menu.
 *
 * Shape (when site enabled):
 *   ┌ Skippy <Site> Settings ▶
 *   │   ☑ Enable on <Label>
 *   │   ─────
 *   │   ☑ Follow master settings
 *   │   ☑ Skip Intro
 *   │   ☑ Skip Recap
 *   │   ☑ Skip Credits
 *   │   ☑ Auto start next episode
 *   │   ─────
 *
 * When site disabled, the four flag checkboxes + the "Follow master settings" row + both
 * separators are omitted — only Enable shows. This matches the visibility
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

  // Site settings are top-level entries so toolbar and right-click menus use the same labels.
  items.push({
    id: parentId,
    title: `Skippy ${site.label} Settings`,
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

  return items;
}

/**
 * Parse a `chrome.contextMenus.onClicked` menu item id into a structured action descriptor.
 * Pure function — handles ids built by `buildSkippyContextMenuItems`. Returns `null` for
 * unknown ids (parent rows, third-party menus) so the background worker can fall through.
 * @param {string} menuItemId Item id from `OnClickData.menuItemId`.
 * @returns {{host: string, action: "enable"|"follow"|"flag"|"search", flag?: "skipIntro"|"skipRecap"|"skipCredits"|"nextEpisode", service?: "imdb"|"rottentomatoes"|"google"} | null}
 */
function parseSkippyMenuItemId(menuItemId) {
  if (typeof menuItemId !== "string" || !menuItemId.startsWith(SKIPPY_MENU_ID_PREFIX)) return null;
  const host = "search";
  const parts = menuItemId.split(":");
  // Expected forms:
  //   skippy:search:<provider>
  // (root + separators are not clickable; they never reach this handler.)
  if (parts.length < 3) return null;
  if (parts[1] !== "search") return null;
  const service = parts[2];
  if (service === "imdb" || service === "rottentomatoes" || service === "google") {
    return { host, action: "search", service };
  }
  return null;
}

globalThis.SkippyMenu = {
  buildSkippySiteVisibilityUpdates,
  buildSkippyRootMenuItems,
  buildSkippyContextMenuItems,
  extractTitleSearchQuery,
  buildTitleSearchUrl,
  parseSkippyMenuItemId,
  SKIPPY_MENU_ID_PREFIX,
  SKIPPY_MENU_FLAG_LABELS,
};
