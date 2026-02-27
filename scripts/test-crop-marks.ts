// scripts/test-crop-marks.ts
/**
 * @file test-crop-marks.ts
 * @description Visual test for crop mark implementation.
 * Generates a test PDF with crop marks and a visible trim box outline
 * to validate correct positioning and geometry.
 *
 * Run with: npx tsx scripts/test-crop-marks.ts
 */

import fs from "fs";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";

/* ---------- Constants ---------- */

/** A5 trim size in PDF points (content area). */
const A5_TRIM = { width: 419.53, height: 595.28 } as const;

/** A5 + 3mm bleed page size in PDF points. */
const A5_BLEED = { width: 437.48, height: 612.28 } as const;

/* ---------- Crop Marks Function (copy from export-poster-screenshot.ts) ---------- */

/**
 * Adds ISO 12647 crop marks to a PDF page for print trimming.
 * @param page - The PDF page to add crop marks to.
 * @param trimWidth - Width of the trim area (content safe zone) in points.
 * @param trimHeight - Height of the trim area (content safe zone) in points.
 */
function addCropMarks(page: PDFPage, trimWidth: number, trimHeight: number): void {
  const { width: pageWidth, height: pageHeight } = page.getSize();

  // Calculate bleed margins (distance from page edge to trim edge)
  const bleedMarginX = (pageWidth - trimWidth) / 2;
  const bleedMarginY = (pageHeight - trimHeight) / 2;

  // Crop mark styling
  const markLength = 8.5; // 3mm extension beyond trim edge
  const markThickness = 0.25; // Thin line for precise cutting
  const markColor = rgb(0, 0, 0); // Pure black

  // Gap between mark and trim edge (standard: 2mm = 5.67 pt)
  const markGap = 5.67;

  // --- Top-left corner ---
  page.drawLine({
    start: { x: bleedMarginX - markGap - markLength, y: pageHeight - bleedMarginY },
    end: { x: bleedMarginX - markGap, y: pageHeight - bleedMarginY },
    thickness: markThickness,
    color: markColor,
  });
  page.drawLine({
    start: { x: bleedMarginX, y: pageHeight - bleedMarginY + markGap },
    end: { x: bleedMarginX, y: pageHeight - bleedMarginY + markGap + markLength },
    thickness: markThickness,
    color: markColor,
  });

  // --- Top-right corner ---
  page.drawLine({
    start: { x: pageWidth - bleedMarginX + markGap, y: pageHeight - bleedMarginY },
    end: { x: pageWidth - bleedMarginX + markGap + markLength, y: pageHeight - bleedMarginY },
    thickness: markThickness,
    color: markColor,
  });
  page.drawLine({
    start: { x: pageWidth - bleedMarginX, y: pageHeight - bleedMarginY + markGap },
    end: { x: pageWidth - bleedMarginX, y: pageHeight - bleedMarginY + markGap + markLength },
    thickness: markThickness,
    color: markColor,
  });

  // --- Bottom-left corner ---
  page.drawLine({
    start: { x: bleedMarginX - markGap - markLength, y: bleedMarginY },
    end: { x: bleedMarginX - markGap, y: bleedMarginY },
    thickness: markThickness,
    color: markColor,
  });
  page.drawLine({
    start: { x: bleedMarginX, y: bleedMarginY - markGap - markLength },
    end: { x: bleedMarginX, y: bleedMarginY - markGap },
    thickness: markThickness,
    color: markColor,
  });

  // --- Bottom-right corner ---
  page.drawLine({
    start: { x: pageWidth - bleedMarginX + markGap, y: bleedMarginY },
    end: { x: pageWidth - bleedMarginX + markGap + markLength, y: bleedMarginY },
    thickness: markThickness,
    color: markColor,
  });
  page.drawLine({
    start: { x: pageWidth - bleedMarginX, y: bleedMarginY - markGap - markLength },
    end: { x: pageWidth - bleedMarginX, y: bleedMarginY - markGap },
    thickness: markThickness,
    color: markColor,
  });
}

/* ---------- Test Generator ---------- */

/**
 * Generates a test PDF with crop marks and visual guides.
 * - Red rectangle: bleed area (full page)
 * - Blue rectangle: trim area (content safe zone)
 * - Black crop marks: at trim edges
 */
async function generateTestPDF(): Promise<void> {
  console.log("Generating test PDF with crop marks...");

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A5_BLEED.width, A5_BLEED.height]);

  const bleedMargin = (A5_BLEED.width - A5_TRIM.width) / 2;

  // Draw bleed area (full page) in light red
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A5_BLEED.width,
    height: A5_BLEED.height,
    borderColor: rgb(1, 0, 0),
    borderWidth: 2,
    color: rgb(1, 0.95, 0.95),
  });

  // Draw trim area (content safe zone) in light blue
  page.drawRectangle({
    x: bleedMargin,
    y: bleedMargin,
    width: A5_TRIM.width,
    height: A5_TRIM.height,
    borderColor: rgb(0, 0, 1),
    borderWidth: 2,
    color: rgb(0.95, 0.95, 1),
  });

  // Add crop marks
  addCropMarks(page, A5_TRIM.width, A5_TRIM.height);

  // Add text labels
  page.drawText("Test PDF: Crop Marks Validation", {
    x: bleedMargin + 20,
    y: A5_BLEED.height - bleedMargin - 30,
    size: 16,
    color: rgb(0, 0, 0),
  });

  page.drawText("Red border = Bleed area (154 × 216 mm)", {
    x: bleedMargin + 20,
    y: A5_BLEED.height - bleedMargin - 55,
    size: 10,
    color: rgb(0.5, 0, 0),
  });

  page.drawText("Blue border = Trim area (148 × 210 mm / A5)", {
    x: bleedMargin + 20,
    y: A5_BLEED.height - bleedMargin - 70,
    size: 10,
    color: rgb(0, 0, 0.5),
  });

  page.drawText("Black marks = Cut lines (ISO 12647)", {
    x: bleedMargin + 20,
    y: A5_BLEED.height - bleedMargin - 85,
    size: 10,
    color: rgb(0, 0, 0),
  });

  // Add dimension annotations
  page.drawText(`${A5_BLEED.width.toFixed(1)} pt`, {
    x: A5_BLEED.width / 2 - 30,
    y: 5,
    size: 8,
    color: rgb(1, 0, 0),
  });

  page.drawText(`${A5_BLEED.height.toFixed(1)} pt`, {
    x: 5,
    y: A5_BLEED.height / 2,
    size: 8,
    color: rgb(1, 0, 0),
  });

  // Save PDF
  const pdfBytes = await pdfDoc.save();
  const outputPath = "public/downloads/test-crop-marks.pdf";

  fs.writeFileSync(outputPath, pdfBytes);

  const sizeMB = (pdfBytes.length / 1024).toFixed(1);
  console.log(`✓ Test PDF saved to ${outputPath} (${sizeMB} KB)`);
  console.log("\nValidation checklist:");
  console.log("  1. Open PDF in Adobe Acrobat or Preview");
  console.log("  2. Zoom to 400% and inspect all 4 corners");
  console.log("  3. Verify crop marks are L-shaped at trim edges");
  console.log("  4. Marks should have 2mm gap from blue border");
  console.log("  5. Marks should extend into red bleed area");
  console.log("  6. Check mark thickness is thin but visible");
}

/* ---------- Entry Point ---------- */

generateTestPDF().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
