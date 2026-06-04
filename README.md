# Skippy

Auto-skip intros, recaps, and credits while you binge. SponsorBlock for streaming services.

Currently supports **Crunchyroll**, **Disney+**, and **Apple TV**. Netflix, Hulu, and more are on the roadmap.

## How it works

A content script runs on supported streaming sites. It polls for visible skip buttons (matched by `aria-label`: `Skip Intro`, `Skip Recap`, `Skip Credits`) and clicks them automatically. A per-button cooldown prevents double-clicks. Each skip type is a flag — toggle them in the popup.

## Install (unpacked, for development)

```bash
npm install
npm run build
```

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. **Load unpacked** → select the `dist/` folder
4. Pin the extension to your toolbar (puzzle icon → pin Skippy) for quick access to settings

## Scripts

| Command           | Purpose                            |
| ----------------- | ---------------------------------- |
| `npm run build`   | Copy `src/` + `public/` to `dist/` |
| `npm run bundle`  | Zip `dist/` into `skippy-ff.zip`   |
| `npm run package` | Build + bundle                     |
| `npm run format`  | Prettier (140 char width)          |

## Project structure

```
skippy-ff/
├── src/
│   ├── manifest.json                  # MV3 manifest
│   ├── helpers/storage.js             # chrome.storage.sync wrapper
│   ├── content/
│   │   ├── skippy-core.js             # visibility + click helpers, polling loop
│   │   ├── skippy-crunchyroll.js      # Crunchyroll site adapter
│   │   ├── skippy-disneyplus.js       # Disney+ site adapter
│   │   └── skippy-appletv.js          # Apple TV site adapter
│   └── pages/options/                 # Settings page (also used as popup)
│       ├── options.html
│       ├── options.css
│       └── options.js
├── public/icon.png                    # Extension icon
├── scripts/
│   ├── build.js                       # Copy src/ + public/ to dist/
│   └── bundle.js                      # Zip dist/ for store upload
├── package.json
└── README.md
```

## Settings (defaults)

| Flag           | Default | Description                     |
| -------------- | ------- | ------------------------------- |
| `skipIntro`    | `true`  | Click "Skip Intro" when shown   |
| `skipRecap`    | `true`  | Click "Skip Recap" when shown   |
| `skipCredits`  | `true`  | Click "Skip Credits" when shown |
| `enabledSites` | all on  | Per-site enable toggle          |

Settings are stored in `chrome.storage.sync` and roam across signed-in Chrome profiles.

## Adding a new streaming site

1. Create `src/content/skippy-<site>.js` exporting nothing — call `SkippyCore.skippyStart(adapter)` at the bottom. The adapter takes settings and returns a visible button to click (or `null`).
2. Register the script in `src/manifest.json` under `content_scripts` with the appropriate `matches` host patterns. Include `helpers/storage.js` and `content/skippy-core.js` before the adapter.
3. Add a checkbox row in `src/pages/options/options.html` with `data-site="<hostname>"`.

## Roadmap

- Netflix adapter (`Skip Intro`, `Skip Recap`, `Next Episode`)
- Hulu adapter
- Toggle for auto-clicking "Next Episode"
- Per-site skip-flag overrides
