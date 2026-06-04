#!/usr/bin/env node
/** Skippy bundle script. Zips dist/ into skippy.zip for Chrome Web Store upload. */

import { createWriteStream, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distDir = join(rootDir, "dist");
const outputPath = join(rootDir, "skippy.zip");

async function createZip() {
  if (!existsSync(distDir)) {
    console.error("Error: dist/ not found. Run 'npm run build' first.");
    process.exit(1);
  }

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
