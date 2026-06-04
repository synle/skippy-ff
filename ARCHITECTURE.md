# Architecture

System map for Skippy. Read alongside `DEV.md` (development workflow) and `CLAUDE.md` (project-specific rules).

## High-level

Skippy is a Chrome Extension (Manifest V3) that auto-clicks "Skip Intro / Recap / Credits" buttons on streaming services. There is no background service worker — each supported site loads a content script that polls the DOM for a visible skip button and clicks it. Settings live in `chrome.storage.sync`. The options page is the only UI surface (also used as the action popup).

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
```

## Components

### `src/helpers/storage.js`

Single source of truth for settings. Wraps `chrome.storage.sync` with a defaults merge so callers never have to handle "first run" branches. Exposes `globalThis.SkippyStorage` because both content scripts (loaded as classic scripts) and the options page (loaded as an ES module) need it. The options page additionally `import`s it for side-effect global initialization.

**Settings shape** (`SKIPPY_DEFAULTS`):

| Key              | Type                   | Default | Purpose                                                                                                  |
| ---------------- | ---------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `skipIntro`      | `boolean`              | `true`  | Click "Skip Intro" / equivalent when visible                                                             |
| `skipRecap`      | `boolean`              | `true`  | Click "Skip Recap" / equivalent when visible                                                             |
| `skipCredits`    | `boolean`              | `true`  | Click "Skip Credits" / "Next Episode" / equivalent when visible                                          |
| `verboseLogging` | `boolean`              | `false` | When on, content scripts emit diagnostic logs to the DevTools console                                    |
| `pollIntervalMs` | `number`               | `500`   | Page-scan cadence in ms; clamped to `[SKIPPY_POLL_MIN_MS=100, SKIPPY_POLL_MAX_MS=5000]` at save and read |
| `enabledSites`   | `Record<string, bool>` | all on  | Per-site enable toggle keyed by site hostname                                                            |

### `src/content/skippy-core.js`

Site-agnostic primitives. **Classic script** (MV3 content scripts can't be ES modules) that attaches helpers to `globalThis.SkippyCore`.

- **Visibility gating** — `skippyIsVisible` (strict: rect > 0, opacity ≥ 0.5, pointer-events ≠ "none") and `skippyIsPresent` (permissive: rect > 0, not display:none / visibility:hidden — used when a site fades skip buttons while keeping their click handler wired).
- **Click dispatch** — `skippyClick` handles four cases: direct click target (`<button>`, `<a>`, `[role="button"]`), open shadow root with inner button, hit-test fallback via `document.elementFromPoint`, and a last-resort composed MouseEvent. Composed events are required so listeners inside enclosing shadow roots fire.
- **Polling loop** — `skippyStart(adapter, options?)` uses a `setTimeout` re-arm pattern so it can read `settings.pollIntervalMs` on every tick — a slider change in the options page takes effect on the next iteration without a restart. The interval is clamped via `SkippyStorage.clampPollIntervalMs` as a defensive fallback. Each click has a per-element cooldown (default 2000 ms) so a still-mounted button isn't re-clicked while the site advances. Settings are loaded once + re-loaded on `chrome.storage.onChanged`.
- **Verbose logging** — `skippyLog` and `skippyDLog` (throttled) gate all diagnostic output behind `settings.verboseLogging`. The single "[Skippy] clicking …" line is exempt so users can confirm a skip fired without enabling the full verbose stream.

### `src/content/skippy-<site>.js` — site adapters

One adapter per streaming service. Each one:

1. Receives current settings from the polling loop.
2. Returns a visible `HTMLElement` to click, or `null`.
3. Ends with `SkippyCore.skippyStart(adapterFn)`.

Adapter strategies trend from strict (per-site `aria-label` exact match on Crunchyroll) to multi-strategy with shadow-DOM traversal (Disney+, Apple TV). The latter is necessary when a site:

- Renders skip UI behind open shadow roots (Disney+ `<disney-web-player-ui>`).
- Uses unstable class names (Svelte hash churn on Apple TV — primary selector is `data-testid`; class + text are fallbacks).
- Embeds the player in a same-origin iframe (Apple TV — manifest entry uses `all_frames: true`).

Adapters expose a `__skippy()` console inspector for manual debugging from DevTools, regardless of the verbose-logging setting.

### `src/pages/options/`

Single-page settings UI. Vite is the bundler — `options.html` is the only HTML input. `options.js` is an ES module that `import`s `helpers/storage.js` for side-effect global init, then binds checkboxes to storage via `SkippyStorage`. The same page is reused as the action popup.

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

1. **`skippy-copy-manifest`** — Reads `src/manifest.json`, rewrites `version` from `package.json` (and appends `(DEV)` to the name in `--watch` mode), writes to `dist/manifest.json`. Also `copyFileSync`s every content script and `helpers/storage.js` verbatim into `dist/content/` and `dist/helpers/` — these are not Vite inputs.
2. **`skippy-move-html`** — Vite emits HTML into `dist/src/pages/…`. This plugin moves them to `dist/pages/…` and rewrites root-style asset paths (`/chunks/…`, `/assets/…`) to relative so they resolve under `chrome-extension://`.

`publicDir: "public"` — icons land at `dist/` root, matching paths in `manifest.json`'s `icons` field.

**Adding a new content script** is a 4-file change: `src/content/skippy-<site>.js`, a `copyFileSync` in `vite.config.js`, a `content_scripts` entry in `src/manifest.json`, and an options-page checkbox row.

## Testing

Vitest + jsdom. Chrome APIs are mocked via `tests/_chromeMock.js` + `vi.stubGlobal("chrome", chrome)`. Tests focus on `SkippyStorage` (defaults, merge semantics, change subscriptions). DOM-level adapter behavior is tested manually in the browser — automated coverage there would require fixtures of each site's actual DOM, which churns too fast to be worth pinning.

## CI/CD

- **`build-main.yml`** — runs on push/PR to main/master. Jobs: `test` (lint + vitest, dedicated signal), `build` (reusable `synle/workflows`), `coverage` (vitest with threshold gate), `pr-artifacts` (build + upload `skippy-ff.zip` as PR artifact).
- **`release-official.yml`** — manual `workflow_dispatch`. Bumps `npm version minor`, drafts a GitHub release, runs `npm run package`, commits the bump, finalizes the release with `skippy-ff.zip` attached.
- **`release-beta.yml`** — beta channel, off the same skeleton.

Tag derivation goes through `synle/workflows/.../resolve-tag` (no `github.ref_name` fallback) — safe to dispatch on `--ref main`.
