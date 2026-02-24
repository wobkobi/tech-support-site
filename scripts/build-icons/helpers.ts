// scripts/build-icons/helpers.ts
/**
 * @file helpers.ts
 * @description Helper functions for image manipulation during icon generation.
 */

import fs from "node:fs/promises";
import { PALETTE } from "./config.js";

/**
 * Ensure output directory exists.
 * @param dir - Directory path to create.
 * @returns Promise that resolves when directory exists.
 */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Create a frosted white card/box SVG centered on the canvas (like the website's cards).
 * Matches the website's bg-seasalt-800/60 style (60% opacity #fcfcfc).
 * @param w - Canvas width in pixels.
 * @param h - Canvas height in pixels.
 * @param logoScale - Scale factor of the logo (to size the card appropriately).
 * @returns SVG buffer.
 */
export function makeFrostedCard(w: number, h: number, logoScale: number): Buffer {
  // Card should be slightly larger than the logo with minimal padding
  const cardWidth = Math.round(w * logoScale * 1.05);
  const cardHeight = Math.round(h * logoScale * 1.05);
  const cardX = Math.round((w - cardWidth) / 2);
  const cardY = Math.round((h - cardHeight) / 2);
  const borderRadius = Math.max(16, Math.round(cardWidth * 0.03));

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="${borderRadius}" fill="${PALETTE.seasalt800}" opacity="0.6"/>
</svg>`);
}

/**
 * Replace Russian Violet with Coquelicot in SVG for dark mode.
 * @param svgBuffer - Original SVG buffer.
 * @returns Modified SVG buffer with coquelicot color.
 */
export async function makeCoquelicotSvg(svgBuffer: Buffer): Promise<Buffer> {
  let svgString = svgBuffer.toString("utf-8");

  // Replace all variations of Russian Violet with Coquelicot
  svgString = svgString
    .replace(/#0B093B/gi, PALETTE.coquelicot500)
    .replace(/#0B093C/gi, PALETTE.coquelicot500)
    .replace(/#0C0A3B/gi, PALETTE.coquelicot500)
    .replace(/#0B0939/gi, PALETTE.coquelicot500)
    .replace(/#0B093A/gi, PALETTE.coquelicot500)
    .replace(/#0A0939/gi, PALETTE.coquelicot500)
    .replace(/#0A093A/gi, PALETTE.coquelicot500);

  return Buffer.from(svgString, "utf-8");
}
