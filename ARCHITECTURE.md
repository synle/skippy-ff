# Architecture

System map for Skippy. Read alongside `DEV.md` for workflows and `AGENTS.md` for repository rules.

## High-level

Skippy is a Chrome Manifest V3 extension. Content scripts poll supported streaming pages for skip buttons and click them automatically.

Settings live in `chrome.storage.sync`. The options page, toolbar popup, and context menu update those settings. Diagnostic evidence stays separately in `chrome.storage.local`.

`src/helpers/storage.js` defines supported sites, providers, and defaults. AMC+ and Shudder share one adapter but retain separate toggles. Disney+ covers Hulu content within its player; the manifest has no standalone `hulu.com` adapter.

### Runtime wiring

```text
Streaming tab — classic scripts, in manifest order:
  helpers/diagnostics.js → helpers/storage.js → content/skippy-core.js → adapter
  SkippyDiagnostics       SkippyStorage        SkippyCore              skippyStart

Background worker — classic scripts:
  importScripts("helpers/diagnostics.js") → SkippyDiagnostics.init("background")
  importScripts("helpers/storage.js", "helpers/menu.js")
  serialized menu rebuilds + click routing + diagnostic message/persistence queue

Options page / popup — ES modules:
  options.js → import helpers/storage.js for global initialization
             → import pages/options/diagnostics.js for export/clear controls

Settings:    options/menu → chrome.storage.sync → onChanged → content settings
Diagnostics: content → runtime message → worker → chrome.storage.local
             options → runtime message → worker → export/clear response
```

Content scripts and the worker share helpers through `globalThis`, not ES-module imports. The options page is the only extension ES-module surface.

## Components

### `src/helpers/storage.js`

`globalThis.SkippyStorage` wraps sync storage with defaults merging. `SKIPPY_SITES` supplies options cards and menu branches; its URL patterns must match `src/manifest.json`.

`SKIPPY_SEARCH_PROVIDERS` defines provider IDs, labels, display order, and URL templates. `SKIPPY_FLAG_KEYS` defines the four skip flags shared by master settings and site overrides.

**Settings schema:** `SKIPPY_DEFAULTS` supplies current values. For user-facing defaults, read `README.md` § Defaults.

| Key               | Type                           | Purpose                                                                      |
| ----------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `skipIntro`       | `boolean`                      | Click intro skip buttons                                                     |
| `skipRecap`       | `boolean`                      | Click recap skip buttons                                                     |
| `skipCredits`     | `boolean`                      | Click credits skip buttons                                                   |
| `nextEpisode`     | `boolean`                      | Start the next episode independently of credits skipping                     |
| `verboseLogging`  | `boolean`                      | Enable routine content-script console diagnostics                            |
| `pollIntervalMs`  | `number`                       | Scan cadence in milliseconds; clamped to 100–5000 on save and during polling |
| `enabledSites`    | `Record<string, boolean>`      | Enable or disable each supported site                                        |
| `siteOverrides`   | `Record<string, SiteOverride>` | Per-site skip flags and `useOverride`                                        |
| `searchProviders` | `Record<string, boolean>`      | Choose title-search menu providers                                           |

`getSkippySettings()` merges defaults with persisted values. It merges enabled sites and search providers by key, and each site override against `SKIPPY_SITE_OVERRIDE_DEFAULTS`.

A `SiteOverride` contains `useOverride`, `skipIntro`, `skipRecap`, `skipCredits`, and `nextEpisode`. Missing override flags default to `true`; missing `useOverride` defaults to `false`.

Adapters resolve flags through `getEffectiveSiteSettings(settings, siteKey)`:

1. `enabledSites[siteKey] === false` returns all flags false and `source = "disabled"`.
2. An override with `useOverride === true` returns its flags and `source = "site"`.
3. Otherwise, master flags apply and `source = "master"`.

### `src/helpers/diagnostics.js`

Classic-script `globalThis.SkippyDiagnostics` exposes `init(context)` and `record(kind, error?, metrics?)`. Core initializes content hooks before adapters execute. The worker initializes hooks before importing storage and menu helpers.

Only the worker writes `skippyDiagnostics` in local storage. Its bounded, serialized queue handles persistence, export, and clear. A rejected operation cannot poison later operations.

Error evidence contains allowlisted error types and Skippy file/line frames, not arbitrary messages or external URLs. Supported site keys derive from browser-supplied sender metadata and the menu URL matcher.

Internal `SKIPPY_DIAGNOSTICS` messages accept `record` from supported content tabs and `export`/`clear` from the exact extension options-page URL. The options-only controller renders copyable JSON and accessible failure status.

There is no remote telemetry, new permission, heartbeat, or keepalive. Normal worker starts are informational; native crash attribution remains unknown.

For retention limits, privacy, dropped-event behavior, and Brave/Windows investigation, see `DEV.md` § Persistent diagnostics and Brave/Windows crash triage.

### `src/content/skippy-core.js`

`globalThis.SkippyCore` supplies visibility, click, polling, and logging helpers.

**Visibility:** `skippyIsVisible` checks element type, connection, ancestor `aria-hidden="true"`, ancestor `inert`, computed display/visibility, positive rectangle dimensions, opacity, and pointer events. Each failing gate independently rejects the candidate.

`skippyIsPresent` retains the connection, author-intent, display/visibility, and rectangle gates but drops opacity and pointer-events checks. Adapters use it for mounted buttons whose player chrome fades while handlers remain active. Neither helper bypasses `aria-hidden` or `inert`.

**Click dispatch:** `skippyClick` tries a native `.click()` on a button, link, or `[role="button"]`. It then tries an open-shadow-root inner button, an `elementFromPoint` hit target, and finally the original element.

Synthetic mouse-event dispatch is disabled. Earlier synthetic events reactivated player controls and caused repeated click/strobe loops.

**Polling:** `skippyStart(adapter, options?)` owns one re-armed timeout and reads the latest interval on each tick. It clears the timeout while the document is hidden and resumes on `visibilitychange`, not window focus.

The interval uses `SkippyStorage.clampPollIntervalMs`. A per-element cooldown defaults to 2000 ms. Settings load once and refresh through `chrome.storage.onChanged`.

If initial settings loading fails, skipping stays disabled rather than guessing which sites the user enabled. Adapter exceptions produce bounded diagnostic evidence and deduplicated warnings without killing future ticks.

**Logging:** `skippyLog` gates routine logs behind `verboseLogging`; startup messages wait in a bounded buffer until settings resolve. `skippyDLog` suppresses repeated identical messages per key. Click lines, failure warnings, and local diagnostic collection remain independent of verbose logging.

### `src/content/skippy-<site>.js` — adapters

Each adapter receives settings, resolves effective site flags, and returns a clickable `HTMLElement` or `null`. It starts the shared loop with `SkippyCore.skippyStart(adapterFn)`.

Selectors and strict-versus-permissive visibility choices belong in adapters, not the shared polling loop. Strategies include aria labels, test IDs, class substrings, normalized text, and open shadow roots.

Apple TV's manifest entry uses `all_frames: true` for its framed player. AMC+ and Shudder share `skippy-amcplus.js` for their common player stack.

Adapters expose `__skippy()` inspectors for manual DevTools investigation. See `DEV.md` for selector examples and the debugging checklist.

### `src/pages/options/`

`options.html` is Vite's only HTML input and serves as both settings page and action popup. `options.js` imports storage for global initialization and imports `diagnostics.js` for export/clear controls.

Site cards come from `SKIPPY_SITES`; search-provider controls come from `SKIPPY_SEARCH_PROVIDERS`. Settings changes persist through `SkippyStorage`.

### `src/helpers/menu.js`

`globalThis.SkippyMenu` exposes pure menu and search helpers:

- `buildSkippyRootMenuItems(urlPatterns, settings)` builds `Search Movie Information` and enabled provider children, not a global settings item.
- `buildSkippyContextMenuItems(settings, site)` builds one URL-scoped top-level `Skippy <Site> Settings` branch with nested controls.
- `buildSkippySiteVisibilityUpdates(sites, pageUrl)` selects branches matching the current URL.
- `parseSkippyMenuItemId(id)` parses search actions. The worker separately parses site enable, follow, and flag IDs.
- `extractTitleSearchQuery(info)` prefers selected text, then the decoded final URL path segment with hyphens/underscores replaced by spaces.
- `buildTitleSearchUrl(service, query)` encodes the query into a configured provider template. It does not read the page title or resolve opaque video IDs.

### `src/background.js`

The classic worker loads diagnostics first, then storage and menu helpers. It rebuilds menus on initial load, installation, browser startup, and sync changes to `skippySettings`.

`pendingRebuild` serializes `removeAll` and all item-create callbacks. Create failures attempt in-place updates; callback `runtime.lastError` values are consumed and reported. One failure cannot poison the rebuild queue.

When `contextMenus.onShown` exists, the worker refreshes site/search visibility from `pageUrl`. Registration stays optional for browser versions without that event.

Site clicks update settings through `SkippyStorage.saveSkippySettings`. Toggling a flag sets `useOverride = true`; checking Follow master sets it false. Search clicks open an encoded provider URL through `chrome.tabs.create`.

For current menu limitations, including the stale `skippy:settings` visibility update, see `DEV.md` § Right-click context menu.

## Data flow

A popup/options checkbox or site-menu click saves a partial settings patch through `SkippyStorage.saveSkippySettings`.

The sync change event refreshes content-script settings and rebuilds the menu. Content scripts mirror `verboseLogging` into core logging; the next poll uses the refreshed settings.

Local diagnostic writes do not trigger sync-settings menu rebuilds.

## Build pipeline

`npm run build` first runs `build:types`, then Vite. `tsconfig.json` emits storage declarations into `types/`; `checkJs` is false, so this is not full JavaScript type checking.

`vite.config.js` defines two plugins:

1. **`skippy-copy-manifest`** copies the manifest, replaces its version from `package.json`, and adds `(DEV)` to its name in watch mode. It copies content scripts, classic helpers, and the worker verbatim into `dist/`.
2. **`skippy-move-html`** moves emitted HTML into `dist/pages/` and rewrites asset links to extension-relative paths.

`public/` supplies icons at the distribution root. `scripts/bundle.js` creates `skippy-ff.zip` from `dist/`.

Adding a site touches four source files; follow `DEV.md` § Adding a new streaming site. Generated `dist/`, `types/`, and coverage output are not source files.

## Testing

Vitest runs in jsdom. Storage tests use `tests/_chromeMock.js`; worker tests stub `importScripts` and context-menu APIs to drive registered listeners.

For automated scope, coverage gates, and manual browser checks, read `DEV.md` § Tests.

## CI/CD

- **`build-main.yml`** runs on pushes and PRs targeting main/master. Jobs cover tests/lint, the reusable build workflow, and coverage; PRs also build and upload `skippy-ff.zip`.
- **`release-official.yml`** is manual `workflow_dispatch`. It bumps the minor version, resolves a tag, drafts a release, packages the extension, commits the bump, and finalizes the release.
- **`release-beta.yml`** is manual dispatch with an optional SHA. It marks the packaged manifest as beta, restores the source manifest afterward, and finalizes through the beta channel.

For release requests, read `.claude/skills/release/SKILL.md` (`/skill:release`). The skill owns release policy.

Tag derivation uses the workflows' `resolve-tag` action, never a `github.ref_name` fallback. For local bundling without release dispatch, see `DEV.md` § Release.
