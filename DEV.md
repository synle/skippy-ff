# Development guide

Local workflows for Skippy. Read alongside `ARCHITECTURE.md` for the system map and `AGENTS.md` for repository rules.

## Prereqs

- Node matching `package.json` → `volta.node`.
- Chrome with Developer mode enabled.

## First-time setup

```bash
npm ci --ignore-scripts
npm run build      # produces dist/ and storage declarations in types/
```

If an install needs a dependency lifecycle script, review that script before running it separately.

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

| Command                 | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `npm run dev`           | Vite watch build → `dist/`                               |
| `npm run build`         | Emit storage declarations, then build `dist/` with Vite  |
| `npm run bundle`        | Zip `dist/` → `skippy-ff.zip` (the release artifact)     |
| `npm run package`       | `build` + `bundle`                                       |
| `npm run test`          | Vitest run                                               |
| `npm run test:coverage` | Separate coverage gate; see § Tests                      |
| `npm run lint`          | ESLint over `src/`                                       |
| `npm run format`        | oxfmt (see `.oxfmtrc.json`) on the whole tree            |
| `npm run format:check`  | Check formatting without writing                         |
| `npm run validate`      | `test + lint + build + format` — run before every commit |

## Adding a new streaming site

Update four source files, then related documentation. See `ARCHITECTURE.md` § Build pipeline for the classic-script build constraints.

1. **Adapter** — create `src/content/skippy-<site>.js` with signature `(settings) => HTMLElement | null`. Resolve flags through `SkippyStorage.getEffectiveSiteSettings(settings, "<host>")` and end with `SkippyCore.skippyStart(adapter)`.
2. **Manifest** — add the site's host patterns under `content_scripts[].matches` in `src/manifest.json`. Load `helpers/diagnostics.js`, `helpers/storage.js`, `content/skippy-core.js`, then the adapter under `js`; globals must precede consumers.
3. **Build plugin** — add a `copyFileSync` for the adapter in `vite.config.js`'s `skippy-copy-manifest` plugin. Content scripts are copied verbatim, not bundled as Vite ES-module inputs.
4. **Centralized site list** — add `{ host, label, urlPatterns }` to `SKIPPY_SITES` in `src/helpers/storage.js`. Add the host to `SKIPPY_DEFAULTS.enabledSites` with `true`. Mirror the manifest `matches` in `urlPatterns`. Options cards and menu branches come from this list; no extra per-site UI wiring is needed.

Selector examples in `src/content/`:

- `skippy-appletv.js`: test ID, class, and text strategies.
- `skippy-disneyplus.js`: shadow-DOM traversal.
- `skippy-crunchyroll.js`: `aria-label` matching.
- `skippy-netflix.js`: `data-uia` substrings and normalized, case-insensitive text.
- `skippy-primevideo.js`: `atvwebplayersdk-*` class substrings and multiple text variants, including Skip Intro / Skip intro.

Update README supported sites and settings, plus `AGENTS.md` / `ARCHITECTURE.md` / this guide when their guidance changes. AMC+ and Shudder already share an adapter; retain separate site keys.

After editing, follow § Tests for final validation, then reload the extension and test the live site. Never hand-edit generated `dist/` or `types/` files.

For declaration-emission scope and build wiring, read `ARCHITECTURE.md` § Build pipeline.

## Right-click context menu

A background service worker (`src/background.js`) registers top-level **Skippy `<Site>` Settings** branches plus **Search Movie Information** on supported streaming pages. Site controls are nested below the matching site settings entry. Items are generated per-site from `SKIPPY_SITES` and reflect the live `getEffectiveSiteSettings` resolution:

- **Enable on `<Site>`** — toggles `enabledSites[host]`.
- **Follow master settings** — inverse of `siteOverrides[host].useOverride`.
- **Skip Intro / Skip Recap / Skip Credits / Auto start next episode** — toggling any flag flips `useOverride` true on the site (same behavior as the options page card).
- **Search Movie Information** — opens an encoded provider search using selected text, or the decoded final URL path segment as fallback. It does not read the page title. Choose providers in settings. Read `README.md` § Defaults for default states. Provider order follows `SKIPPY_SEARCH_PROVIDERS`.

When the site is disabled, the four flag rows and "Follow master settings" are hidden; only Enable remains in that site's branch.

Menus rebuild on initial worker load, `onInstalled`, `onStartup`, and sync changes to `skippySettings`. The rebuild queue waits for `removeAll` and every create callback before starting another rebuild. Failed rebuilds cannot poison later work. Create failures attempt in-place updates; callback `runtime.lastError` values are consumed and reported.

When `contextMenus.onShown` exists, the worker shows only the matching site branch and title search on supported URLs. Unsupported or missing URLs hide those branches. Registration stays optional for browsers without the event; dynamic toolbar filtering is unavailable there. Right-click items also carry `documentUrlPatterns`.

Known source mismatch: `handleContextMenuShown` still updates `skippy:settings`, but neither menu builder creates that ID. A callback error on this update records `menu_error`; this does not establish a native crash. A runtime fix needs a separate regression covering updates to unregistered IDs. Global settings remain available in the popup/options page.

To debug context-menu issues, inspect the service worker: `chrome://extensions/` → Skippy → **Inspect views: service worker**. `[Skippy] context menu …` warnings land in that console.

## Debugging

### Verbose logging

Routine scan logs are off by default. Click lines, failure warnings, and bounded local diagnostics remain active independently of verbose logging. To see scan details:

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

Windows native-crash reproduction remains unverified. Synthetic JavaScript exceptions test logging, not browser crash detection. Never deliberately crash a daily browser to test this feature.

Sources: [Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [content-script isolation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Dev-channel-only processes API](https://developer.chrome.com/docs/extensions/reference/api/processes), [Brave manual crash reporting](https://support.brave.app/hc/en-us/articles/22281484910221-How-do-I-manually-submit-crash-reports). Brave reporting instructions were verified from its search excerpt; direct retrieval returned HTTP 403.

### `__skippy()` inspector

Adapters install `__skippy()` on their content-script window. Use it to inspect candidates, rectangles, and shadow-root state independently of verbose logging. If DevTools cannot find it, select Skippy's content-script execution context rather than the top-page context.

### "Skip button is on screen but Skippy doesn't fire"

Walk this list:

1. **Is the adapter loaded?** Search Console for `[Skippy/<site>] adapter loaded`. Missing → the page is on a host the `matches` pattern doesn't cover. Check `src/manifest.json`.
2. **Did the poll loop start?** Enable verbose logging and look for `[Skippy] polling started`. Hidden documents intentionally pause scans; make the tab visible first. Check failure warnings and helper load order before blaming selectors.
3. **Are scan candidates found?** With verbose logging on, inspect the adapter's `scan: …` line at an expected skip moment. Zero candidates can indicate selector drift; inspect the live DOM before changing selectors.
4. **Is the candidate considered visible?** For `visible=false`, inspect `skippyIsVisible` and `__skippy()` output. Check ancestor `aria-hidden="true"` / `inert`, computed styles, and rectangle dimensions. `opacity:0` idle fades and `transform: scale(0)` are common examples. The permissive `skippyIsPresent` drops opacity and pointer-events checks but still rejects `aria-hidden` / `inert`.
5. **Click fires but nothing happens?** Inspect verbose `[Skippy] click via …` lines and the chosen target. Core uses native `.click()` only. Do not restore synthetic mouse events without reproducing the earlier control-overlay strobe loop.

### Manually triggering events

The streaming sites only render skip buttons at specific moments (intro, recap, credits). For deterministic testing, scrub the player to ~5 seconds before the event. End-credits buttons often appear in the last 90 seconds of an episode.

### Menu and polling regression checks

Use a separate test profile with multiple supported tabs, including hidden tabs:

- Check site/search menu visibility on supported and unsupported URLs from both page and toolbar menus.
- Check provider toggles, order, encoded searches, and unique IDs. An opaque URL ID is not a resolved movie title; select title text for a useful query.
- Change settings rapidly and confirm rebuilds do not overlap or leave stale checkboxes.
- Hide and restore streaming tabs; confirm no hidden-tab scans and only one timeout on resume.
- Compare caught-error evidence with the actual failure; `menu_ready` records attempted items, not guaranteed success.

Run these browser checks alongside automated tests. For native-crash reports, follow § Persistent diagnostics and Brave/Windows crash triage.

## Tests

```bash
npm test               # one-shot
npm run test:coverage  # with coverage gate (thresholds in vite.config.js)
```

Tests live in `tests/`. Storage tests use `tests/_chromeMock.js` and `vi.stubGlobal("chrome", chrome)`. Worker and diagnostics suites provide their own API mocks.

Coverage is separate from `npm run validate`. `vite.config.js` includes helpers, core, background, and the diagnostics UI controller; it excludes live adapters and the main options controller. The configured project-wide thresholds are 50% for lines, statements, branches, and functions. For code changes, also measure at least 80% changed-code line and branch coverage where available. Overall coverage alone does not prove changed-code coverage.

Run the final `npm run validate` once after the last edit. It writes formatting across the tree; inspect the resulting diff before staging. `npm run format:check` checks without writing.

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

For release requests, read `.claude/skills/release/SKILL.md` (`/skill:release`). It owns routing, prerequisites, duplicate-release checks, summaries, confirmations, and custom-note restrictions.

For workflow versioning, artifacts, and tag resolution, see `ARCHITECTURE.md` § CI/CD.

For local one-off bundling without dispatching a release:

```bash
npm run package        # produces skippy-ff.zip in repo root
```
