# Architecture

System map for Skippy. Read alongside `DEV.md` (development workflow) and `CLAUDE.md` (project-specific rules).

## High-level

Skippy is a Chrome Extension (Manifest V3) that auto-clicks "Skip Intro / Recap / Credits" buttons on streaming services. Each supported site loads a content script that polls the DOM for a visible skip button and clicks it. A background service worker registers a right-click context menu so per-site toggles are reachable without opening the options page. Settings live in `chrome.storage.sync` and are mutated from three surfaces: the options page (also used as the action popup), the context menu, and any future call site.

Hulu's catalog now streams through Disney+'s player after the catalog merger, so the Disney+ adapter covers Hulu content. There is no standalone `hulu.com` adapter.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Streaming-site tab (e.g. tv.apple.com, www.crunchyroll.com)           │
│                                                                        │
│   ┌───────────────┐    ┌────────────────┐    ┌─────────────────────┐  │
│   │ helpers/      │ →  │ content/       │ →  │ content/            │  │
│   │ storage.js    │    │ skippy-core.js │    │ skippy-<site>.js    │  │
│   │ (classic)     │    │ (classic)      │    │ (classic, adapter)  │  │
│   └───────┬───────┘    └────────┬───────┘    └─────────┬───────────┘  │
│           │  globals             │ globals              │              │
│           ▼                      ▼                      ▼              │
│           SkippyStorage          SkippyCore         (calls             │
│           (chrome.storage        (poll loop,         SkippyCore.       │
│            wrapper)               click, log)        skippyStart)      │
└────────────────────────────────────────────────────────────────────────┘
                │ chrome.storage.onChanged
                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Options page (chrome-extension://…/pages/options/options.html)        │
│                                                                        │
│   options.js  ───import──►  helpers/storage.js                         │
│   (ES module)                (side-effect global init)                 │
└────────────────────────────────────────────────────────────────────────┘
                │ chrome.storage.onChanged
                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Background service worker (background.js, classic)                    │
│                                                                        │
│   importScripts("helpers/storage.js", "helpers/menu.js")               │
│         │                                                              │
│         ▼                                                              │
│   rebuildContextMenus() → chrome.contextMenus.create(payload[])        │
│         │                                                              │
│         ▼                                                              │
│   chrome.contextMenus.onClicked → parseSkippyMenuItemId(id) →          │
│   SkippyStorage.saveSkippySettings(patch)                              │
└────────────────────────────────────────────────────────────────────────┘
```

## Components

### `src/helpers/storage.js`

Single source of truth for settings. Wraps `chrome.storage.sync` with a defaults merge so callers never have to handle "first run" branches. Exposes `globalThis.SkippyStorage` because both content scripts (loaded as classic scripts) and the options page (loaded as an ES module) need it. The options page additionally `import`s it for side-effect global initialization.

**Settings shape** (`SKIPPY_DEFAULTS`):

| Key              | Type                           | Default | Purpose                                                                                                                                                                                                                           |
| ---------------- | ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skipIntro`      | `boolean`                      | `true`  | Master: click "Skip Intro" / equivalent when visible                                                                                                                                                                              |
| `skipRecap`      | `boolean`                      | `true`  | Master: click "Skip Recap" / equivalent when visible                                                                                                                                                                              |
| `skipCredits`    | `boolean`                      | `true`  | Master: click "Skip Credits" / equivalent when visible                                                                                                                                                                            |
| `nextEpisode`    | `boolean`                      | `true`  | Master: auto-start next episode at end-of-episode chrome (separate step from `skipCredits`)                                                                                                                                       |
| `verboseLogging` | `boolean`                      | `false` | When on, content scripts emit diagnostic logs to the DevTools console                                                                                                                                                             |
| `pollIntervalMs` | `number`                       | `500`   | Page-scan cadence in ms; clamped to `[SKIPPY_POLL_MIN_MS=100, SKIPPY_POLL_MAX_MS=5000]` at save and read                                                                                                                          |
| `enabledSites`   | `Record<string, bool>`         | all on  | Per-site enable toggle keyed by site hostname                                                                                                                                                                                     |
| `siteOverrides`  | `Record<string, SiteOverride>` | `{}`    | Optional per-site override of the four skip flags. `SiteOverride = { useOverride, skipIntro, skipRecap, skipCredits, nextEpisode }`. When `useOverride=true`, that site's adapter uses the site flags instead of the master flags |

**Per-site flag resolution** is centralized in `SkippyStorage.getEffectiveSiteSettings(settings, siteKey)` so the rule lives in one place:

1. `enabledSites[siteKey] === false` → every flag returns `false`, `source = "disabled"`.
2. `siteOverrides[siteKey].useOverride === true` → returns the site's own flag values, `source = "site"`.
3. Otherwise → returns the master flag values, `source = "master"`.

Every adapter calls this helper at the top of its `findXxxSkipButton(settings)` invocation and consumes the resolved object instead of reading `settings.skipIntro` / `settings.enabledSites[host]` directly.

### `src/content/skippy-core.js`

Site-agnostic primitives. **Classic script** (MV3 content scripts can't be ES modules) that attaches helpers to `globalThis.SkippyCore`.

- **Visibility gating** — `skippyIsVisible` is the strict gate, eight fail-fast checks in order: `isConnected` → `closest('[aria-hidden="true"]')` → `closest('[inert]')` → computed `display !== "none"` → computed `visibility !== "hidden"` → `getBoundingClientRect()` > 0×0 → computed `opacity > 0` → computed `pointer-events !== "none"`. The aria-hidden + inert walks use `closest` to cover ancestor cascades in a single DOM read. The opacity gate is strictly > 0 (anything not fully transparent counts) so a button mid-fade-in starts counting as visible the moment it paints any pixels; the pointer-events gate is a tie-breaker — programmatic `.click()` bypasses it, so it only fires when paired with another gate (typically the Crunchyroll `opacity:0 + pointer-events:none` idle fade). `skippyIsPresent` is the permissive variant — same first six gates, drops opacity + pointer-events. Use it when a site fades skip buttons while keeping their click handler wired (Apple TV's chrome idle). Author-intent signals (aria-hidden + inert) are kept on in both variants.
- **Click dispatch** — `skippyClick` handles four cases: direct click target (`<button>`, `<a>`, `[role="button"]`), open shadow root with inner button, hit-test fallback via `document.elementFromPoint`, and a last-resort composed MouseEvent. Composed events are required so listeners inside enclosing shadow roots fire.
- **Polling loop** — `skippyStart(adapter, options?)` uses a `setTimeout` re-arm pattern so it can read `settings.pollIntervalMs` on every tick — a slider change in the options page takes effect on the next iteration without a restart. The interval is clamped via `SkippyStorage.clampPollIntervalMs` as a defensive fallback. Each click has a per-element cooldown (default 2000 ms) so a still-mounted button isn't re-clicked while the site advances. Settings are loaded once + re-loaded on `chrome.storage.onChanged`.
- **Verbose logging** — `skippyLog` and `skippyDLog` (throttled) gate all diagnostic output behind `settings.verboseLogging`. The single "[Skippy] clicking …" line is exempt so users can confirm a skip fired without enabling the full verbose stream.

### `src/content/skippy-<site>.js` — site adapters

One adapter per streaming service. Each one:

1. Receives current settings from the polling loop.
2. Returns a visible `HTMLElement` to click, or `null`.
3. Ends with `SkippyCore.skippyStart(adapterFn)`.

Adapter strategies trend from strict (per-site `aria-label` exact match on Crunchyroll) to multi-strategy with shadow-DOM traversal (Disney+, Apple TV) and forgiving attribute-OR-text matching (Netflix). The latter is necessary when a site:

- Renders skip UI behind open shadow roots (Disney+ `<disney-web-player-ui>`).
- Uses unstable class names (Svelte hash churn on Apple TV — primary selector is `data-testid`; class + text are fallbacks).
- Embeds the player in a same-origin iframe (Apple TV — manifest entry uses `all_frames: true`).
- Renders skip prompts as plain `<button>` elements identified by `data-uia` token (Netflix `player-skip-intro`, `player-skip-recap`, `next-episode-seamless-button`). Adapter probes the `data-uia` substring AND a normalized, case-insensitive text match in parallel so either drifting independently keeps clicks firing.
- Identifies skip prompts by a class-name substring (Prime Video's `atvwebplayersdk-skipelement-*`, `atvwebplayersdk-nextupcard-*`) with multiple text-label variants accepted in parallel ("Skip Intro" / "Skip intro" / "Next Up"). Two strategies in parallel — Amazon has reshuffled the class prefix more than once.

Adapters expose a `__skippy()` console inspector for manual debugging from DevTools, regardless of the verbose-logging setting.

### `src/pages/options/`

Single-page settings UI. Vite is the bundler — `options.html` is the only HTML input. `options.js` is an ES module that `import`s `helpers/storage.js` for side-effect global init, then renders one card per `SkippyStorage.SKIPPY_SITES` entry and binds checkboxes to storage via `SkippyStorage`. The same page is reused as the action popup.

### `src/helpers/menu.js`

Pure helper for the background service worker. `buildSkippyContextMenuItems(settings, site)` returns the array of `chrome.contextMenus.create` payloads for one site — order matters because Chrome renders in creation order. `parseSkippyMenuItemId(id)` resolves a click back to `{ host, action, flag? }`. Exposed via `globalThis.SkippyMenu`. Extracted into its own helper so the menu shape can be unit-tested without the SW runtime.

### `src/background.js`

Background service worker. Classic SW (not `type: "module"`) that `importScripts("helpers/storage.js", "helpers/menu.js")` to pick up `SkippyStorage` + `SkippyMenu`, then:

1. Rebuilds the context-menu tree on `onInstalled`, `onStartup`, and any `chrome.storage.onChanged.sync` event.
2. Routes `contextMenus.onClicked` through `parseSkippyMenuItemId` and writes the resulting patch back through `SkippyStorage.saveSkippySettings`. Toggling any flag row sets `siteOverrides[host].useOverride = true` so the user's click has an observable effect (same rule as the options-page card).
3. Opens the options page on the "Open Skippy settings…" item via `chrome.runtime.openOptionsPage()`.

The menu is per-site and scoped via each item's `documentUrlPatterns` (mirrored from `SKIPPY_SITES[*].urlPatterns`), so Chrome only surfaces the "Skippy" submenu on pages where the corresponding content script runs.

## Data flow

```
options page checkbox change
        │
        ▼
SkippyStorage.saveSkippySettings({ … })
        │
        ▼
chrome.storage.sync.set(…)
        │
        ▼
chrome.storage.onChanged fires in every tab
        │
        ▼
SkippyStorage.onSkippySettingsChanged callback
(installed by SkippyCore.skippyStart)
        │
        ▼
Re-fetch merged settings, replace closure-local `settings`,
mirror `verboseLogging` into SkippyCore via skippySetVerbose
        │
        ▼
Next poll tick uses the new settings
```

## Build pipeline

`vite.config.js` defines two custom plugins:

1. **`skippy-copy-manifest`** — Reads `src/manifest.json`, rewrites `version` from `package.json` (and appends `(DEV)` to the name in `--watch` mode), writes to `dist/manifest.json`. Also `copyFileSync`s every content script, `helpers/storage.js`, `helpers/menu.js`, and `background.js` verbatim into `dist/` — these are not Vite inputs.
2. **`skippy-move-html`** — Vite emits HTML into `dist/src/pages/…`. This plugin moves them to `dist/pages/…` and rewrites root-style asset paths (`/chunks/…`, `/assets/…`) to relative so they resolve under `chrome-extension://`.

`publicDir: "public"` — icons land at `dist/` root, matching paths in `manifest.json`'s `icons` field.

**Adding a new streaming site** touches 3 files plus `SKIPPY_SITES`: `src/content/skippy-<site>.js`, a `copyFileSync` in `vite.config.js`, a `content_scripts` entry in `src/manifest.json`, and a `{ host, label, urlPatterns }` entry in `src/helpers/storage.js`'s `SKIPPY_SITES` (also extend `SKIPPY_DEFAULTS.enabledSites`). The options-page card and the context-menu items are generated from `SKIPPY_SITES` — no further UI wiring.

## Testing

Vitest + jsdom. Chrome APIs are mocked via `tests/_chromeMock.js` + `vi.stubGlobal("chrome", chrome)`. Tests focus on `SkippyStorage` (defaults, merge semantics, change subscriptions). DOM-level adapter behavior is tested manually in the browser — automated coverage there would require fixtures of each site's actual DOM, which churns too fast to be worth pinning.

## CI/CD

- **`build-main.yml`** — runs on push/PR to main/master. Jobs: `test` (lint + vitest, dedicated signal), `build` (reusable `synle/workflows`), `coverage` (vitest with threshold gate), `pr-artifacts` (build + upload `skippy-ff.zip` as PR artifact).
- **`release-official.yml`** — manual `workflow_dispatch`. Bumps `npm version minor`, drafts a GitHub release, runs `npm run package`, commits the bump, finalizes the release with `skippy-ff.zip` attached.
- **`release-beta.yml`** — beta channel, off the same skeleton.

Tag derivation goes through `synle/workflows/.../resolve-tag` (no `github.ref_name` fallback) — safe to dispatch on `--ref main`.
