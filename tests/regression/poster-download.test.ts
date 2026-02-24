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

describe("Poster Download Regression", () => {
  const posterPath = path.resolve("public/downloads/poster.pdf");

  it("poster PDF exists in public/downloads/", () => {
    const exists = fs.existsSync(posterPath);

    expect(exists).toBe(true);

    if (!exists) {
      throw new Error(
        "Missing poster PDF! Run: npm run build:poster\n" +
          "Then commit: git add public/downloads/poster.pdf",
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
});
