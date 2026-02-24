// scripts/export-poster-screenshot.ts
/**
 * @file export-poster-screenshot.ts
 * @description Exports the /poster page as a print-ready A5 PDF by screenshotting
 * it via Puppeteer and embedding the result into a pdf-lib document.
 * Run with: npx tsx scripts/export-poster-screenshot.ts [--url=<url>] [--out=<path>]
 */

import fs from "fs";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";

/* ---------- Types ---------- */

/** Options accepted by {@link exportPosterToPDF}. */
interface ExportOptions {
  /** Fully-qualified URL of the poster page to capture. */
  url: string;
  /** File path where the output PDF will be written. */
  output: string;
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
 * 2 = 600 DPI effective (3496 × 4960 px screenshot).
 */
const DEVICE_SCALE_FACTOR = 2 as const;

/** A5 page size in PDF points (1 pt = 1/72 inch). */
const A5_POINTS = { width: 419.53, height: 595.28 } as const;

/* ---------- Core ---------- */

/**
 * Launches a headless browser, navigates to the poster URL, takes a full-page
 * screenshot, and saves the result as a single-page A5 PDF.
 * @param options - Export configuration (URL and output path).
 * @returns Promise that resolves when the PDF has been written to disk.
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
 * - `--local`          Use the local dev server instead of production.
 * - `--url=<value>`    Override the target URL entirely.
 * - `--out=<value>`    Override the output file path (default: `public/downloads/poster.pdf`).
 * @returns Parsed {@link ExportOptions} ready for {@link exportPosterToPDF}.
 */
function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  const options: ExportOptions = {
    url: PROD_URL,
    output: "poster.pdf",
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
    }
  }

  return options;
}

/* ---------- Entry point ---------- */

exportPosterToPDF(parseArgs()).catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
