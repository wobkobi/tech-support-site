// scripts/export-poster-screenshot.ts
// Exports the /poster page as a print-ready A5 PDF by screenshotting it via Puppeteer and
// embedding the result into a pdf-lib document. The capture, PDF assembly and crop marks
// live in scripts/lib/print-export.ts, shared with the business card exporter; this file
// owns the poster's page sizes and CLI.
// Run with: npx tsx scripts/export-poster-screenshot.ts [--url=<url>] [--variant=<v>] [--output-dir=<dir>] [--format=a5|a4]

import { logSummary, renderVariants, type PageConfig } from "./lib/print-export.js";

/* ---------- Types ---------- */

/** Poster page format. */
type PosterFormat = "a5" | "a4";

/** Options accepted by {@link exportPoster}. */
interface ExportOptions {
  /** Fully-qualified URL of the poster page to capture. */
  url: string;
  /** Poster variant(s) to export (default: "both"). */
  variant?: PosterVariant;
  /** Output directory (default: "public/downloads"). */
  outputDir?: string;
  /** Page format (default: "a5"). */
  format?: PosterFormat;
}

/** Poster export variant. */
type PosterVariant = "digital" | "print" | "both";

/* ---------- Page configs ---------- */

/** Configuration for digital variant (A5, no bleed). */
const A5_DIGITAL_CONFIG: PageConfig = {
  label: "Digital (A5)",
  viewport: { width: 1748, height: 2480 },
  pdfSize: { width: 419.53, height: 595.28 },
  trimSize: { width: 419.53, height: 595.28 },
  cropMarks: false,
  filename: "poster-a5.pdf",
} as const;

/** Configuration for print variant (A5 + 3mm bleed). */
const A5_PRINT_CONFIG: PageConfig = {
  label: "Print (A5 + 3mm bleed)",
  // 3 mm bleed at 300 DPI ≈ 35.43 px per side > 1748 + 2×35.43 ≈ 1818.86
  // and 2480 + 2×35.43 ≈ 2550.86, rounded up to whole pixels: 1819×2551.
  viewport: { width: 1819, height: 2551 },
  pdfSize: { width: 436.53, height: 612.28 },
  trimSize: { width: 419.53, height: 595.28 },
  cropMarks: true,
  filename: "poster-a5-print.pdf",
  urlSuffix: "?mode=print",
} as const;

/** Configuration for digital variant (A4, no bleed). */
const A4_DIGITAL_CONFIG: PageConfig = {
  label: "Digital (A4)",
  viewport: { width: 2480, height: 3508 },
  pdfSize: { width: 595.28, height: 841.89 },
  trimSize: { width: 595.28, height: 841.89 },
  cropMarks: false,
  filename: "poster-a4.pdf",
} as const;

/** Configuration for print variant (A4 + 3mm bleed). */
const A4_PRINT_CONFIG: PageConfig = {
  label: "Print (A4 + 3mm bleed)",
  viewport: { width: 2551, height: 3579 },
  pdfSize: { width: 612.28, height: 858.89 },
  trimSize: { width: 595.28, height: 841.89 },
  cropMarks: true,
  filename: "poster-a4-print.pdf",
  urlSuffix: "?mode=print",
} as const;

/* ---------- Core ---------- */

/**
 * Generates poster variant(s) with browser instance reuse.
 * @param options - Export options (URL, variant, output directory, format).
 * @returns Promise resolving to list of generated file paths.
 */
async function exportPoster(options: ExportOptions): Promise<string[]> {
  const { url, outputDir: outDir = "public/downloads", variant = "both", format = "a5" } = options;

  console.log(`Exporting ${format.toUpperCase()} ${variant} variant(s) to ${outDir}...`);

  // Select configs based on format
  const digitalConfig = format === "a4" ? A4_DIGITAL_CONFIG : A5_DIGITAL_CONFIG;
  const printConfig = format === "a4" ? A4_PRINT_CONFIG : A5_PRINT_CONFIG;

  // Determine which configs to generate
  const configs: PageConfig[] = [];
  if (variant === "digital" || variant === "both") {
    configs.push(digitalConfig);
  }
  if (variant === "print" || variant === "both") {
    configs.push(printConfig);
  }

  return renderVariants(configs, url, outDir);
}

/* ---------- CLI ---------- */

/** Production poster URL (canonical www origin). */
const PROD_URL = "https://www.tothepoint.co.nz/poster";

/** Local dev-server poster URL. */
const LOCAL_URL = "http://localhost:3000/poster";

/**
 * Parses CLI flags from `process.argv`.
 *
 * Flags:
 * - `--local`              Use the local dev server instead of production.
 * - `--url=<value>`        Override the target URL entirely.
 * - `--variant=<value>`    Export variant: "digital", "print", or "both" (default: "both").
 * - `--output-dir=<value>` Override output directory (default: "public/downloads").
 * - `--format=<value>`     Page format: "a5" or "a4" (default: "a5").
 * @returns Parsed {@link ExportOptions} ready for {@link exportPoster}.
 */
function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  const options: ExportOptions = {
    url: PROD_URL,
    variant: "both",
    outputDir: "public/downloads",
    format: "a5",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--local") {
      options.url = LOCAL_URL;
    } else if (arg.startsWith("--url=")) {
      options.url = arg.substring(6);
    } else if (arg === "--url" && args[i + 1]) {
      options.url = args[++i];
    } else if (arg.startsWith("--variant=")) {
      const variant = arg.substring(10) as PosterVariant;
      if (["digital", "print", "both"].includes(variant)) {
        options.variant = variant;
      } else {
        console.error(`Invalid variant: ${variant}. Must be "digital", "print", or "both".`);
        process.exit(1);
      }
    } else if (arg === "--variant" && args[i + 1]) {
      const variant = args[++i] as PosterVariant;
      if (["digital", "print", "both"].includes(variant)) {
        options.variant = variant;
      } else {
        console.error(`Invalid variant: ${variant}. Must be "digital", "print", or "both".`);
        process.exit(1);
      }
    } else if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.substring(13);
    } else if (arg === "--output-dir" && args[i + 1]) {
      options.outputDir = args[++i];
    } else if (arg.startsWith("--format=")) {
      const format = arg.substring(9) as PosterFormat;
      if (["a5", "a4"].includes(format)) {
        options.format = format;
      } else {
        console.error(`Invalid format: ${format}. Must be "a5" or "a4".`);
        process.exit(1);
      }
    } else if (arg === "--format" && args[i + 1]) {
      const format = args[++i] as PosterFormat;
      if (["a5", "a4"].includes(format)) {
        options.format = format;
      } else {
        console.error(`Invalid format: ${format}. Must be "a5" or "a4".`);
        process.exit(1);
      }
    }
  }

  return options;
}

/* ---------- Entry point ---------- */

(async () => {
  const startTime = Date.now();
  const options = parseArgs();

  try {
    logSummary(await exportPoster(options), startTime);
  } catch (error: unknown) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
