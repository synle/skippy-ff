/** Vite build configuration for the Skippy Chrome Extension. */
import { defineConfig } from "vite";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.argv.includes("--watch");

export default defineConfig({
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      // Coverage is scoped to code that is actually unit-tested via Vitest. Site adapters
      // (`src/content/skippy-{crunchyroll,disneyplus,appletv}.js`) and the options-page
      // module (`src/pages/options/options.js`) run in a real Chrome MV3 context — Chrome
      // storage, shadow DOM, streaming-site UI — and are validated manually in the browser
      // per CLAUDE.md. `skippy-core.js` is the site-agnostic helper layer (visibility
      // checks, click dispatch, polling loop), which IS fixturable in jsdom, so it stays
      // in scope.
      include: ["src/helpers/**/*.{js,ts}", "src/content/skippy-core.js"],
      exclude: [
        "src/**/*.{test,spec}.{js,ts}",
        "src/**/*.d.ts",
        "scripts/**",
        ".env*",
        "**/secret*",
        "**/credential*",
        "**/*.pem",
        "**/*.key",
        "**/*.p12",
        "secrets/**",
      ],
      // Modest floor for a fresh project — raise as test coverage grows.
      thresholds: {
        lines: 50,
        statements: 50,
        branches: 50,
        functions: 50,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        options: resolve(__dirname, "src/pages/options/options.html"),
      },
      output: {
        entryFileNames: "pages/[name]/[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "assets/[name].[ext]";
          }
          return "assets/[name]-[hash].[ext]";
        },
      },
    },
  },
  publicDir: "public",
  plugins: [
    {
      name: "skippy-copy-manifest",
      /**
       * Copy manifest + content scripts + helper into dist/, sync manifest version
       * from package.json, and mark name as (DEV) in watch mode.
       * @returns {void}
       */
      closeBundle() {
        // Manifest with version synced from package.json.
        const manifestDest = resolve(__dirname, "dist/manifest.json");
        copyFileSync(resolve(__dirname, "src/manifest.json"), manifestDest);
        const manifest = JSON.parse(readFileSync(manifestDest, "utf-8"));
        const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));
        manifest.version = pkg.version;
        if (isDev) {
          manifest.name = `${manifest.name} (DEV)`;
        }
        writeFileSync(manifestDest, JSON.stringify(manifest, null, 2));

        // Content scripts (verbatim — Chrome MV3 content scripts are not ES modules).
        const contentDir = resolve(__dirname, "dist/content");
        mkdirSync(contentDir, { recursive: true });
        copyFileSync(resolve(__dirname, "src/content/skippy-core.js"), join(contentDir, "skippy-core.js"));
        copyFileSync(resolve(__dirname, "src/content/skippy-crunchyroll.js"), join(contentDir, "skippy-crunchyroll.js"));
        copyFileSync(resolve(__dirname, "src/content/skippy-disneyplus.js"), join(contentDir, "skippy-disneyplus.js"));
        copyFileSync(resolve(__dirname, "src/content/skippy-appletv.js"), join(contentDir, "skippy-appletv.js"));
        copyFileSync(resolve(__dirname, "src/content/skippy-netflix.js"), join(contentDir, "skippy-netflix.js"));
        copyFileSync(resolve(__dirname, "src/content/skippy-primevideo.js"), join(contentDir, "skippy-primevideo.js"));
        copyFileSync(resolve(__dirname, "src/content/skippy-max.js"), join(contentDir, "skippy-max.js"));

        // Storage helper (shared between content scripts and options page; loaded as classic script).
        const helpersDir = resolve(__dirname, "dist/helpers");
        mkdirSync(helpersDir, { recursive: true });
        copyFileSync(resolve(__dirname, "src/helpers/storage.js"), join(helpersDir, "storage.js"));
      },
    },
    {
      name: "skippy-move-html",
      /**
       * Move HTML files from dist/src/pages/ to dist/pages/ and rewrite asset
       * paths to be relative so they resolve under chrome-extension:// origins.
       * @returns {void}
       */
      closeBundle() {
        const srcPagesDir = resolve(__dirname, "dist/src/pages");
        const destPagesDir = resolve(__dirname, "dist/pages");
        if (!existsSync(srcPagesDir)) return;

        for (const page of ["options"]) {
          const srcFile = join(srcPagesDir, page, `${page}.html`);
          const destDir = join(destPagesDir, page);
          const destFile = join(destDir, `${page}.html`);
          if (!existsSync(srcFile)) continue;

          mkdirSync(destDir, { recursive: true });
          let content = readFileSync(srcFile, "utf-8");
          content = content.replace(/src="\/pages\/[^/]+\/([^"]+)"/g, 'src="./$1"');
          content = content.replace(/href="\/chunks\/([^"]+)"/g, 'href="../../chunks/$1"');
          content = content.replace(/href="\/assets\/([^"]+)"/g, 'href="../../assets/$1"');
          // Rewrite reference to the verbatim-copied storage helper.
          content = content.replace(/src="\.\.\/\.\.\/helpers\/storage\.js"/g, 'src="../../helpers/storage.js"');
          writeFileSync(destFile, content);
        }

        // Clean up the temporary src tree Vite emits.
        rmSync(resolve(__dirname, "dist/src"), { recursive: true, force: true });
      },
    },
  ],
});
