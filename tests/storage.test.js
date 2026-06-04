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
});
