// scripts/build-icons/index.ts
/**
 * @file index.ts
 * @description Entry point for icon generation script. Runs preflight checks, then all generators.
 * Run with: npm run build:icons
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  LOGO_MARK,
  LOGO_FULL,
  LOGO_PROFILE,
  BACKDROP,
  FAVICON_SPECS,
  SOCIAL_SPECS,
  BACKDROP_VARIANTS,
  ADDITIONAL_ASSETS,
  QR_CODE_SPECS,
} from "./config.js";
import {
  buildFavicons,
  buildSocialImages,
  buildBackdropVariants,
  buildAdditionalAssets,
  buildQRCodes,
  buildManifest,
} from "./generators.js";

/* ---------- Preflight Check ---------- */

/**
 * Verify all required source files exist before generation.
 * @throws {Error} If any required file is missing.
 * @returns Promise that resolves when all files are verified.
 */
async function preflight(): Promise<void> {
  console.log("🔍 Checking source files...");
  const required = [LOGO_MARK, LOGO_FULL, LOGO_PROFILE, BACKDROP];

  for (const file of required) {
    try {
      await fs.access(path.resolve(file));
      console.log(`  ✓ ${file}`);
    } catch {
      throw new Error(`Missing required file: ${file}`);
    }
  }
}

/* ---------- Summary ---------- */

/**
 * Print summary of all generated assets.
 */
function printSummary(): void {
  console.log("\n📦 Generated assets summary:\n");

  console.log("Favicons (public/):");
  FAVICON_SPECS.forEach((s) => console.log(`  • ${s.name}.png / ${s.name}-dark.png (coquelicot)`));
  console.log("  • favicon.ico\n");

  console.log("Social Images (public/):");
  SOCIAL_SPECS.forEach((s) => console.log(`  • ${s.name}.jpg (${s.width}x${s.height})`));
  console.log("");

  console.log("Backdrop Variants (public/source/):");
  BACKDROP_VARIANTS.forEach((v) =>
    console.log(`  • ${v.name}.${v.format} (${v.width}px @ q${v.quality})`),
  );
  console.log("");

  console.log("Additional Assets (public/assets/):");
  ADDITIONAL_ASSETS.forEach((a) =>
    console.log(`  • ${a.name}.${a.format} (${a.width}x${a.height})`),
  );
  console.log("");

  console.log("QR Codes (public/):");
  QR_CODE_SPECS.forEach((s) => console.log(`  • ${s.name}.svg + ${s.name}.png (${s.displayName})`));
  console.log("");

  console.log("Manifest Files (public/):");
  console.log("  • site.webmanifest");
  console.log("  • browserconfig.xml");
  console.log("");

  console.log("✅ All assets generated successfully!");
  console.log("💡 Note: Dark mode icons use coquelicot (#f34213) color");
}

/* ---------- Main ---------- */

/**
 * Main execution function - runs all generation tasks.
 * @returns Promise that resolves when all assets are generated.
 */
async function main(): Promise<void> {
  console.log("\n🚀 Building site images and icons...\n");

  await preflight();
  await buildFavicons();
  await buildSocialImages();
  await buildBackdropVariants();
  await buildAdditionalAssets();
  await buildQRCodes();
  await buildManifest();

  printSummary();
}

main().catch((err) => {
  console.error("\n❌ Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
