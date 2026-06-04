#!/usr/bin/env node
/** Skippy bundle script. Syncs manifest version then zips dist/ into skippy.zip. */

import { createWriteStream, existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distDir = join(rootDir, "dist");
const outputPath = join(rootDir, "skippy.zip");

/**
 * Sync manifest.json version from package.json in both dist/ and src/.
 * @returns {Promise<void>}
 */
async function syncManifestVersion() {
  const pkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf-8"));
  for (const dir of [distDir, join(rootDir, "src")]) {
    const manifestPath = join(dir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    manifest.version = pkg.version;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(`✓ Set manifest.json version to ${pkg.version}`);
}

async function createZip() {
  if (!existsSync(distDir)) {
    console.error("Error: dist/ not found. Run 'npm run build' first.");
    process.exit(1);
  }

  await syncManifestVersion();
  console.log("Creating zip file...");

  const output = createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on("close", () => {
      const sizeKb = (archive.pointer() / 1024).toFixed(1);
      console.log(`✓ Created skippy.zip (${sizeKb} KB)`);
      resolve();
    });
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(distDir, false);
    archive.finalize();
  });
}

createZip().catch((err) => {
  console.error("Bundle failed:", err);
  process.exit(1);
});
