// scripts/build-icons/helpers.ts
/**
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
 * Create a frosted white card/box SVG centred on the canvas (like the website's cards).
 * Near-white frosted card like the website's cards (60% opacity #fcfcfc).
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
 * @returns Modified SVG buffer with coquelicot colour.
 */
export async function makeCoquelicotSvg(svgBuffer: Buffer): Promise<Buffer> {
  let svgString = svgBuffer.toString("utf-8");

  // Replace all near-#0C0A3E (russian-violet) hex codes the SVG exporter
  // rounds to. Matches the deep-navy range (R: 0A-0C, G: 08-0A, B: 39-3F) so a
  // future re-export with slightly different rounding (e.g. #0B093D)
  // still gets swapped without needing another entry here.
  svgString = svgString.replace(/#0[ABC]0[89A]3[9A-F]/gi, PALETTE.coquelicot500);

  // Guard against a silent no-op: if the source logo is ever re-exported with a
  // navy hex outside the range above, nothing gets swapped and the dark-mode
  // favicon would ship still-navy. Fail loudly instead.
  if (!svgString.toLowerCase().includes(PALETTE.coquelicot500.toLowerCase())) {
    throw new Error(
      `makeCoquelicotSvg: no navy fill matched - the source logo hex is outside ` +
        `the expected range, so the dark-mode swap produced no change.`,
    );
  }

  return Buffer.from(svgString, "utf-8");
}
