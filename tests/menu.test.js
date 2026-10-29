/** Tests for the context-menu shape helper — ON/OFF/follow-master/override coverage. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChromeMock } from "./_chromeMock.js";

const { chrome, reset } = createChromeMock();
vi.stubGlobal("chrome", chrome);

// Side-effect imports — both attach to globalThis. Storage must come first; menu.js reads
// `globalThis.SkippyStorage` at call time but the assertion in its loader runs immediately.
await import("../src/helpers/storage.js");
await import("../src/helpers/menu.js");

const {
  buildSkippyContextMenuItems,
  buildSkippySiteVisibilityUpdates,
  buildSkippyRootMenuItems,
  parseSkippyMenuItemId,
  extractTitleSearchQuery,
  buildTitleSearchUrl,
  SKIPPY_MENU_PARENT_TITLE,
} = globalThis.SkippyMenu;
const { getSkippySettings, saveSkippySettings, SKIPPY_SITES } = globalThis.SkippyStorage;

const crunchyroll = SKIPPY_SITES.find((s) => s.host === "crunchyroll.com");

/** Convenience: pick checkbox items by id suffix so tests don't hard-code the full id format. */
function findItem(items, idSuffix) {
  return items.find((item) => item.id.endsWith(idSuffix));
}

describe("buildSkippyContextMenuItems", () => {
  beforeEach(() => {
    reset();
  });

  it("shape A — site enabled, follows master: shows site branch + enable(on) + follow(on) + 4 flags(on)", async () => {
    const settings = await getSkippySettings();
    const items = buildSkippyContextMenuItems(settings, crunchyroll);

    // Order matters — Chrome renders in creation order.
    expect(items).toMatchInlineSnapshot(`
      [
        {
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:root",
          "title": "Skippy Crunchyroll Settings",
        },
        {
          "checked": true,
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:enable",
          "parentId": "skippy:crunchyroll.com:root",
          "title": "Enable on Crunchyroll",
          "type": "checkbox",
        },
        {
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:sep-top",
          "parentId": "skippy:crunchyroll.com:root",
          "type": "separator",
        },
        {
          "checked": true,
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:follow",
          "parentId": "skippy:crunchyroll.com:root",
          "title": "Follow master settings",
          "type": "checkbox",
        },
        {
          "checked": true,
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:flag:skipIntro",
          "parentId": "skippy:crunchyroll.com:root",
          "title": "Skip Intro",
          "type": "checkbox",
        },
        {
          "checked": true,
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:flag:skipRecap",
          "parentId": "skippy:crunchyroll.com:root",
          "title": "Skip Recap",
          "type": "checkbox",
        },
        {
          "checked": true,
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:flag:skipCredits",
          "parentId": "skippy:crunchyroll.com:root",
          "title": "Skip Credits",
          "type": "checkbox",
        },
        {
          "checked": true,
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:flag:nextEpisode",
          "parentId": "skippy:crunchyroll.com:root",
          "title": "Auto start next episode",
          "type": "checkbox",
        },
        {
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:sep-bottom",
          "parentId": "skippy:crunchyroll.com:root",
          "type": "separator",
        },
      ]
    `);

    expect(findItem(items, ":enable").checked).toBe(true);
    expect(findItem(items, ":follow").checked).toBe(true);
    for (const flag of ["skipIntro", "skipRecap", "skipCredits", "nextEpisode"]) {
      expect(findItem(items, `:flag:${flag}`).checked).toBe(true);
    }

    // Two separators in the enabled tree.
    expect(items.filter((i) => i.type === "separator")).toHaveLength(2);
  });

  it("shape B — site disabled: only site branch + enable(off), no flags or separators", async () => {
    await saveSkippySettings({ enabledSites: { "crunchyroll.com": false } });
    const settings = await getSkippySettings();
    const items = buildSkippyContextMenuItems(settings, crunchyroll);

    expect(items).toMatchInlineSnapshot(`
      [
        {
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:root",
          "title": "Skippy Crunchyroll Settings",
        },
        {
          "checked": false,
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
            "https://beta.crunchyroll.com/*",
          ],
          "id": "skippy:crunchyroll.com:enable",
          "parentId": "skippy:crunchyroll.com:root",
          "title": "Enable on Crunchyroll",
          "type": "checkbox",
        },
      ]
    `);
    expect(findItem(items, ":enable").checked).toBe(false);
    expect(items.filter((i) => i.type === "separator")).toHaveLength(0);
    // Flag items must not be present.
    expect(items.find((i) => i.id.includes(":flag:"))).toBeUndefined();
    expect(findItem(items, ":follow")).toBeUndefined();
  });

  it("shape C — site enabled, override engaged with mixed flags: follow=off, flags reflect site values", async () => {
    await saveSkippySettings({
      siteOverrides: {
        "crunchyroll.com": {
          useOverride: true,
          skipIntro: false,
          skipRecap: true,
          skipCredits: true,
          nextEpisode: false,
        },
      },
    });
    const settings = await getSkippySettings();
    const items = buildSkippyContextMenuItems(settings, crunchyroll);

    expect(findItem(items, ":enable").checked).toBe(true);
    expect(findItem(items, ":follow").checked).toBe(false);
    expect(findItem(items, ":flag:skipIntro").checked).toBe(false);
    expect(findItem(items, ":flag:skipRecap").checked).toBe(true);
    expect(findItem(items, ":flag:skipCredits").checked).toBe(true);
    expect(findItem(items, ":flag:nextEpisode").checked).toBe(false);
  });

  it("reflects master flag changes when site follows master", async () => {
    await saveSkippySettings({ skipIntro: false, nextEpisode: false });
    const settings = await getSkippySettings();
    const items = buildSkippyContextMenuItems(settings, crunchyroll);

    expect(findItem(items, ":follow").checked).toBe(true);
    expect(findItem(items, ":flag:skipIntro").checked).toBe(false);
    expect(findItem(items, ":flag:nextEpisode").checked).toBe(false);
    expect(findItem(items, ":flag:skipRecap").checked).toBe(true);
  });

  it("scopes every item to the site's urlPatterns — context menu only appears on supported pages", async () => {
    const settings = await getSkippySettings();
    const items = buildSkippyContextMenuItems(settings, crunchyroll);
    for (const item of items) {
      expect(item.documentUrlPatterns).toEqual([...crunchyroll.urlPatterns]);
    }
  });

  it("keeps the site settings branch top-level and nests its controls", async () => {
    const settings = await getSkippySettings();
    const items = buildSkippyContextMenuItems(settings, crunchyroll);
    const parent = items[0];
    expect(parent.parentId).toBeUndefined();
    for (const child of items.slice(1)) {
      expect(child.parentId).toBe(parent.id);
    }
  });

  it("builds enabled title providers in configured order", async () => {
    const settings = await getSkippySettings();
    const items = buildSkippyRootMenuItems(["https://www.crunchyroll.com/*"], settings);
    expect(items).toMatchInlineSnapshot(`
      [
        {
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
          ],
          "id": "skippy:search",
          "title": "Search Movie Information",
        },
        {
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
          ],
          "id": "skippy:search:rottentomatoes",
          "parentId": "skippy:search",
          "title": "Rotten Tomatoes",
        },
        {
          "contexts": [
            "all",
          ],
          "documentUrlPatterns": [
            "https://www.crunchyroll.com/*",
          ],
          "id": "skippy:search:google",
          "parentId": "skippy:search",
          "title": "Google",
        },
      ]
    `);
    expect(items[1].id).toBe("skippy:search:rottentomatoes");
    expect(items[2].id).toBe("skippy:search:google");
  });

  it("uses unique ids per item — Chrome rejects duplicate ids", async () => {
    const settings = await getSkippySettings();
    const items = buildSkippyContextMenuItems(settings, crunchyroll);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("scopes ids by host — two sites' menus never collide", async () => {
    const settings = await getSkippySettings();
    const netflix = SKIPPY_SITES.find((s) => s.host === "netflix.com");
    const crItems = buildSkippyContextMenuItems(settings, crunchyroll);
    const nfItems = buildSkippyContextMenuItems(settings, netflix);
    const crIds = new Set(crItems.map((i) => i.id));
    for (const id of nfItems.map((i) => i.id)) {
      expect(crIds.has(id)).toBe(false);
    }
  });
});

describe("buildSkippySiteVisibilityUpdates", () => {
  it("matches only the site owning the current page URL", () => {
    expect(buildSkippySiteVisibilityUpdates(SKIPPY_SITES, "https://www.netflix.com/title/1"))
      .toMatchInlineSnapshot(`
      [
        {
          "id": "skippy:crunchyroll.com:root",
          "visible": false,
        },
        {
          "id": "skippy:disneyplus.com:root",
          "visible": false,
        },
        {
          "id": "skippy:tv.apple.com:root",
          "visible": false,
        },
        {
          "id": "skippy:netflix.com:root",
          "visible": true,
        },
        {
          "id": "skippy:primevideo.com:root",
          "visible": false,
        },
        {
          "id": "skippy:max.com:root",
          "visible": false,
        },
        {
          "id": "skippy:paramountplus.com:root",
          "visible": false,
        },
        {
          "id": "skippy:peacocktv.com:root",
          "visible": false,
        },
        {
          "id": "skippy:tubitv.com:root",
          "visible": false,
        },
        {
          "id": "skippy:amcplus.com:root",
          "visible": false,
        },
        {
          "id": "skippy:shudder.com:root",
          "visible": false,
        },
      ]
    `);
  });

  it("hides every site branch for unsupported URLs", () => {
    expect(
      buildSkippySiteVisibilityUpdates(SKIPPY_SITES, "https://example.com/").every(
        (update) => update.visible === false,
      ),
    ).toBe(true);
  });
});

describe("parseSkippyMenuItemId", () => {
  it("parses a title search action", () => {
    expect(parseSkippyMenuItemId("skippy:search:google")).toMatchInlineSnapshot(`
      {
        "action": "search",
        "host": "search",
        "service": "google",
      }
    `);
  });

  it("returns null for non-Skippy ids — third-party menu items pass through", () => {
    expect(parseSkippyMenuItemId("other-extension:item")).toBeNull();
    expect(parseSkippyMenuItemId("some-string")).toBeNull();
  });

  it("returns null for malformed Skippy ids — defensive against future format drift", () => {
    expect(parseSkippyMenuItemId("skippy:")).toBeNull();
    expect(parseSkippyMenuItemId("skippy:host.com")).toBeNull();
    // Flag id missing the trailing flag key.
    expect(parseSkippyMenuItemId("skippy:host.com:flag")).toBeNull();
  });

  it("returns null for non-string ids — Chrome OnClickData.menuItemId can be a number", () => {
    expect(parseSkippyMenuItemId(/** @type {any} */ (123))).toBeNull();
    expect(parseSkippyMenuItemId(/** @type {any} */ (undefined))).toBeNull();
  });
});

describe("title search helpers", () => {
  it("prefers selected text and falls back to a URL path title", () => {
    expect(extractTitleSearchQuery({ selectionText: " The Bear " })).toBe("The Bear");
    expect(extractTitleSearchQuery({ pageUrl: "https://www.netflix.com/title/my-show" })).toBe(
      "my show",
    );
  });

  it("builds encoded provider URLs from metadata", () => {
    expect(buildTitleSearchUrl("imdb", "The Bear & Me")).toBe(
      "https://www.imdb.com/find/?q=The%20Bear%20%26%20Me",
    );
    expect(buildTitleSearchUrl("rottentomatoes", "The Bear & Me")).toBe(
      "https://www.rottentomatoes.com/search?search=The%20Bear%20%26%20Me",
    );
    expect(buildTitleSearchUrl("google", "The Bear & Me")).toBe(
      "https://www.google.com/search?q=The%20Bear%20%26%20Me",
    );
    expect(buildTitleSearchUrl("imdb", "")).toBe("");
  });
});
