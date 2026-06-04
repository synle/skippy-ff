# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Skippy is a Chrome Extension (Manifest V3) that auto-clicks "Skip Intro", "Skip Recap", and "Skip Credits" buttons on streaming services. The current site adapter is Crunchyroll; Netflix, Disney+, and Hulu are planned. Built with plain JavaScript + Vite 6 (no React / no framework dependencies — Skippy's UI is just a few checkboxes).

## Build & Development Commands

```bash
npm run dev          # Build to dist/ in watch mode
npm run build        # One-off production build → dist/ (also runs tsc)
npm run build:types  # Type declarations only (currently a no-op until checked files are added)
npm run bundle       # Create skippy.zip from dist/
npm run package      # build + bundle
npm run test         # Vitest run
npm run test:coverage
npm run lint         # ESLint over src/
npm run format       # Prettier (140 char width)
npm run validate     # test + lint + build + format
```

Tests use Vitest. Test files live in `tests/` at the project root. Chrome APIs are mocked via `tests/_chromeMock.js` and `vi.stubGlobal("chrome", chrome)`. Node version is pinned to 20.19.1 via Volta.

## Local Development with Chrome

1. `npm run dev` — builds to `dist/` and watches.
2. Chrome → `chrome://extensions/` → enable Developer mode → **Load unpacked** → pick `dist/`.
3. Edit source files — Vite rebuilds and you reload the extension (no built-in hot-reload for content scripts).

## Architecture

**Content scripts** (`src/content/`, copied verbatim by the `skippy-copy-manifest` Vite plugin — Chrome MV3 content scripts cannot be ES modules):

- `skippy-core.js` — Site-agnostic helpers: visibility check (`getBoundingClientRect`, computed `opacity > 0.5`, `pointer-events !== 'none'`), click dispatch, and a polling loop with per-element cooldown. Exposes `globalThis.SkippyCore.skippyStart(adapter)`.
- `skippy-crunchyroll.js` — Site adapter. Looks up `button[aria-label="Skip Intro|Recap|Credits"]`, returns first visible match. Calls `SkippyCore.skippyStart(adapter)` at the bottom.

**Shared helper** (`src/helpers/storage.js`):

- `getSkippySettings()`, `saveSkippySettings(patch)`, `onSkippySettingsChanged(cb)` — wraps `chrome.storage.sync`, merges with defaults. Exposes `globalThis.SkippyStorage` so both content scripts (classic script) and the options page (ES module import) can use it.

**Options page** (`src/pages/options/`):

- `options.html` — single Vite input, loads `options.js` as a module.
- `options.js` — `import "../../helpers/storage.js"` for side-effect global init, then binds checkboxes to storage via SkippyStorage.

**Data flow**: Options page mutates `chrome.storage.sync` → `chrome.storage.onChanged` fires → content script's `onSkippySettingsChanged` listener updates the in-memory settings used by the polling loop.

## Build System Details

`vite.config.js` has two custom plugins:

1. **`skippy-copy-manifest`** — Copies `src/manifest.json` to `dist/manifest.json` with version synced from `package.json`, and copies content scripts + storage helper verbatim into `dist/content/` and `dist/helpers/`. In `--watch` mode appends `(DEV)` to the manifest name.
2. **`skippy-move-html`** — After Vite emits HTML output under `dist/src/pages/options/`, moves files to `dist/pages/options/` and rewrites root-style asset paths to relative so they resolve under `chrome-extension://`.

`publicDir: "public"` — `public/icon-*.png` lands at `dist/` root, matching the paths declared in `manifest.json`'s `icons` field.

Content scripts are **not** Vite inputs — they're copied as-is. If adding a new content script, add a `copyFileSync` call in `vite.config.js` and register it in `src/manifest.json`.

## Adding a New Streaming Site

1. Create `src/content/skippy-<site>.js`. End with `SkippyCore.skippyStart(adapter)`. The adapter receives current settings and returns a visible button (or `null`).
2. Register in `src/manifest.json` under `content_scripts` with the appropriate `matches` host patterns. Always include `helpers/storage.js` and `content/skippy-core.js` before the adapter.
3. Add a `copyFileSync` for the new file in `vite.config.js`'s `skippy-copy-manifest` plugin.
4. Add a per-site checkbox row in `src/pages/options/options.html` with `data-site="<hostname>"`.

## Key Conventions

- ES modules in source (`"type": "module"` in `package.json`). Content scripts are classic-script wrappers around globals because MV3 content scripts aren't modules.
- Settings are stored in `chrome.storage.sync` (roam across signed-in Chrome profiles). Default everything to ON.
- `from`/`aria-label` matching is exact-string; the visibility check is the load-bearing part, not the selector.
- Polling cooldown is `2000ms` per element — long enough that the site has time to advance/hide the button, short enough that consecutive skips feel snappy.

## Git / PR Merge Policy

Squash and merge for PRs. Never merge commits or rebase merges.

## Quality Checklist

After every change:

1. **`npm run validate`** — test + lint + build + format.
2. **JSDoc on touched functions** — one-line description, params, return; update when signature changes.
3. **Update README** if behavior or scripts change.
