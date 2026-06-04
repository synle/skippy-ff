# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

Read `ARCHITECTURE.md` for the system map and `DEV.md` for the development workflow **before** non-trivial work. This file is rules only.

## Project (one-liner)

Skippy is a Chrome MV3 extension that auto-clicks "Skip Intro / Recap / Credits" buttons on Crunchyroll, Disney+, and Apple TV. Plain JS + Vite 6, no frameworks.

## Rules

1. **`npm run validate` before every commit** — runs test + lint + build + format.
2. **JSDoc every touched function** — one-line description, params, return, raised errors, side effects. Update in the same edit when signature or behavior changes. Trivial one-liners can skip.
3. **Add a test for every behavior change** in `helpers/storage.js` or in the pure DOM-predicate helpers in `content/skippy-core.js` (`skippyIsVisible`, `skippyIsPresent`, `skippyFindVisible`). Adapter DOM-selector changes are tested manually in the browser (see `DEV.md` § Debugging) — site DOMs churn too fast to be worth fixturing.
4. **Squash merge only.** Never merge commits or rebase merges. Author = local `.gitconfig`.
5. **Update `DEV.md` / `ARCHITECTURE.md`** when adding a site, changing the build pipeline, or introducing a new global helper. Keep the README's settings table and supported-sites list in sync with `SKIPPY_DEFAULTS`.
6. **Adding a new content script is a 4-file change** — adapter, manifest, `copyFileSync` in `vite.config.js`, options-page checkbox. Step-by-step in `DEV.md`.
7. **Content scripts are classic scripts, not ES modules** (MV3 constraint). Cross-script wiring goes through `globalThis.*` (`SkippyStorage`, `SkippyCore`). The options page is the only ES-module surface.
8. **All diagnostic logs go through `SkippyCore.skippyLog` / `skippyDLog`** — silent unless `settings.verboseLogging` is on. The `[Skippy] clicking …` line is the only exception (always on, so users can confirm a skip fired).
9. **Settings defaults are additive**, never breaking. New flag → add to `SKIPPY_DEFAULTS`, hydrate in `options.js`, render a row in `options.html`, default to a value that preserves existing behavior.
10. **Release dispatch never auto-pins to HEAD.** `release-official` is `workflow_dispatch` only; tag is derived via `synle/workflows/.../resolve-tag` (no `github.ref_name` fallback). See `ARCHITECTURE.md` § CI/CD.
