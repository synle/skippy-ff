# Development guide

How to work on Skippy locally. Read alongside `ARCHITECTURE.md` (system map) and `CLAUDE.md` (project rules).

## Prereqs

- Node 20.19.1 (pinned via Volta — `volta install` if missing).
- Chrome with Developer mode enabled.

## First-time setup

```bash
npm install
npm run build      # produces dist/
```

Then in Chrome:

1. `chrome://extensions/`
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**, select the `dist/` folder.
4. Pin Skippy to the toolbar (puzzle icon → pin) for one-click access to settings.

## Day-to-day loop

```bash
npm run dev        # watch mode — rebuilds dist/ on src/ change
```

Chrome MV3 does not hot-reload content scripts. After every `src/` change:

1. Wait for the Vite watcher to log a rebuild.
2. `chrome://extensions/` → click the **reload** (circular arrow) on the Skippy card.
3. Hard-reload the streaming-site tab you're testing on (Cmd-Shift-R / Ctrl-Shift-R).

The manifest's `name` is suffixed with `(DEV)` in watch mode so you can tell which build is loaded.

## Useful npm scripts

| Command                 | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `npm run dev`           | Vite watch build → `dist/`                                   |
| `npm run build`         | One-off production build (also runs `tsc` for type checking) |
| `npm run bundle`        | Zip `dist/` → `skippy-ff.zip` (the release artifact)         |
| `npm run package`       | `build` + `bundle`                                           |
| `npm run test`          | Vitest run                                                   |
| `npm run test:coverage` | Vitest with coverage thresholds (see `vite.config.js`)       |
| `npm run lint`          | ESLint over `src/`                                           |
| `npm run format`        | Prettier (140 char width) on the whole tree                  |
| `npm run validate`      | `test + lint + build + format` — run before every commit     |

## Adding a new streaming site

Three touches + one shared list. See `ARCHITECTURE.md` § Build pipeline for the why.

1. **Adapter** — create `src/content/skippy-<site>.js`. End with `SkippyCore.skippyStart(adapter)`. The adapter signature is `(settings) => HTMLElement | null` and should resolve the effective flags via `SkippyStorage.getEffectiveSiteSettings(settings, "<host>")` at the top. Refer to `skippy-appletv.js` for the multi-strategy template (testid → class → text), `skippy-disneyplus.js` for shadow-DOM traversal, `skippy-crunchyroll.js` for the simple `aria-label` case, `skippy-netflix.js` for the forgiving `data-uia` substring + normalized case-insensitive text fallback, `skippy-primevideo.js` for the class-substring + multi-text-label variant (Amazon's `atvwebplayersdk-*` prefix + Skip Intro / Skip intro casing variance).
2. **Manifest** — add a `content_scripts` entry in `src/manifest.json` with the site's host patterns under `matches`, and list `helpers/storage.js`, `content/skippy-core.js`, then your new adapter under `js` (order matters: globals before consumers).
3. **Build plugin** — add a `copyFileSync` line in `vite.config.js`'s `skippy-copy-manifest` plugin for the new content script. Content scripts are **not** Vite inputs — they're copied verbatim because MV3 content scripts can't be ES modules.
4. **Centralized site list** — append a `{ host, label, urlPatterns }` entry to `SKIPPY_SITES` in `src/helpers/storage.js` and add the host to `SKIPPY_DEFAULTS.enabledSites` with `true`. The `urlPatterns` array must mirror the manifest `matches`. Both the options-page site cards and the background service worker's context menu are generated from this list — no extra UI wiring.

After: `npm run validate`, reload the extension in Chrome, and test on the live site.

## Right-click context menu

A background service worker (`src/background.js`) registers a **Skippy** submenu on every right-click for supported streaming pages. Items are generated per-site from `SKIPPY_SITES` and reflect the live `getEffectiveSiteSettings` resolution:

- **Enable on `<Site>`** — toggles `enabledSites[host]`.
- **Follow master settings** — inverse of `siteOverrides[host].useOverride`.
- **Skip Intro / Skip Recap / Skip Credits / Auto start next episode** — toggling any flag flips `useOverride` true on the site (same behavior as the options page card).
- **Open Skippy settings…** — calls `chrome.runtime.openOptionsPage()`.

When the site is disabled, the four flag rows and "Follow master settings" are hidden; only Enable + Open settings remain.

The menu is rebuilt from scratch on `onInstalled`, `onStartup`, and every `chrome.storage.onChanged.sync` event — `chrome.contextMenus` is append-only, so `removeAll` + recreate is the simplest way to keep checkboxes in sync after a settings save from any surface (popup, options page, another tab's menu).

To debug context-menu issues, inspect the service worker: `chrome://extensions/` → Skippy → **Inspect views: service worker**. `[Skippy] context menu …` warnings land in that console.

## Debugging

### Verbose logging

The extension is silent by default. To see scan + click diagnostics:

1. Open the options page → **Debugging** → check **Verbose logging**.
2. Hard-reload the streaming-site tab.
3. Open DevTools → Console, filter on `[Skippy]` (or `[Skippy/<site>]`).

What you'll see:

- `[Skippy/<site>] adapter loaded on …` — confirms the content script ran in that frame.
- `[Skippy] polling started …` — confirms the poll loop is alive.
- `[Skippy] loaded settings …` — confirms storage hydration.
- Per-adapter `scan: …` lines — what selectors matched, candidate counts, visibility decisions.
- `[Skippy] clicking <label> <element>` — always emitted, regardless of verbose flag. This is the load-bearing signal that Skippy actually fired.

### `__skippy()` inspector

Each adapter installs a `__skippy()` function on the page's `window`. Paste it in the Console to dump current state — visible candidates, rects, shadow-root presence. Works regardless of the verbose-logging setting; useful for one-off probes without committing to the noisy stream.

### "Skip button is on screen but Skippy doesn't fire"

Walk this list:

1. **Is the adapter loaded?** Search Console for `[Skippy/<site>] adapter loaded`. Missing → the page is on a host the `matches` pattern doesn't cover. Check `src/manifest.json`.
2. **Did the poll loop start?** Search for `[Skippy] polling started`. Missing → storage helper failed to load. Inspect `helpers/storage.js`.
3. **Are scan candidates found?** With verbose on, look at the adapter's `scan: …` line. `0` means selectors don't match — DOM has drifted, update the adapter.
4. **Is the candidate considered visible?** Adapter logs `visible=true/false`. If `false`, walk the eight-gate ladder in `skippy-core.js` (`skippyIsVisible`) — typical culprits are an ancestor with `aria-hidden="true"` or `inert`, `opacity:0` idle-fade, or a zero-rect from `transform: scale(0)` / `clip-path`. Paste the standalone probe snippet from the Console (see `__skippy()` in each adapter, or any of the `probeByAriaLabel` patterns) to see which specific gate is failing. The permissive `skippyIsPresent` fallback drops the opacity + pointer-events gates but still rejects aria-hidden / inert — author-intent signals never get bypassed.
5. **Click fires but nothing happens?** Watch for `[Skippy] click via …` lines. Multi-strategy click should land on the real handler; if not, the button may be inside a closed shadow root — manual `__skippy()` inspection will confirm.

### Manually triggering events

The streaming sites only render skip buttons at specific moments (intro, recap, credits). For deterministic testing, scrub the player to ~5 seconds before the event. End-credits buttons often appear in the last 90 seconds of an episode.

## Tests

```bash
npm test               # one-shot
npm run test:coverage  # with coverage gate (thresholds in vite.config.js)
```

Tests live in `tests/`. Chrome APIs are mocked via `tests/_chromeMock.js` and `vi.stubGlobal("chrome", chrome)`. The mock implements the slice of `chrome.storage` and `chrome.storage.onChanged` that `helpers/storage.js` actually uses.

Adapter logic (DOM selectors, visibility) is tested manually in the browser. Pinning each streaming site's DOM in fixtures isn't worth the maintenance — they change too often.

## Release

Release is dispatched manually after a merge to `main`:

```bash
gh workflow run release-official --repo synle/skippy-ff --ref main
```

The workflow bumps `npm version minor`, drafts a release, runs `npm run package`, commits the bump back to main, and publishes the release with `skippy-ff.zip` attached. Beta uses `release-beta.yml`. See `ARCHITECTURE.md` § CI/CD.

For local one-off bundling without dispatching a release:

```bash
npm run package        # produces skippy-ff.zip in repo root
```
