// scripts/export-social-screenshot.ts
// Exports /intro as organic social JPEGs (1080x1350 at 2x, a 1x copy under Instagram's
// 1440px cap, and 1200x900 for Google) into gitignored marketing/posts/.
// Run with: npm run build:social
// Pass flags via npx tsx directly (PowerShell strips the bare `--`): --url=<url>, --output-dir=<dir>.

import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";

/* ---------- Config ---------- */

/** One creative to capture. */
interface SocialSpec {
  /** Output filename, written into the output directory. */
  name: string;
  /** Value passed as ?variant= on the route. */
  variant: "type" | "photo" | "v3" | "v3-wide";
  /** Skip this spec when the portrait is absent, rather than capturing a placeholder. */
  requiresPortrait: boolean;
  /** CSS viewport the route lays out at. */
  viewport: { width: number; height: number };
  /** Device scale factor; the file is viewport x scale pixels. */
  scale: number;
}

// Capture the dev server by default; pass --url for a deployed copy.
const DEFAULT_URL = "http://localhost:3000/intro";

const OUTPUT_DIR = "marketing/posts";

// Meta's recommended 4:5 feed size; 2x keeps text crisp on phones.
const FEED = { width: 1080, height: 1350 };

// Google's recommended post image size. 1x keeps it at exactly that size.
const GOOGLE = { width: 1200, height: 900 };

/** Portrait the photo variant needs, relative to the repo root. */
const PORTRAIT_FILE = "public/source/harrison-2026.jpg";

const SPECS: SocialSpec[] = [
  {
    name: "community-4x5-type.jpg",
    variant: "type",
    requiresPortrait: false,
    viewport: FEED,
    scale: 2,
  },
  {
    name: "community-4x5-photo.jpg",
    variant: "photo",
    requiresPortrait: true,
    viewport: FEED,
    scale: 2,
  },
  { name: "community-4x5-v3.jpg", variant: "v3", requiresPortrait: true, viewport: FEED, scale: 2 },
  {
    name: "community-4x5-v3-1080.jpg",
    variant: "v3",
    requiresPortrait: true,
    viewport: FEED,
    scale: 1,
  },
  {
    name: "community-4x3-v3-google.jpg",
    variant: "v3-wide",
    requiresPortrait: true,
    viewport: GOOGLE,
    scale: 1,
  },
];

/* ---------- CLI ---------- */

/**
 * Read a `--name=value` flag from the process arguments.
 * @param flag - Flag name without the leading dashes.
 * @returns The value, or undefined when the flag is absent.
 */
function argValue(flag: string): string | undefined {
  const match = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return match?.slice(flag.length + 3);
}

/* ---------- Rendering ---------- */

/**
 * Capture one variant of the route as a JPEG.
 * @param browser - Shared Puppeteer browser instance.
 * @param spec - The creative to capture.
 * @param baseUrl - Route URL, without the variant query string.
 * @param outputDir - Directory the file is written into.
 * @returns Absolute path of the written file.
 */
async function renderSpec(
  browser: Browser,
  spec: SocialSpec,
  baseUrl: string,
  outputDir: string,
): Promise<string> {
  const page = await browser.newPage();

  try {
    await page.setViewport({ ...spec.viewport, deviceScaleFactor: spec.scale });

    const separator = baseUrl.includes("?") ? "&" : "?";
    const targetUrl = `${baseUrl}${separator}variant=${spec.variant}`;
    const response = await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 30000 });

    // Refuse anything but a 2xx, or an error page gets saved as artwork.
    const status = response?.status() ?? 0;
    if (status < 200 || status >= 300) {
      throw new Error(
        `${targetUrl} returned HTTP ${status || "no response"}; not exporting. Is the dev server running (npm run dev), or the route deployed?`,
      );
    }

    // Hide the dev server's <nextjs-portal> route indicator.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

    // Wait for the web font so text metrics match the final render.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const outPath = path.resolve(outputDir, spec.name);
    await page.screenshot({ path: outPath, type: "jpeg", quality: 92, fullPage: false });
    return outPath;
  } finally {
    await page.close();
  }
}

/* ---------- Entry point ---------- */

(async () => {
  const start = Date.now();
  const baseUrl = argValue("url") ?? DEFAULT_URL;
  const outputDir = argValue("output-dir") ?? OUTPUT_DIR;
  fs.mkdirSync(path.resolve(outputDir), { recursive: true });

  const portraitReady = fs.existsSync(path.resolve(PORTRAIT_FILE));

  console.log(`🖼️  Building social creatives from ${baseUrl}...`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (const spec of SPECS) {
      if (spec.requiresPortrait && !portraitReady) {
        console.log(`  - ${spec.name} skipped: add a portrait at ${PORTRAIT_FILE} to build it`);
        continue;
      }

      const out = await renderSpec(browser, spec, baseUrl, outputDir);
      const sizeKb = (fs.statSync(out).size / 1024).toFixed(0);
      const { width, height } = spec.viewport;
      console.log(`  ✓ ${spec.name} (${width * spec.scale}x${height * spec.scale})`);
      console.log(`    ${out} (${sizeKb} KB)`);
    }
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✓ Done in ${elapsed}s > ${path.resolve(outputDir)}`);
})();
