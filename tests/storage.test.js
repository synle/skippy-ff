/** Tests for the SkippyStorage helper — defaults, merge semantics, change subscriptions. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChromeMock } from "./_chromeMock.js";

const { chrome, reset } = createChromeMock();
vi.stubGlobal("chrome", chrome);

// Importing for side effect — storage.js attaches helpers to globalThis.
await import("../src/helpers/storage.js");

const {
  getSkippySettings,
  saveSkippySettings,
  onSkippySettingsChanged,
  clampPollIntervalMs,
  getEffectiveSiteSettings,
  SKIPPY_DEFAULTS,
  SKIPPY_SITE_OVERRIDE_DEFAULTS,
  SKIPPY_FLAG_KEYS,
  SKIPPY_SITES,
  SKIPPY_POLL_MIN_MS,
  SKIPPY_POLL_MAX_MS,
} = globalThis.SkippyStorage;

describe("SkippyStorage", () => {
  beforeEach(() => {
    reset();
  });

  it("returns defaults when storage is empty", async () => {
    const settings = await getSkippySettings();
    expect(settings).toEqual(SKIPPY_DEFAULTS);
  });

  it("merges saved partial over defaults", async () => {
    await saveSkippySettings({ skipIntro: false });
    const settings = await getSkippySettings();
    expect(settings.skipIntro).toBe(false);
    expect(settings.skipRecap).toBe(true);
    expect(settings.skipCredits).toBe(true);
  });

  it("merges per-site overrides without dropping defaults", async () => {
    await saveSkippySettings({ enabledSites: { "crunchyroll.com": false } });
    const settings = await getSkippySettings();
    expect(settings.enabledSites["crunchyroll.com"]).toBe(false);
  });

  it("preserves existing fields when saving a different one", async () => {
    await saveSkippySettings({ skipIntro: false });
    await saveSkippySettings({ skipCredits: false });
    const settings = await getSkippySettings();
    expect(settings.skipIntro).toBe(false);
    expect(settings.skipCredits).toBe(false);
    expect(settings.skipRecap).toBe(true);
  });

  it("defaults verboseLogging to false (opt-in)", async () => {
    const settings = await getSkippySettings();
    expect(settings.verboseLogging).toBe(false);
  });

  it("defaults nextEpisode to true so end-of-episode autoplay clicks continue working", async () => {
    const settings = await getSkippySettings();
    expect(settings.nextEpisode).toBe(true);
  });

  it("persists nextEpisode independently of skipCredits", async () => {
    await saveSkippySettings({ nextEpisode: false });
    const settings = await getSkippySettings();
    expect(settings.nextEpisode).toBe(false);
    expect(settings.skipCredits).toBe(true);
  });

  it("defaults pollIntervalMs to 500", async () => {
    const settings = await getSkippySettings();
    expect(settings.pollIntervalMs).toBe(500);
  });

  it("clamps pollIntervalMs above the ceiling on save", async () => {
    await saveSkippySettings({ pollIntervalMs: 999_999 });
    const settings = await getSkippySettings();
    expect(settings.pollIntervalMs).toBe(SKIPPY_POLL_MAX_MS);
  });

  it("clamps pollIntervalMs below the floor on save", async () => {
    await saveSkippySettings({ pollIntervalMs: 0 });
    const settings = await getSkippySettings();
    expect(settings.pollIntervalMs).toBe(SKIPPY_POLL_MIN_MS);
  });

  it("coerces a non-numeric pollIntervalMs back to the default", async () => {
    await saveSkippySettings({ pollIntervalMs: "not a number" });
    const settings = await getSkippySettings();
    expect(settings.pollIntervalMs).toBe(SKIPPY_DEFAULTS.pollIntervalMs);
  });

  it("clampPollIntervalMs handles numeric strings", () => {
    expect(clampPollIntervalMs("750")).toBe(750);
    expect(clampPollIntervalMs("60")).toBe(SKIPPY_POLL_MIN_MS);
    expect(clampPollIntervalMs("999999")).toBe(SKIPPY_POLL_MAX_MS);
  });

  it("notifies subscribers when settings change", async () => {
    const cb = vi.fn();
    onSkippySettingsChanged(cb);
    await saveSkippySettings({ skipIntro: false });
    // Subscriber resolves async via getSkippySettings; wait a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].skipIntro).toBe(false);
  });

  // --- Default-shape regressions -------------------------------------------------------

  it("ships skip flags on by default — protects against accidental opt-in regression", () => {
    expect(SKIPPY_DEFAULTS.skipIntro).toBe(true);
    expect(SKIPPY_DEFAULTS.skipRecap).toBe(true);
    expect(SKIPPY_DEFAULTS.skipCredits).toBe(true);
  });

  it("enables every supported site by default", () => {
    expect(SKIPPY_DEFAULTS.enabledSites["crunchyroll.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["disneyplus.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["tv.apple.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["netflix.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["primevideo.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["max.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["paramountplus.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["peacocktv.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["tubitv.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["amcplus.com"]).toBe(true);
    expect(SKIPPY_DEFAULTS.enabledSites["shudder.com"]).toBe(true);
  });

  it("does not leak mutations to SKIPPY_DEFAULTS across reads", async () => {
    const first = await getSkippySettings();
    first.skipIntro = false;
    first.enabledSites["crunchyroll.com"] = false;
    const second = await getSkippySettings();
    expect(second.skipIntro).toBe(true);
    expect(second.enabledSites["crunchyroll.com"]).toBe(true);
  });

  // --- pollIntervalMs clamp boundary regressions --------------------------------------

  it("accepts pollIntervalMs at the lower boundary", () => {
    expect(clampPollIntervalMs(SKIPPY_POLL_MIN_MS)).toBe(SKIPPY_POLL_MIN_MS);
  });

  it("accepts pollIntervalMs at the upper boundary", () => {
    expect(clampPollIntervalMs(SKIPPY_POLL_MAX_MS)).toBe(SKIPPY_POLL_MAX_MS);
  });

  it("clamps negative numbers up to the floor", () => {
    expect(clampPollIntervalMs(-1)).toBe(SKIPPY_POLL_MIN_MS);
    expect(clampPollIntervalMs(-999_999)).toBe(SKIPPY_POLL_MIN_MS);
  });

  it("falls back to the default for Infinity / NaN — Number.isFinite guard", () => {
    expect(clampPollIntervalMs(Number.POSITIVE_INFINITY)).toBe(SKIPPY_DEFAULTS.pollIntervalMs);
    expect(clampPollIntervalMs(Number.NEGATIVE_INFINITY)).toBe(SKIPPY_DEFAULTS.pollIntervalMs);
    expect(clampPollIntervalMs(Number.NaN)).toBe(SKIPPY_DEFAULTS.pollIntervalMs);
  });

  it("rounds non-integer values via Math.round", () => {
    expect(clampPollIntervalMs(750.4)).toBe(750);
    expect(clampPollIntervalMs(750.7)).toBe(751);
  });

  // --- enabledSites merge semantics ---------------------------------------------------

  it("preserves untouched sites when toggling one site", async () => {
    await saveSkippySettings({ enabledSites: { "tv.apple.com": false } });
    const settings = await getSkippySettings();
    expect(settings.enabledSites["tv.apple.com"]).toBe(false);
    expect(settings.enabledSites["crunchyroll.com"]).toBe(true);
    expect(settings.enabledSites["disneyplus.com"]).toBe(true);
  });

  it("retains user-added site keys not present in defaults — future-site forward-compat", async () => {
    await saveSkippySettings({ enabledSites: { "netflix.com": true } });
    const settings = await getSkippySettings();
    expect(settings.enabledSites["netflix.com"]).toBe(true);
    expect(settings.enabledSites["crunchyroll.com"]).toBe(true);
  });

  // --- nextEpisode persistence regressions --------------------------------------------

  it("persists nextEpisode + skipIntro independently across saves", async () => {
    await saveSkippySettings({ nextEpisode: false });
    await saveSkippySettings({ skipIntro: false });
    const settings = await getSkippySettings();
    expect(settings.nextEpisode).toBe(false);
    expect(settings.skipIntro).toBe(false);
    expect(settings.skipCredits).toBe(true);
  });

  // --- siteOverrides shape + persistence ----------------------------------------------

  it("defaults siteOverrides to an empty object — every site follows master out of the box", () => {
    expect(SKIPPY_DEFAULTS.siteOverrides).toEqual({});
  });

  it("ships SKIPPY_SITE_OVERRIDE_DEFAULTS with useOverride=false and every flag on", () => {
    expect(SKIPPY_SITE_OVERRIDE_DEFAULTS).toEqual({
      useOverride: false,
      skipIntro: true,
      skipRecap: true,
      skipCredits: true,
      nextEpisode: true,
    });
  });

  it("exposes the canonical flag-key list — drives master + per-site iteration", () => {
    expect(SKIPPY_FLAG_KEYS).toEqual(["skipIntro", "skipRecap", "skipCredits", "nextEpisode"]);
  });

  // --- SKIPPY_SITES canonical site list ----------------------------------------------

  it("exposes a SKIPPY_SITES entry for every supported host in enabledSites defaults", () => {
    const siteHosts = SKIPPY_SITES.map((s) => s.host).sort();
    const enabledHosts = Object.keys(SKIPPY_DEFAULTS.enabledSites).sort();
    expect(siteHosts).toEqual(enabledHosts);
  });

  it("requires every SKIPPY_SITES entry to have host, label, and at least one urlPattern", () => {
    for (const site of SKIPPY_SITES) {
      expect(typeof site.host).toBe("string");
      expect(site.host.length).toBeGreaterThan(0);
      expect(typeof site.label).toBe("string");
      expect(site.label.length).toBeGreaterThan(0);
      expect(Array.isArray(site.urlPatterns)).toBe(true);
      expect(site.urlPatterns.length).toBeGreaterThan(0);
      for (const pattern of site.urlPatterns) {
        // Chrome match-pattern minimum: scheme://host/path. Reject obvious typos like a
        // missing trailing /* (would only match the bare root) or a missing scheme.
        expect(pattern).toMatch(/^https?:\/\/[^/]+\/.*$/);
      }
    }
  });

  it("persists a per-site override record and merges defaults over partial saves", async () => {
    await saveSkippySettings({
      siteOverrides: {
        "crunchyroll.com": { useOverride: true, skipIntro: false },
      },
    });
    const settings = await getSkippySettings();
    // Saved fields stick.
    expect(settings.siteOverrides["crunchyroll.com"].useOverride).toBe(true);
    expect(settings.siteOverrides["crunchyroll.com"].skipIntro).toBe(false);
    // Unspecified flag fields backfill from SKIPPY_SITE_OVERRIDE_DEFAULTS so a partial
    // record doesn't read back with `undefined` flags.
    expect(settings.siteOverrides["crunchyroll.com"].skipRecap).toBe(true);
    expect(settings.siteOverrides["crunchyroll.com"].skipCredits).toBe(true);
    expect(settings.siteOverrides["crunchyroll.com"].nextEpisode).toBe(true);
  });

  // --- getEffectiveSiteSettings — the per-site override rule --------------------------

  describe("getEffectiveSiteSettings", () => {
    it("returns master flags when site has no override record", async () => {
      const settings = await getSkippySettings();
      const eff = getEffectiveSiteSettings(settings, "crunchyroll.com");
      expect(eff).toEqual({
        enabled: true,
        skipIntro: true,
        skipRecap: true,
        skipCredits: true,
        nextEpisode: true,
        source: "master",
      });
    });

    it("propagates master flag changes to sites that follow master", async () => {
      await saveSkippySettings({ skipIntro: false, skipCredits: false });
      const settings = await getSkippySettings();
      const eff = getEffectiveSiteSettings(settings, "netflix.com");
      expect(eff.skipIntro).toBe(false);
      expect(eff.skipCredits).toBe(false);
      expect(eff.skipRecap).toBe(true);
      expect(eff.nextEpisode).toBe(true);
      expect(eff.source).toBe("master");
    });

    it("returns all-false + source=disabled when the site is toggled off — overrides ignored", async () => {
      await saveSkippySettings({
        enabledSites: { "disneyplus.com": false },
        siteOverrides: {
          "disneyplus.com": {
            useOverride: true,
            skipIntro: true,
            skipRecap: true,
            skipCredits: true,
            nextEpisode: true,
          },
        },
      });
      const settings = await getSkippySettings();
      const eff = getEffectiveSiteSettings(settings, "disneyplus.com");
      expect(eff).toEqual({
        enabled: false,
        skipIntro: false,
        skipRecap: false,
        skipCredits: false,
        nextEpisode: false,
        source: "disabled",
      });
    });

    it("returns master flags when useOverride=false even if override flags differ", async () => {
      // Edge case: a user toggled overrides on, set their own flags, then flipped
      // back to "Follow master". The override flag values stay in storage so toggling
      // back to "Use my own" re-applies the user's prior choices, but while
      // useOverride is false the master should win.
      await saveSkippySettings({
        skipIntro: true,
        siteOverrides: {
          "max.com": {
            useOverride: false,
            skipIntro: false,
            skipRecap: false,
            skipCredits: false,
            nextEpisode: false,
          },
        },
      });
      const settings = await getSkippySettings();
      const eff = getEffectiveSiteSettings(settings, "max.com");
      expect(eff.skipIntro).toBe(true);
      expect(eff.source).toBe("master");
    });

    it("uses site flags when useOverride=true — diverges from master", async () => {
      await saveSkippySettings({
        skipIntro: true,
        skipRecap: true,
        skipCredits: true,
        nextEpisode: true,
        siteOverrides: {
          "netflix.com": {
            useOverride: true,
            skipIntro: false,
            skipRecap: false,
            skipCredits: true,
            nextEpisode: false,
          },
        },
      });
      const settings = await getSkippySettings();
      const eff = getEffectiveSiteSettings(settings, "netflix.com");
      expect(eff).toEqual({
        enabled: true,
        skipIntro: false,
        skipRecap: false,
        skipCredits: true,
        nextEpisode: false,
        source: "site",
      });
    });

    it("isolates one site's override from another — master still applies to siblings", async () => {
      await saveSkippySettings({
        skipIntro: true,
        siteOverrides: {
          "crunchyroll.com": {
            useOverride: true,
            skipIntro: false,
            skipRecap: true,
            skipCredits: true,
            nextEpisode: true,
          },
        },
      });
      const settings = await getSkippySettings();
      const overridden = getEffectiveSiteSettings(settings, "crunchyroll.com");
      const follower = getEffectiveSiteSettings(settings, "netflix.com");
      expect(overridden.skipIntro).toBe(false);
      expect(overridden.source).toBe("site");
      expect(follower.skipIntro).toBe(true);
      expect(follower.source).toBe("master");
    });

    it("ignores a site override whose useOverride is missing / falsy — treats as follow-master", async () => {
      await saveSkippySettings({
        skipIntro: false,
        siteOverrides: {
          // No `useOverride` field at all — should not engage the site flags.
          "tubitv.com": { skipIntro: true },
        },
      });
      const settings = await getSkippySettings();
      const eff = getEffectiveSiteSettings(settings, "tubitv.com");
      expect(eff.skipIntro).toBe(false);
      expect(eff.source).toBe("master");
    });

    it("falls back to master defaults when settings is undefined — defensive contract", () => {
      const eff = getEffectiveSiteSettings(undefined, "crunchyroll.com");
      expect(eff.enabled).toBe(true);
      expect(eff.skipIntro).toBe(true);
      expect(eff.source).toBe("master");
    });

    it("treats a site key not listed in enabledSites as enabled — additive defaults", () => {
      // Hypothetical future site key that storage hasn't backfilled yet.
      const eff = getEffectiveSiteSettings({ skipIntro: true }, "future-site.example");
      expect(eff.enabled).toBe(true);
      expect(eff.skipIntro).toBe(true);
    });

    it("honors an explicit master skipIntro=false through the override path too (when site flag also false)", async () => {
      await saveSkippySettings({
        skipIntro: false,
        siteOverrides: {
          "netflix.com": {
            useOverride: true,
            skipIntro: false,
            skipRecap: true,
            skipCredits: true,
            nextEpisode: true,
          },
        },
      });
      const settings = await getSkippySettings();
      const eff = getEffectiveSiteSettings(settings, "netflix.com");
      expect(eff.skipIntro).toBe(false);
      expect(eff.source).toBe("site");
    });
  });
});
