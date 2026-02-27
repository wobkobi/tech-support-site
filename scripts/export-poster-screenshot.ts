// scripts/export-poster-screenshot.ts
/**
 * @file export-poster-screenshot.ts
 * @description Exports the /poster page as a print-ready A5 PDF by screenshotting
 * it via Puppeteer and embedding the result into a pdf-lib document.
 * Run with: npx tsx scripts/export-poster-screenshot.ts [--url=<url>] [--out=<path>]
 */

import fs from "fs";
import puppeteer, { type Browser } from "puppeteer";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";

/* ---------- Types ---------- */

/** Poster page format. */
type PosterFormat = "a5" | "a4";

/** Options accepted by {@link exportPosterToPDF}. */
interface ExportOptions {
  /** Fully-qualified URL of the poster page to capture. */
  url: string;
  /** File path where the output PDF will be written. */
  output: string;
  /** Poster variant(s) to export (default: "both"). */
  variant?: PosterVariant;
  /** Output directory (default: "public/downloads"). */
  outputDir?: string;
  /** Page format (default: "a5"). */
  format?: PosterFormat;
}

/** Poster export variant. */
type PosterVariant = "digital" | "print" | "both";

/** Page configuration for a poster variant. */
interface PageConfig {
  /** Human-readable label. */
  label: string;
  /** CSS viewport dimensions (px). */
  viewport: { width: number; height: number };
  /** PDF page dimensions (pt). */
  pdfSize: { width: number; height: number };
  /** Trim box dimensions (pt) - content area without bleed. */
  trimSize: { width: number; height: number };
  /** Whether to add crop marks. */
  cropMarks: boolean;
  /** Output file name. */
  filename: string;
  /** URL suffix appended to the base poster URL (e.g. "?mode=print" → /poster?mode=print). */
  urlSuffix?: string;
}

/* ---------- Constants ---------- */

/**
 * A5 CSS viewport at 300 DPI (148 mm × 210 mm → 1748 px × 2480 px).
 * Combined with {@link DEVICE_SCALE_FACTOR} the captured screenshot is
 * 1748×SCALE × 2480×SCALE px, equivalent to 300×SCALE DPI.
 */
const A5_VIEWPORT = { width: 1748, height: 2480 } as const;

/**
 * Puppeteer device scale factor (CSS pixel → physical pixel multiplier).
 * 1 = 300 DPI (captures 1748 × 2480 px as-is).
 * 2 = 600 DPI effective (3496 × 4960 px screenshot).
 */
const DEVICE_SCALE_FACTOR = 1 as const;

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
  viewport: { width: 1818, height: 2550 },
  pdfSize: { width: 437.48, height: 612.28 },
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
  viewport: { width: 2550, height: 3579 },
  pdfSize: { width: 612.28, height: 858.9 },
  trimSize: { width: 595.28, height: 841.89 },
  cropMarks: true,
  filename: "poster-a4-print.pdf",
  urlSuffix: "?mode=print",
} as const;

/** A5 page size in PDF points (1 pt = 1/72 inch). */
const A5_POINTS = { width: 419.53, height: 595.28 } as const;

/** Crop mark extension length in PDF points (3mm = 8.5 pt). */
const CROP_MARK_LENGTH_PT = 8.5 as const;

/** Crop mark gap from trim edge in PDF points (ISO 12647: 2mm = 5.67 pt). */
const CROP_MARK_GAP_PT = 5.67 as const;

/** Crop mark stroke thickness in PDF points (0.25 pt). */
const CROP_MARK_THICKNESS_PT = 0.25 as const;

/* ---------- Core ---------- */

/**
 * Adds ISO 12647 crop marks to a PDF page for print trimming.
 *
 * Draws L-shaped trim marks at all four corners of the content area.
 * Marks are positioned at the trim edge (3mm inward from page edge)
 * and extend outward into the bleed area.
 * Used for print-ready PDFs to guide trimming after printing.
 * @param page pdf-lib PDFPage instance with bleed dimensions.
 * @param trimWidth Width of the trim box in points — the intended content width after trimming (e.g. 419.53 pt for A5).
 * @example
 * ```typescript
 * const page = pdfDoc.addPage([437.48, 612.28]); // A5 + bleed
 * addCropMarks(page, 419.53); // A5 trim width in points
 * ```
 * @internal
 */
function addCropMarks(page: PDFPage, trimWidth: number): void {
  const { width: pageWidth, height: pageHeight } = page.getSize();

  // Calculate bleed margin (distance from page edge to trim edge)
  const bleedMargin = (pageWidth - trimWidth) / 2;

  // Crop mark styling
  const markColor = rgb(0, 0, 0); // Pure black

  // --- Top-left corner ---
  // Horizontal mark (extends left from trim edge)
  page.drawLine({
    start: { x: bleedMargin - CROP_MARK_GAP_PT - CROP_MARK_LENGTH_PT, y: pageHeight - bleedMargin },
    end: { x: bleedMargin - CROP_MARK_GAP_PT, y: pageHeight - bleedMargin },
    thickness: CROP_MARK_THICKNESS_PT,
    color: markColor,
  });
  // Vertical mark (extends up from trim edge)
  page.drawLine({
    start: { x: bleedMargin, y: pageHeight - bleedMargin + CROP_MARK_GAP_PT },
    end: { x: bleedMargin, y: pageHeight - bleedMargin + CROP_MARK_GAP_PT + CROP_MARK_LENGTH_PT },
    thickness: CROP_MARK_THICKNESS_PT,
    color: markColor,
  });

  // --- Top-right corner ---
  // Horizontal mark (extends right from trim edge)
  page.drawLine({
    start: { x: pageWidth - bleedMargin + CROP_MARK_GAP_PT, y: pageHeight - bleedMargin },
    end: {
      x: pageWidth - bleedMargin + CROP_MARK_GAP_PT + CROP_MARK_LENGTH_PT,
      y: pageHeight - bleedMargin,
    },
    thickness: CROP_MARK_THICKNESS_PT,
    color: markColor,
  });
  // Vertical mark (extends up from trim edge)
  page.drawLine({
    start: { x: pageWidth - bleedMargin, y: pageHeight - bleedMargin + CROP_MARK_GAP_PT },
    end: {
      x: pageWidth - bleedMargin,
      y: pageHeight - bleedMargin + CROP_MARK_GAP_PT + CROP_MARK_LENGTH_PT,
    },
    thickness: CROP_MARK_THICKNESS_PT,
    color: markColor,
  });

  // --- Bottom-left corner ---
  // Horizontal mark (extends left from trim edge)
  page.drawLine({
    start: { x: bleedMargin - CROP_MARK_GAP_PT - CROP_MARK_LENGTH_PT, y: bleedMargin },
    end: { x: bleedMargin - CROP_MARK_GAP_PT, y: bleedMargin },
    thickness: CROP_MARK_THICKNESS_PT,
    color: markColor,
  });
  // Vertical mark (extends down from trim edge)
  page.drawLine({
    start: { x: bleedMargin, y: bleedMargin - CROP_MARK_GAP_PT - CROP_MARK_LENGTH_PT },
    end: { x: bleedMargin, y: bleedMargin - CROP_MARK_GAP_PT },
    thickness: CROP_MARK_THICKNESS_PT,
    color: markColor,
  });

  // --- Bottom-right corner ---
  // Horizontal mark (extends right from trim edge)
  page.drawLine({
    start: { x: pageWidth - bleedMargin + CROP_MARK_GAP_PT, y: bleedMargin },
    end: { x: pageWidth - bleedMargin + CROP_MARK_GAP_PT + CROP_MARK_LENGTH_PT, y: bleedMargin },
    thickness: CROP_MARK_THICKNESS_PT,
    color: markColor,
  });
  // Vertical mark (extends down from trim edge)
  page.drawLine({
    start: { x: pageWidth - bleedMargin, y: bleedMargin - CROP_MARK_GAP_PT - CROP_MARK_LENGTH_PT },
    end: { x: pageWidth - bleedMargin, y: bleedMargin - CROP_MARK_GAP_PT },
    thickness: CROP_MARK_THICKNESS_PT,
    color: markColor,
  });
}

/* ---------- Core ---------- */

/**
 * Generates a single poster variant (digital or print).
 * @param browser - Puppeteer browser instance.
 * @param config - Variant configuration (viewport, PDF size, crop marks).
 * @param url - URL of the poster page to screenshot.
 * @param outputDir - Output directory for the PDF file.
 * @returns Promise resolving to the generated file path.
 */
async function generateVariant(
  browser: Browser,
  config: PageConfig,
  url: string,
  outputDir: string,
): Promise<string> {
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: config.viewport.width,
      height: config.viewport.height,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });

    const targetUrl = config.urlSuffix ? url + config.urlSuffix : url;
    console.log(`Loading: ${targetUrl}`);

    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 30000 });

    // Allow fonts and lazy assets to finish rendering.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log("Taking screenshot...");

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
      omitBackground: false,
    });

    console.log("Creating PDF...");

    const pdfDoc = await PDFDocument.create();
    const pngImage = await pdfDoc.embedPng(screenshot);
    const pdfPage = pdfDoc.addPage([config.pdfSize.width, config.pdfSize.height]);

    pdfPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: config.pdfSize.width,
      height: config.pdfSize.height,
    });

    // Add crop marks for print variant
    if (config.cropMarks) {
      addCropMarks(pdfPage, config.trimSize.width);
    }

    const pdfBytes = await pdfDoc.save();
    const outputPath = `${outputDir}/${config.filename}`;
    fs.writeFileSync(outputPath, pdfBytes);

    console.log(`✓ ${config.label} saved to ${outputPath}`);

    return outputPath;
  } finally {
    await page.close();
  }
}

/**
 * Generates poster variant(s) with browser instance reuse.
 * Launches a single browser and generates selected variant(s).
 * @param options - Export options (URL, variant, output directory, format).
 * @returns Promise resolving to list of generated file paths.
 */
async function exportPoster(options: ExportOptions): Promise<string[]> {
  const { url, outputDir: outDir = "public/downloads", variant = "both", format = "a5" } = options;

  console.log(`Exporting ${format.toUpperCase()} ${variant} variant(s) to ${outDir}...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const generatedFiles: string[] = [];

  try {
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

    // Generate each variant
    for (const config of configs) {
      console.log(`Generating: ${config.label}`);
      const filepath = await generateVariant(browser, config, url, outDir);
      generatedFiles.push(filepath);
    }

    return generatedFiles;
  } finally {
    await browser.close();
  }
}

/**
 * Launches a headless browser, navigates to the poster URL, takes a full-page
 * screenshot, and saves the result as a single-page A5 PDF.
 * @param options - Export configuration (URL and output path).
 * @returns Promise that resolves when the PDF has been written to disk.
 * @deprecated Use generateVariant with PageConfig instead.
 */
async function exportPosterToPDF(options: ExportOptions): Promise<void> {
  const { url, output } = options;

  console.log(`Exporting ${url} to ${output}...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: A5_VIEWPORT.width,
      height: A5_VIEWPORT.height,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });

    console.log(`Loading: ${url}`);

    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });

    // Allow fonts and lazy assets to finish rendering.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log("Taking screenshot...");

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
      omitBackground: false,
    });

    console.log("Creating PDF...");

    const pdfDoc = await PDFDocument.create();
    const pngImage = await pdfDoc.embedPng(screenshot);
    const pdfPage = pdfDoc.addPage([A5_POINTS.width, A5_POINTS.height]);

    pdfPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: A5_POINTS.width,
      height: A5_POINTS.height,
    });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(output, pdfBytes);

    console.log(`✓ PDF saved to ${output}`);
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

/* ---------- CLI ---------- */

/** Production poster URL. */
const PROD_URL = "https://tothepoint.co.nz/poster";

/** Local dev-server poster URL. */
const LOCAL_URL = "http://localhost:3000/poster";

/**
 * Parses CLI flags from `process.argv`.
 *
 * Flags:
 * - `--local`              Use the local dev server instead of production.
 * - `--url=<value>`        Override the target URL entirely.
 * - `--out=<value>`        Override the output file path (default: `public/downloads/poster.pdf`).
 * - `--variant=<value>`    Export variant: "digital", "print", or "both" (default: "both").
 * - `--output-dir=<value>` Override output directory (default: "public/downloads").
 * - `--format=<value>`     Page format: "a5" or "a4" (default: "a5").
 * @returns Parsed {@link ExportOptions} ready for {@link exportPosterToPDF}.
 */
function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  const options: ExportOptions = {
    url: PROD_URL,
    output: "public/downloads/poster.pdf",
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
    } else if (arg.startsWith("--out=")) {
      options.output = arg.substring(6);
    } else if (arg === "--out" && args[i + 1]) {
      options.output = args[++i];
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
    const files = await exportPoster(options);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n✓ Export complete (${files.length} file(s), ${elapsed}s)`);
    files.forEach((filepath) => {
      const stats = fs.statSync(filepath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`  - ${filepath} (${sizeMB} MB)`);
    });
  } catch (error: unknown) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
