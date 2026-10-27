# Development guide

How to work on Skippy locally. Read alongside `ARCHITECTURE.md` (system map) and `AGENTS` (project rules).

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
| `npm run format`        | oxfmt (see `.oxfmtrc.json`) on the whole tree                |
| `npm run validate`      | `test + lint + build + format` — run before every commit     |

## Adding a new streaming site

Three touches + one shared list. See `ARCHITECTURE.md` § Build pipeline for the why.

1. **Adapter** — create `src/content/skippy-<site>.js`. End with `SkippyCore.skippyStart(adapter)`. The adapter signature is `(settings) => HTMLElement | null` and should resolve the effective flags via `SkippyStorage.getEffectiveSiteSettings(settings, "<host>")` at the top. Refer to `skippy-appletv.js` for the multi-strategy template (testid → class → text), `skippy-disneyplus.js` for shadow-DOM traversal, `skippy-crunchyroll.js` for the simple `aria-label` case, `skippy-netflix.js` for the forgiving `data-uia` substring + normalized case-insensitive text fallback, `skippy-primevideo.js` for the class-substring + multi-text-label variant (Amazon's `atvwebplayersdk-*` prefix + Skip Intro / Skip intro casing variance).
2. **Manifest** — add a `content_scripts` entry in `src/manifest.json` with the site's host patterns under `matches`, and list `helpers/diagnostics.js`, `helpers/storage.js`, `content/skippy-core.js`, then your new adapter under `js` (order matters: globals before consumers).
3. **Build plugin** — add a `copyFileSync` line in `vite.config.js`'s `skippy-copy-manifest` plugin for the new content script. Content scripts are **not** Vite inputs — they're copied verbatim because MV3 content scripts can't be ES modules.
4. **Centralized site list** — append a `{ host, label, urlPatterns }` entry to `SKIPPY_SITES` in `src/helpers/storage.js` and add the host to `SKIPPY_DEFAULTS.enabledSites` with `true`. The `urlPatterns` array must mirror the manifest `matches`. Both the options-page site cards and the background service worker's context menu are generated from this list — no extra UI wiring.

After: `npm run validate`, reload the extension in Chrome, and test on the live site.

## Right-click context menu

A background service worker (`src/background.js`) registers top-level **Skippy `<Site>` Settings** branches plus **Search Movie Information** on supported streaming pages. Site controls are nested below the matching site settings entry. Items are generated per-site from `SKIPPY_SITES` and reflect the live `getEffectiveSiteSettings` resolution:

- **Enable on `<Site>`** — toggles `enabledSites[host]`.
- **Follow master settings** — inverse of `siteOverrides[host].useOverride`.
- **Skip Intro / Skip Recap / Skip Credits / Auto start next episode** — toggling any flag flips `useOverride` true on the site (same behavior as the options page card).
- **Search Movie Information** — opens enabled Rotten Tomatoes, IMDb, or Google searches for the current title.

When the site is disabled, the four flag rows and "Follow master settings" are hidden; only Enable remains in that site's branch.

The menu is rebuilt from scratch on `onInstalled`, `onStartup`, and every `chrome.storage.onChanged.sync` event — `chrome.contextMenus` is append-only, so `removeAll` + recreate is the simplest way to keep checkboxes in sync after a settings save from any surface (popup, options page, another tab's menu). On `contextMenus.onShown`, site visibility is updated from the current tab URL, while **Search Movie Information** stays in both the right-click page menu and the toolbar menu.

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

### Persistent diagnostics and Brave/Windows crash triage

Skippy records a local-only, bounded diagnostic trail independently of verbose console logging. Open **Debugging → Export diagnostics JSON**, then copy the displayed JSON. **Clear local diagnostics** deletes only this trail, not settings. Reload the extension and streaming tabs after installing this build.

The trail retains up to 80 events in `chrome.storage.local`: error types, Skippy file/line frames, timestamps, supported site keys, and bounded counters. It excludes raw exception messages, function names, full browsing URLs, page titles, and other-extension inventories. Exports also include extension version and browser user agent; review before sharing. No data is uploaded or synced.

Events include caught adapter/settings/menu failures, best-effort own-script global errors/rejections, worker/content starts, menu item counts, and polling pause/resume timer counts. `menu_ready` means the rebuild finished attempting its items; check adjacent `menu_error` records before treating it as successful. Each context admits at most 20 events per minute; the worker also caps queued operations at 20. Overflow is dropped, never retried. Drop/write-failure counters cover the current worker lifetime only. Final events can be lost when a renderer or browser dies before persistence.

**Do not classify worker sleep as a crash.** MV3 normally terminates idle workers after 30 seconds; lifecycle gaps and disconnected ports do not establish native crash, OOM, or another-extension conflict. This implementation adds no heartbeat, keepalive port, new permission, or periodic storage writes. Content scripts run in isolated worlds, so foreign errors are not reliably observable and are not collected.

For Windows Brave reports:

1. Record crash time/time zone, affected site, exact Brave/Chromium version, Windows version, and whether one tab or the whole browser closed.
2. After restarting, export Skippy diagnostics. Compare preceding error frames and counters with the crash time; correlation is not attribution.
3. Open `brave://crashes` manually. Brave documents **Send now** and an **Uploaded crash report ID** after submission. Sending shares native crash data with Brave; do so only intentionally.
4. Provide that uploaded ID to Brave support with the version and timestamp. An extension cannot read the native dump or prove GPU/OOM attribution through these hooks.
5. Reproduce in a separate test profile using the same content and versions: no extensions, Skippy only, other extensions only, then Skippy plus others. Keep the daily profile unchanged.
6. If only a combination reproduces, enable other extensions in halves within the test profile. If no-extension runs also crash, investigate Brave/Windows/graphics drivers with native reports.

No Windows native-crash reproduction was performed for this change. Synthetic JS exceptions test logging, not browser crash detection. Never deliberately crash a daily browser to test this feature.

Sources: [Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [content-script isolation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Dev-channel-only processes API](https://developer.chrome.com/docs/extensions/reference/api/processes), [Brave manual crash reporting](https://support.brave.app/hc/en-us/articles/22281484910221-How-do-I-manually-submit-crash-reports). Brave reporting instructions were verified from its search excerpt; direct retrieval returned HTTP 403.

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

| File                          | Covers                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `storage.test.js`             | `SkippyStorage` — defaults, merge semantics, clamping, per-site override resolution       |
| `menu.test.js`                | `SkippyMenu` — pure context-menu shape + id parsing                                       |
| `visibility.test.js`          | `skippyIsVisible` / `skippyIsPresent` / `skippyFindVisible` DOM predicates                |
| `core.test.js`                | `skippyClick`, the verbose-log gate, the steady-state polling loop                        |
| `core-startup.test.js`        | Once-per-lifetime core paths — pre-settings log buffer, settings-read failure             |
| `background.test.js`          | The service worker — rebuild serialization, create-error reporting, menu-click routing    |
| `diagnostics.test.js`         | Local persistence, bounded queues/rate, privacy, sender validation, normal worker restart |
| `core-diagnostics.test.js`    | Caught-failure instrumentation and hidden-tab timeout ownership                           |
| `options-diagnostics.test.js` | Real options DOM export/clear interactions and failure reporting                          |

`background.test.js` stubs `importScripts` (jsdom has no such function) and loads the helpers as modules, then drives the real worker through the listeners it registers. Both `core-startup.test.js` and `background.test.js` call `vi.resetModules()` per case because the code under test keeps latches in module scope.

Adapter logic (DOM selectors, visibility) is tested manually in the browser. Pinning each streaming site's DOM in fixtures isn't worth the maintenance — they change too often.

## Release

Release is dispatched through `/skill:release` after a merge to `main`. Every unspecified request is official; beta requires explicit beta/prerelease/test wording. The skill summarizes commits since the last official release and leaves custom notes/changesets unset so the workflow generates them.

The official workflow bumps `npm version minor`, drafts a release, runs `npm run package`, commits the bump back to main, and publishes the release with `skippy-ff.zip` attached. Beta uses `release-beta.yml`. See `ARCHITECTURE.md` § CI/CD.

For local one-off bundling without dispatching a release:

```bash
npm run package        # produces skippy-ff.zip in repo root
```
