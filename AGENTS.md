# AGENTS

Repository guidance for coding agents. Read `ARCHITECTURE.md` for the system map and `DEV.md` for the development workflow before non-trivial work.

## Project

Skippy is a Chrome MV3 extension that auto-clicks streaming skip buttons. It uses plain JavaScript and Vite, without frameworks.

`src/helpers/storage.js` owns supported sites, search providers, and settings defaults. AMC+ and Shudder share `skippy-amcplus.js` but retain separate site toggles. Disney+ covers Hulu content within its player; do not add a Hulu-only adapter.

## Rules

1. **`npm run validate` before every commit** — runs test, lint, build, then format. It rewrites formatting; inspect the resulting diff before staging. Coverage is separate: see `DEV.md` § Tests.
2. **JSDoc every touched function** — document a one-line description, params, return, raised errors, and side effects. Update documentation with signature or behavior changes. Trivial one-liners can skip.
3. **Add a test for every behavior change** in storage, menu, background, core helpers, polling lifecycle, and diagnostics, including the diagnostics UI. Keep adapter DOM-selector checks manual in the browser; see `DEV.md` § Debugging and § Tests.
4. **Squash merge only.** Never use merge commits or rebase merges for PRs. Use the local Git commit identity.
5. **Update `DEV.md` / `ARCHITECTURE.md`** when adding a site, changing the build pipeline, or introducing a global helper. Keep README settings and supported sites aligned with `SKIPPY_DEFAULTS` and `SKIPPY_SITES`.
6. **Adding a new streaming site touches four source files** — adapter, `src/manifest.json`, `vite.config.js`, and `src/helpers/storage.js`. Follow `DEV.md` § Adding a new streaming site, including helper load order and matching URL patterns. Generate options cards and menu items from `SKIPPY_SITES`; do not add per-site UI wiring.
7. **Content scripts AND the background service worker are classic scripts, not ES modules.** Share runtime helpers through `globalThis.SkippyStorage`, `SkippyCore`, `SkippyMenu`, and `SkippyDiagnostics`. Use `importScripts` in the worker; the options page is the only extension ES-module surface.
8. **Routine diagnostic logs go through `SkippyCore.skippyLog` / `skippyDLog`** and require `settings.verboseLogging`. Keep the `[Skippy] clicking …` line always on. Failure warnings and bounded local diagnostics also remain independent of verbose logging; do not silence those failure paths.
9. **Settings defaults are additive**, never breaking. Add new flags to `SKIPPY_DEFAULTS`, hydrate in `options.js`, and render controls in `options.html`. Choose defaults that preserve existing behavior.
10. **Use one release skill.** Read `.claude/skills/release/SKILL.md` for release requests; `/skill:release` is the documented entry point. Unspecified requests mean official; beta requires explicit beta/prerelease/test wording, never branch or SHA inference. Ask no routing or confirmation questions when the action is clear. Summarize commits since the last official release and leave custom notes/changesets unset. Official releases are manual dispatches; use the workflow's resolve-tag action, never a `github.ref_name` fallback. See `ARCHITECTURE.md` § CI/CD.

## Runtime regression boundaries

Earlier fixes addressed duplicate menu IDs, overlapping rebuilds, hidden-tab polling, and synthetic-click strobing. These extension defects do not establish a native browser-crash cause.

- Keep URL-scoped top-level `Skippy <Site> Settings` branches and one `Search Movie Information` submenu. Do not restore repeated generic `Skippy` roots. Test counts, unique IDs, parent relationships, provider order, and URL scoping.
- Serialize menu rebuilds through Chrome callback completion. A failed rebuild must not poison later rebuilds. Keep `contextMenus.onShown` registration optional for browsers without that event.
- Each polling loop owns one timeout. Clear it when `document.visibilityState !== "visible"`; resume only from `visibilitychange`. Do not use unbounded `setInterval` or create a second timer on resume.
- Add hidden-tab pause/resume and rebuild-serialization regressions whenever the corresponding lifecycle changes.
- Keep native `.click()` dispatch. Do not restore synthetic mouse events without reproducing the earlier control-overlay strobe loop.
- Before changing selectors for a crash report, inspect timer ownership, menu counts, rebuild concurrency, and adapter errors. Reproduce with multiple supported tabs, including hidden tabs.

## Diagnostics and crash attribution

Preserve the local-only, bounded collector and worker-owned persistence queue. Keep sender validation and sanitized error evidence; do not collect raw error messages, browsing URLs, titles, or other-extension inventories.

Do not add heartbeat keepalives, periodic storage writes, remote telemetry, or new permissions to infer crashes. Normal MV3 worker sleep is not a crash. Native crash attribution requires browser reports and controlled reproduction; JavaScript exceptions alone cannot prove it.

For retention limits, export/clear behavior, privacy, and Brave/Windows investigation, read `DEV.md` § Persistent diagnostics and Brave/Windows crash triage.
