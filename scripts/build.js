#!/usr/bin/env node
/** Skippy build script. Copies src/ + public/ into dist/ and syncs manifest version from package.json. */

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const srcDir = join(rootDir, "src");
const publicDir = join(rootDir, "public");
const distDir = join(rootDir, "dist");

/**
 * Recursively copy a directory tree.
 * @param {string} from Source directory.
 * @param {string} to Destination directory.
 * @returns {void}
 */
function copyDir(from, to) {
  if (!existsSync(to)) mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name === ".DS_Store") continue;
    const src = join(from, name);
    const dest = join(to, name);
    const s = statSync(src);
    if (s.isDirectory()) copyDir(src, dest);
    else copyFileSync(src, dest);
  }
}

/**
 * Sync dist/manifest.json version from package.json.
 * @returns {Promise<void>}
 */
async function syncManifestVersion() {
  const pkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf-8"));
  const manifestPath = join(distDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  manifest.version = pkg.version;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`✓ Set manifest.json version to ${pkg.version}`);
}

async function build() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  copyDir(srcDir, distDir);
  if (existsSync(publicDir)) copyDir(publicDir, distDir);
  await syncManifestVersion();
  console.log(`✓ Built to ${distDir}`);
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
