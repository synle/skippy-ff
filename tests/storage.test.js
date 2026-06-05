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
  SKIPPY_DEFAULTS,
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
});
