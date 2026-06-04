/** Tests for the SkippyStorage helper — defaults, merge semantics, change subscriptions. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChromeMock } from "./_chromeMock.js";

const { chrome, reset } = createChromeMock();
vi.stubGlobal("chrome", chrome);

// Importing for side effect — storage.js attaches helpers to globalThis.
await import("../src/helpers/storage.js");

const { getSkippySettings, saveSkippySettings, onSkippySettingsChanged, SKIPPY_DEFAULTS } = globalThis.SkippyStorage;

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
