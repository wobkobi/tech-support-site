/**
 * @file tests/regression/poster-download.test.ts
 * @description Regression test to prevent missing poster PDF bug (S1 critical issue from 2026-02-24)
 *
 * Root Cause: Poster PDF is manually generated (requires Puppeteer + dev server) and must be
 * committed to git. Homepage download link points to /downloads/poster.pdf which was missing,
 * causing 404 errors for users.
 *
 * Prevention: This test ensures poster PDF exists and is valid before deployment.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";

describe("Poster Download Regression", () => {
  const posterPath = path.resolve("public/downloads/poster-a5.pdf");

  it("poster PDF exists in public/downloads/", () => {
    const exists = fs.existsSync(posterPath);

    expect(exists).toBe(true);

    if (!exists) {
      throw new Error(
        "Missing poster PDF! Run: npm run build:poster\n" +
          "Then commit: git add public/downloads/poster-a5.pdf",
      );
    }
  });

  it("poster PDF is not empty (>100KB)", () => {
    const stats = fs.statSync(posterPath);
    const sizeInKB = stats.size / 1024;

    expect(sizeInKB).toBeGreaterThan(100);

    if (sizeInKB < 100) {
      throw new Error(
        `Poster PDF is suspiciously small (${sizeInKB.toFixed(0)}KB). ` +
          "It may be corrupted or incomplete. Regenerate with: npm run build:poster",
      );
    }
  });

  it("poster PDF is a valid PDF file (has PDF magic bytes)", () => {
    const buffer = fs.readFileSync(posterPath);
    const header = buffer.toString("utf8", 0, 4);

    expect(header).toBe("%PDF");

    if (header !== "%PDF") {
      throw new Error(
        "Poster file is not a valid PDF (missing %PDF header). " +
          "Regenerate with: npm run build:poster",
      );
    }
  });

  it("poster PDF has reasonable file size (100KB - 5MB)", () => {
    const stats = fs.statSync(posterPath);
    const sizeInMB = stats.size / (1024 * 1024);

    expect(sizeInMB).toBeGreaterThan(0.1);
    expect(sizeInMB).toBeLessThan(5);

    if (sizeInMB > 5) {
      console.warn(
        `⚠️ Poster PDF is very large (${sizeInMB.toFixed(1)}MB). ` +
          "Consider optimizing image quality in export-poster-screenshot.ts",
      );
    }
  });

  it("poster PDF has correct A5 dimensions (419.53 × 595.28 pt)", async () => {
    const bytes = fs.readFileSync(posterPath);
    const pdfDoc = await PDFDocument.load(new Uint8Array(bytes));
    const page = pdfDoc.getPage(0);
    const { width, height } = page.getSize();

    // A5 dimensions: 148 × 210 mm = 419.53 × 595.28 pt (at 72 DPI)
    const expectedWidth = 419.53;
    const expectedHeight = 595.28;
    const tolerance = 1; // ±1 pt

    expect(width).toBeGreaterThanOrEqual(expectedWidth - tolerance);
    expect(width).toBeLessThanOrEqual(expectedWidth + tolerance);
    expect(height).toBeGreaterThanOrEqual(expectedHeight - tolerance);
    expect(height).toBeLessThanOrEqual(expectedHeight + tolerance);

    if (
      Math.abs(width - expectedWidth) > tolerance ||
      Math.abs(height - expectedHeight) > tolerance
    ) {
      throw new Error(
        `Poster PDF dimensions are incorrect: ${width.toFixed(2)} × ${height.toFixed(2)} pt. ` +
          `Expected: ${expectedWidth} × ${expectedHeight} pt (A5). ` +
          "Regenerate with: npm run build:poster",
      );
    }
  });
});

describe("Print Poster Regression", () => {
  const printPosterPath = path.resolve("public/downloads/poster-a5-print.pdf");

  it("print poster PDF exists in public/downloads/", () => {
    const exists = fs.existsSync(printPosterPath);

    expect(exists).toBe(true);

    if (!exists) {
      throw new Error(
        "Missing print poster PDF! Run: npm run build:poster\n" +
          "Then commit: git add public/downloads/poster-a5-print.pdf",
      );
    }
  });

  it("print poster PDF is not empty (>100KB)", () => {
    const stats = fs.statSync(printPosterPath);
    const sizeInKB = stats.size / 1024;

    expect(sizeInKB).toBeGreaterThan(100);

    if (sizeInKB < 100) {
      throw new Error(
        `Print poster PDF is suspiciously small (${sizeInKB.toFixed(0)}KB). ` +
          "It may be corrupted or incomplete. Regenerate with: npm run build:poster",
      );
    }
  });

  it("print poster PDF is a valid PDF file (has PDF magic bytes)", () => {
    const buffer = fs.readFileSync(printPosterPath);
    const header = buffer.toString("utf8", 0, 4);

    expect(header).toBe("%PDF");

    if (header !== "%PDF") {
      throw new Error(
        "Print poster file is not a valid PDF (missing %PDF header). " +
          "Regenerate with: npm run build:poster",
      );
    }
  });

  it("print poster PDF has reasonable file size (100KB - 10MB)", () => {
    const stats = fs.statSync(printPosterPath);
    const sizeInMB = stats.size / (1024 * 1024);

    expect(sizeInMB).toBeGreaterThan(0.1);
    expect(sizeInMB).toBeLessThan(10);

    if (sizeInMB > 10) {
      console.warn(
        `⚠️ Print poster PDF is very large (${sizeInMB.toFixed(1)}MB). ` +
          "Consider sending via file transfer service instead of email.",
      );
    }
  });

  it("print poster PDF has correct A5+bleed dimensions (437.48 × 612.28 pt)", async () => {
    const bytes = fs.readFileSync(printPosterPath);
    const pdfDoc = await PDFDocument.load(new Uint8Array(bytes));
    const page = pdfDoc.getPage(0);
    const { width, height } = page.getSize();

    // A5 + 3mm bleed: 154 × 216 mm = 437.48 × 612.28 pt (at 72 DPI)
    const expectedWidth = 437.48;
    const expectedHeight = 612.28;
    const tolerance = 1; // ±1 pt

    expect(width).toBeGreaterThanOrEqual(expectedWidth - tolerance);
    expect(width).toBeLessThanOrEqual(expectedWidth + tolerance);
    expect(height).toBeGreaterThanOrEqual(expectedHeight - tolerance);
    expect(height).toBeLessThanOrEqual(expectedHeight + tolerance);

    if (
      Math.abs(width - expectedWidth) > tolerance ||
      Math.abs(height - expectedHeight) > tolerance
    ) {
      throw new Error(
        `Print poster PDF dimensions are incorrect: ${width.toFixed(2)} × ${height.toFixed(2)} pt. ` +
          `Expected: ${expectedWidth} × ${expectedHeight} pt (A5 + 3mm bleed). ` +
          "Regenerate with: npm run build:poster",
      );
    }
  });
});
