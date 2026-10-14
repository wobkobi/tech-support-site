// scripts/export-social-screenshot.ts
// Exports the /intro route as social JPEGs. The 4:5 set is 1080x1350, Meta's recommended
// feed ratio, captured at 2x > 2160x2700. v3 also gets a 1x copy for posting through the
// admin social tool, since Instagram's publishing API refuses anything over 1440px wide,
// and a 1200x900 (4:3) layout for Google Business Profile, which crops 4:5 images to
// roughly 4:3. Built for ORGANIC posts, so unlike the paid
// creatives in build-ads.ts the artwork carries its own contact details; capturing a live
// route (rather than self-contained HTML the way build-ads.ts does) is what keeps the
// phone number and website reading from the live settings.
// Output lands in marketing/posts/, next to the paid creatives in marketing/ads/ -
// gitignored, not served.
// Run with: npm run build:social
// Flags go through npx directly (npx tsx scripts/export-social-screenshot.ts --url=<url>):
// PowerShell strips the bare `--` in `npm run <script> -- --flag`, so the flag vanishes
// with no warning. Accepts --url=<url> and --output-dir=<dir>.

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

// The route is artwork under active iteration and the portrait may not be committed
// yet, so capture the dev server by default. Pass --url to capture a deployed copy.
const DEFAULT_URL = "http://localhost:3000/intro";

const OUTPUT_DIR = "marketing/posts";

// 4:5 at 1080 wide is what Meta recommends for feed; 2x keeps text crisp on
// high-DPI phones, which is where nearly all of this gets read.
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

    // Refuse anything but a 2xx: a 404 or 500 still renders a full page, and
    // capturing it would write an error page out as artwork.
    const status = response?.status() ?? 0;
    if (status < 200 || status >= 300) {
      throw new Error(
        `${targetUrl} returned HTTP ${status || "no response"}; not exporting. Is the dev server running (npm run dev), or the route deployed?`,
      );
    }

    // The dev server paints its route indicator into a <nextjs-portal> element,
    // which otherwise lands in the corner of the artwork.
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
