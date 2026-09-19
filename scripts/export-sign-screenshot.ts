// scripts/export-sign-screenshot.ts
// Exports the /sign page as print-ready 600x900mm yard sign PDFs (corflute on an H-stake)
// by screenshotting the page via Puppeteer and embedding the result into a pdf-lib
// document. Capture, PDF assembly and crop marks come from scripts/lib/print-export.ts,
// shared with the poster and card exporters; this file owns the sign's dimensions and CLI.
// Run with: npm run build:sign [-- --local] [--variant=digital|print]

import { logSummary, renderVariants, type PageConfig } from "./lib/print-export.js";

/* ---------- Types ---------- */

/** Sign export variant: trimmed artwork, or bled artwork with crop marks. */
type SignVariant = "digital" | "print";

/** Options accepted by {@link exportSign}. */
interface ExportOptions {
  /** Fully-qualified URL of the sign page to capture (without query string). */
  url: string;
  /** Variant(s) to export (default: both). */
  variants: SignVariant[];
  /** Output directory (default: "public/downloads"). */
  outputDir: string;
}

/* ---------- Dimensions ---------- */

/**
 * Sign trim size in millimetres - the common portrait corflute size NZ sign shops
 * stock for H-stake yard signs. Change these two numbers and the page CSS
 * (src/app/sign/page.tsx) together - the layout is sized in pixels at
 * {@link PX_PER_MM}, so it does not follow this constant on its own.
 */
const TRIM_MM = { width: 600, height: 900 } as const;

/** Bleed added to every edge, in millimetres. The industry-standard 3mm. */
const BLEED_MM = 3 as const;

/**
 * CSS pixels per millimetre. 3px/mm keeps the viewport at 1800x2700; the shared
 * 2x device scale factor then captures at 6px/mm (~152 DPI), enough for a sign
 * read from metres away without a 300 DPI capture Chrome would refuse to allocate.
 */
const PX_PER_MM = 3 as const;

/**
 * Converts millimetres to whole CSS pixels at {@link PX_PER_MM}.
 * @param mm - Length in millimetres.
 * @returns Length in whole pixels.
 */
function mmToPx(mm: number): number {
  return Math.ceil(mm * PX_PER_MM);
}

/**
 * Converts millimetres to PDF points (72 per inch).
 * @param mm - Length in millimetres.
 * @returns Length in points, rounded to two decimals.
 */
function mmToPt(mm: number): number {
  return Math.round((mm / 25.4) * 72 * 100) / 100;
}

/* ---------- Page configs ---------- */

/**
 * Builds the page config for one variant.
 *
 * The print variant grows the viewport by the bleed on all four edges; the page
 * itself widens its outer padding to match, so the background extends under the
 * trim line instead of the layout simply shrinking.
 * @param variant - "digital" for trim size, "print" for bleed plus crop marks.
 * @returns The {@link PageConfig} for that variant.
 */
function signConfig(variant: SignVariant): PageConfig {
  const bled = variant === "print";
  const pageMm = {
    width: TRIM_MM.width + (bled ? BLEED_MM * 2 : 0),
    height: TRIM_MM.height + (bled ? BLEED_MM * 2 : 0),
  };

  return {
    label: bled
      ? `Print (${TRIM_MM.width}x${TRIM_MM.height}mm + ${BLEED_MM}mm bleed)`
      : `Digital (${TRIM_MM.width}x${TRIM_MM.height}mm)`,
    viewport: { width: mmToPx(pageMm.width), height: mmToPx(pageMm.height) },
    pdfSize: { width: mmToPt(pageMm.width), height: mmToPt(pageMm.height) },
    trimSize: { width: mmToPt(TRIM_MM.width), height: mmToPt(TRIM_MM.height) },
    cropMarks: bled,
    filename: bled ? "sign-print.pdf" : "sign.pdf",
    urlSuffix: bled ? "?mode=print" : undefined,
  };
}

/* ---------- Core ---------- */

/**
 * Generates the requested sign variants through one browser instance.
 * @param options - Export options (URL, variants, output directory).
 * @returns Promise resolving to the list of generated file paths.
 */
async function exportSign(options: ExportOptions): Promise<string[]> {
  const { url, variants, outputDir } = options;

  console.log(`Exporting ${variants.join("/")} sign variant(s) to ${outputDir}...`);

  return renderVariants(variants.map(signConfig), url, outputDir);
}

/* ---------- CLI ---------- */

/** Production sign URL (canonical www origin). */
const PROD_URL = "https://www.tothepoint.co.nz/sign";

/** Local dev-server sign URL. */
const LOCAL_URL = "http://localhost:3000/sign";

/**
 * Reads a flag written either as `--name=value` or `--name value`.
 * @param args - Argument list being scanned.
 * @param index - Index of the current argument.
 * @param name - Flag name without the leading dashes.
 * @returns The value and the number of extra arguments consumed, or null if the
 *   argument at `index` is not this flag.
 */
function readFlag(
  args: string[],
  index: number,
  name: string,
): { value: string; consumed: number } | null {
  const arg = args[index];
  if (arg.startsWith(`--${name}=`)) {
    return { value: arg.substring(name.length + 3), consumed: 0 };
  }
  if (arg === `--${name}` && args[index + 1]) {
    return { value: args[index + 1], consumed: 1 };
  }
  return null;
}

/**
 * Parses CLI flags from `process.argv`.
 *
 * Flags:
 * - `--local`              Use the local dev server instead of production.
 * - `--url=<value>`        Override the target URL entirely.
 * - `--variant=<value>`    Export variant: "digital", "print", or "both" (default: "both").
 * - `--output-dir=<value>` Override output directory (default: "public/downloads").
 * @returns Parsed {@link ExportOptions} ready for {@link exportSign}.
 */
function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  const options: ExportOptions = {
    url: PROD_URL,
    variants: ["digital", "print"],
    outputDir: "public/downloads",
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--local") {
      options.url = LOCAL_URL;
      continue;
    }

    const url = readFlag(args, i, "url");
    if (url) {
      options.url = url.value;
      i += url.consumed;
      continue;
    }

    const variant = readFlag(args, i, "variant");
    if (variant) {
      if (variant.value === "digital" || variant.value === "print") {
        options.variants = [variant.value];
      } else if (variant.value !== "both") {
        console.error(`Invalid variant: ${variant.value}. Must be "digital", "print", or "both".`);
        process.exit(1);
      }
      i += variant.consumed;
      continue;
    }

    const outputDir = readFlag(args, i, "output-dir");
    if (outputDir) {
      options.outputDir = outputDir.value;
      i += outputDir.consumed;
    }
  }

  return options;
}

/* ---------- Entry point ---------- */

(async () => {
  const startTime = Date.now();
  const options = parseArgs();

  try {
    logSummary(await exportSign(options), startTime);
  } catch (error: unknown) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
