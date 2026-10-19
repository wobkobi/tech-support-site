// scripts/lib/print-export.ts
// Shared Puppeteer > pdf-lib core for the print exporters: exact-viewport screenshot,
// point-sized PDF page, and ISO 12647 crop marks on bleed variants.

import fs from "fs";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import puppeteer, { type Browser } from "puppeteer";

/* ---------- Types ---------- */

/** Page configuration for one exported variant. */
export interface PageConfig {
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
  /** URL suffix appended to the base page URL (e.g. "?mode=print" > /poster?mode=print). */
  urlSuffix?: string;
  /**
   * URL suffixes rendered in order as the pages of one PDF; replaces `urlSuffix` when set.
   */
  pageSuffixes?: string[];
}

/* ---------- Constants ---------- */

/**
 * Puppeteer device scale factor. 1 = 300 DPI (viewport as-is), 2 = 600 DPI effective.
 */
export const DEVICE_SCALE_FACTOR = 2 as const;

/** Crop mark extension length in PDF points (3mm = 8.5 pt). */
const CROP_MARK_LENGTH_PT = 8.5 as const;

/** Crop mark gap from trim edge in PDF points (ISO 12647: 2mm = 5.67 pt). */
const CROP_MARK_GAP_PT = 5.67 as const;

/** Crop mark stroke thickness in PDF points (0.25 pt). */
const CROP_MARK_THICKNESS_PT = 0.25 as const;

/* ---------- Crop marks ---------- */

/**
 * Adds ISO 12647 L-shaped crop marks at each corner, extending into the bleed. Assumes
 * an even bleed on all edges (derived from the width alone).
 * @param page - pdf-lib PDFPage instance with bleed dimensions.
 * @param trimWidth - Trim box width in points (e.g. 419.53 pt for A5).
 * @internal
 */
function addCropMarks(page: PDFPage, trimWidth: number): void {
  const { width: pageWidth, height: pageHeight } = page.getSize();

  // Calculate bleed margin (distance from page edge to trim edge)
  const bleedMargin = (pageWidth - trimWidth) / 2;

  // Crop mark styling
  const markColor = rgb(0, 0, 0);

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
 * Screenshots one variant into a PDF, one page per `pageSuffixes` entry (or `urlSuffix`).
 * Each page carries a TrimBox and BleedBox for printer preflight.
 * @param browser - Puppeteer browser instance.
 * @param config - Variant configuration (viewport, PDF size, crop marks).
 * @param url - Base URL of the page to screenshot.
 * @param outputDir - Output directory for the PDF file.
 * @returns Promise resolving to the generated file path.
 */
export async function generateVariant(
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

    const pdfDoc = await PDFDocument.create();
    const suffixes = config.pageSuffixes ?? [config.urlSuffix ?? ""];
    const { width: pageW, height: pageH } = config.pdfSize;
    const bleedX = (pageW - config.trimSize.width) / 2;
    const bleedY = (pageH - config.trimSize.height) / 2;

    for (const suffix of suffixes) {
      const targetUrl = url + suffix;
      console.log(`Loading: ${targetUrl}`);

      // Refuse anything but a 2xx, or an error page overwrites good artwork.
      const response = await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 30000 });
      const status = response?.status() ?? 0;
      if (status < 200 || status >= 300) {
        throw new Error(
          `${targetUrl} returned HTTP ${status || "no response"}; not exporting. Is the route deployed? Try --local.`,
        );
      }

      // Hide the dev server's <nextjs-portal> route indicator (no-op on production).
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

      // Allow fonts and lazy assets to finish rendering.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      console.log("Taking screenshot...");

      const screenshot = await page.screenshot({
        type: "png",
        fullPage: false,
        omitBackground: false,
      });

      const pngImage = await pdfDoc.embedPng(screenshot);
      const pdfPage = pdfDoc.addPage([pageW, pageH]);

      pdfPage.drawImage(pngImage, { x: 0, y: 0, width: pageW, height: pageH });
      pdfPage.setBleedBox(0, 0, pageW, pageH);
      pdfPage.setTrimBox(bleedX, bleedY, config.trimSize.width, config.trimSize.height);

      if (config.cropMarks) {
        addCropMarks(pdfPage, config.trimSize.width);
      }
    }

    console.log("Creating PDF...");

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
 * Renders every supplied config through one shared browser instance.
 * @param configs - Variants to export, in order.
 * @param url - Base URL of the page to screenshot.
 * @param outputDir - Output directory for the PDF files.
 * @returns Promise resolving to the list of generated file paths.
 */
export async function renderVariants(
  configs: PageConfig[],
  url: string,
  outputDir: string,
): Promise<string[]> {
  const browser = await puppeteer.launch({
    headless: true,
    // Pin rendering to sRGB so captured hexes match the stylesheet on wide-gamut displays.
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--force-color-profile=srgb"],
  });

  const generatedFiles: string[] = [];

  try {
    for (const config of configs) {
      console.log(`Generating: ${config.label}`);
      generatedFiles.push(await generateVariant(browser, config, url, outputDir));
    }
    return generatedFiles;
  } finally {
    await browser.close();
  }
}

/**
 * Prints the per-file run summary both exporters finish with.
 * @param files - Paths written by {@link renderVariants}.
 * @param startTime - `Date.now()` captured when the run began.
 */
export function logSummary(files: string[], startTime: number): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Export complete (${files.length} file(s), ${elapsed}s)`);
  files.forEach((filepath) => {
    const stats = fs.statSync(filepath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`  - ${filepath} (${sizeMB} MB)`);
  });
}
