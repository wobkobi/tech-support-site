// scripts/export-card-screenshot.ts
// Exports the /card page as print-ready business card PDFs (90x55mm, the standard NZ
// size) by screenshotting each face via Puppeteer and embedding the result into a pdf-lib
// document. Capture, PDF assembly and crop marks come from scripts/lib/print-export.ts,
// shared with the poster exporter; this file owns the card's dimensions and CLI.
// Run with: npm run build:card [-- --local] [--side=front|back] [--variant=digital|print]

import { logSummary, renderVariants, type PageConfig } from "./lib/print-export.js";

/* ---------- Types ---------- */

/** Which face of the card to export. */
type CardSide = "front" | "back";

/** Card export variant: trimmed artwork, or bled artwork with crop marks. */
type CardVariant = "digital" | "print";

/** Options accepted by {@link exportCard}. */
interface ExportOptions {
  /** Fully-qualified URL of the card page to capture (without query string). */
  url: string;
  /** Face(s) to export (default: both). */
  sides: CardSide[];
  /** Variant(s) to export (default: both). */
  variants: CardVariant[];
  /** Output directory (default: "public/downloads"). */
  outputDir: string;
}

/* ---------- Dimensions ---------- */

/**
 * Card trim size in millimetres. 90x55 is what NZ and Australian printers quote
 * as standard; the US 3.5x2in card is 88.9x50.8. Change these two numbers and
 * the page CSS (src/app/card/page.tsx) together - the layout is sized in pixels
 * at 300 DPI, so it does not follow this constant on its own.
 */
const TRIM_MM = { width: 90, height: 55 } as const;

/** Bleed added to every edge, in millimetres. The industry-standard 3mm. */
const BLEED_MM = 3 as const;

/** Capture resolution. 300 DPI is the floor every commercial printer asks for. */
const DPI = 300 as const;

/**
 * Converts millimetres to whole CSS pixels at {@link DPI}, rounding up so the
 * captured artwork is never a fraction of a pixel short of the bleed box.
 * @param mm - Length in millimetres.
 * @returns Length in whole pixels.
 */
function mmToPx(mm: number): number {
  return Math.ceil((mm / 25.4) * DPI);
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
 * Builds the page config for one face at one variant.
 *
 * The print variant grows the viewport by the bleed on all four edges; the page
 * itself widens its outer padding to match, so the artwork extends under the
 * trim line instead of the layout simply shrinking.
 * @param side - Which face to render.
 * @param variant - "digital" for trim size, "print" for bleed plus crop marks.
 * @returns The {@link PageConfig} for that combination.
 */
function cardConfig(side: CardSide, variant: CardVariant): PageConfig {
  const bled = variant === "print";
  const pageMm = {
    width: TRIM_MM.width + (bled ? BLEED_MM * 2 : 0),
    height: TRIM_MM.height + (bled ? BLEED_MM * 2 : 0),
  };

  return {
    label: bled
      ? `${side} (print, ${TRIM_MM.width}x${TRIM_MM.height}mm + ${BLEED_MM}mm bleed)`
      : `${side} (digital, ${TRIM_MM.width}x${TRIM_MM.height}mm)`,
    viewport: { width: mmToPx(pageMm.width), height: mmToPx(pageMm.height) },
    pdfSize: { width: mmToPt(pageMm.width), height: mmToPt(pageMm.height) },
    trimSize: { width: mmToPt(TRIM_MM.width), height: mmToPt(TRIM_MM.height) },
    cropMarks: bled,
    filename: bled ? `card-${side}-print.pdf` : `card-${side}.pdf`,
    urlSuffix: bled ? `?side=${side}&mode=print` : `?side=${side}`,
  };
}

/* ---------- Core ---------- */

/**
 * Generates the requested card faces and variants through one browser instance.
 * @param options - Export options (URL, sides, variants, output directory).
 * @returns Promise resolving to the list of generated file paths.
 */
async function exportCard(options: ExportOptions): Promise<string[]> {
  const { url, sides, variants, outputDir } = options;

  console.log(
    `Exporting ${sides.join("/")} ${variants.join("/")} card variant(s) to ${outputDir}...`,
  );

  // Faces outer, variants inner, so a --side=front run reads front-then-print.
  const configs = sides.flatMap((side) => variants.map((variant) => cardConfig(side, variant)));

  return renderVariants(configs, url, outputDir);
}

/* ---------- CLI ---------- */

/** Production card URL (canonical www origin). */
const PROD_URL = "https://www.tothepoint.co.nz/card";

/** Local dev-server card URL. */
const LOCAL_URL = "http://localhost:3000/card";

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
 * - `--side=<value>`       Face to export: "front", "back", or "both" (default: "both").
 * - `--variant=<value>`    Export variant: "digital", "print", or "both" (default: "both").
 * - `--output-dir=<value>` Override output directory (default: "public/downloads").
 * @returns Parsed {@link ExportOptions} ready for {@link exportCard}.
 */
function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  const options: ExportOptions = {
    url: PROD_URL,
    sides: ["front", "back"],
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

    const side = readFlag(args, i, "side");
    if (side) {
      if (side.value === "front" || side.value === "back") {
        options.sides = [side.value];
      } else if (side.value !== "both") {
        console.error(`Invalid side: ${side.value}. Must be "front", "back", or "both".`);
        process.exit(1);
      }
      i += side.consumed;
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
    logSummary(await exportCard(options), startTime);
  } catch (error: unknown) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
