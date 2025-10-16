// scripts/build-icons.ts
// PNG favicons only. Transparent by default; optional fully-opaque seasalt background.

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const PALETTE = {
  seasalt500: "#f6f7f8", // opaque background when requested
  russianViolet500: "#0c0a3e", // light mark
  coquelicot500: "#f34213", // dark mark
} as const;

const LOGO_FAV = "public/logo.svg";
const LOGO_OG = "public/logo-full.svg";
const BACKDROP = "public/backdrop.jpg";

interface IconSpec {
  /** Output base filename without extension. */
  name: string;
  /** Square size of the icon in pixels. */
  size: number;
  /** If true, render with a full-canvas seasalt background; otherwise keep PNG fully transparent. */
  opaque: boolean;
}
const ICON_SPECS: IconSpec[] = [
  { name: "apple-touch-icon", size: 180, opaque: true }, // iOS tile: opaque seasalt
  { name: "android-chrome-192x192", size: 192, opaque: false },
  { name: "android-chrome-512x512", size: 512, opaque: false },
  { name: "favicon-32x32", size: 32, opaque: false },
  { name: "favicon-16x16", size: 16, opaque: false },
];

const ART_VB = 441; // tight art bounds

/**
 * Strip the outer <svg> wrapper and inline path fills so CSS recolouring can apply.
 * @param svgPath Absolute or relative path to the source SVG.
 * @returns Inner SVG markup (paths/groups only) with inline `fill` attributes removed.
 */
async function readInner(svgPath: string): Promise<string> {
  const raw = await fs.readFile(svgPath, "utf8");
  return raw
    .replace(/^[\s\S]*?<svg\b[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")
    .replace(/\sfill="#[0-9a-fA-F]{3,8}"/g, "");
}

/**
 * Build a recoloured, marginless SVG buffer sized to `outSize`.
 * - Transparent mode: no background rect; outside and inside remain transparent.
 * - Opaque mode: full-canvas seasalt rect behind the art.
 * Paths inside `.art` are forced to the provided `markHex`.
 * @param params Object holding render options.
 * @param params.svgPath Path to the original glyph-only SVG.
 * @param params.markHex Hex colour for the mark (paths inside `.art`).
 * @param params.outSize Output square size in pixels (viewBox mapped 1:1).
 * @param params.opaque Whether to draw a full-canvas seasalt background.
 * @returns UTF-8 SVG buffer ready for rasterisation.
 */
async function makeSvgBuf(params: {
  svgPath: string;
  markHex: string;
  outSize: number;
  opaque: boolean;
}): Promise<Buffer> {
  const { svgPath, markHex, outSize, opaque } = params;
  const inner = await readInner(svgPath);

  const style = `
<style><![CDATA[
  g.art path { fill: ${markHex} !important; stroke: ${markHex} !important; }
  g.art path[fill="none"] { fill: none !important; }
  g.art path[stroke="none"] { stroke: none !important; }
]]></style>`.trim();

  const bg = opaque ? `<rect width="100%" height="100%" fill="${PALETTE.seasalt500}"/>` : "";

  const scale = outSize / ART_VB;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outSize} ${outSize}">
  ${style}
  ${bg}
  <g class="art" transform="scale(${scale})">
    ${inner}
  </g>
</svg>`.trim();

  return Buffer.from(svg, "utf8");
}

/**
 * Generate light and dark PNG favicons per {@link ICON_SPECS}.
 * Transparent by default; `opaque: true` entries get a seasalt background.
 * @returns Promise that resolves when all PNGs are written to /public.
 */
async function buildFavicons(): Promise<void> {
  await fs.mkdir("public", { recursive: true });

  // High-res masters per colour mode (transparent)
  const svgLight512 = await makeSvgBuf({
    svgPath: LOGO_FAV,
    markHex: PALETTE.russianViolet500,
    outSize: 512,
    opaque: false,
  });
  const svgDark512 = await makeSvgBuf({
    svgPath: LOGO_FAV,
    markHex: PALETTE.coquelicot500,
    outSize: 512,
    opaque: false,
  });

  const tasks: Array<Promise<unknown>> = [];
  for (const { name, size, opaque } of ICON_SPECS) {
    const lightBuf = opaque
      ? await makeSvgBuf({
          svgPath: LOGO_FAV,
          markHex: PALETTE.russianViolet500,
          outSize: size,
          opaque: true,
        })
      : svgLight512;
    const darkBuf = opaque
      ? await makeSvgBuf({
          svgPath: LOGO_FAV,
          markHex: PALETTE.coquelicot500,
          outSize: size,
          opaque: true,
        })
      : svgDark512;

    tasks.push(
      sharp(lightBuf).resize(size, size).png().toFile(`public/${name}.png`),
      sharp(darkBuf).resize(size, size).png().toFile(`public/${name}-dark.png`),
    );
  }
  await Promise.all(tasks);
}

/**
 * Build a subtle SVG overlay used to keep OG artwork legible.
 * @param w Overlay width in pixels.
 * @param h Overlay height in pixels.
 * @returns SVG buffer for compositing over the blurred photo.
 */
function makeOgOverlay(w: number, h: number): Buffer {
  const svg = `
  <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${PALETTE.seasalt500}" stop-opacity="0.35"/>
        <stop offset="1" stop-color="${PALETTE.coquelicot500}" stop-opacity="0.20"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="${PALETTE.seasalt500}" opacity="0.06"/>
  </svg>`;
  return Buffer.from(svg);
}

/**
 * Generate the Open Graph image at /public/og.jpg using a blurred backdrop,
 * a gradient overlay, and the unmodified logo-full.svg centred.
 * @returns Promise that resolves when og.jpg is written.
 */
async function buildOG(): Promise<void> {
  const OG_W = 1200;
  const OG_H = 630;
  const OG_BLUR_PX = 25;
  const OG_MAX_W_RATIO = 0.95;
  const OG_MAX_H_RATIO = 0.8;

  const bg = await sharp(BACKDROP)
    .resize(OG_W, OG_H, { fit: "cover", position: "centre" })
    .blur(OG_BLUR_PX)
    .toBuffer();

  const overlay = makeOgOverlay(OG_W, OG_H);
  const logoPng = await sharp(LOGO_OG)
    .resize({
      width: Math.round(OG_W * OG_MAX_W_RATIO),
      height: Math.round(OG_H * OG_MAX_H_RATIO),
      fit: "inside",
    })
    .png()
    .toBuffer();

  const meta = await sharp(logoPng).metadata();
  const lw = meta.width ?? Math.round(OG_W * OG_MAX_W_RATIO);
  const lh = meta.height ?? Math.round(OG_H * OG_MAX_H_RATIO);
  const left = Math.round((OG_W - lw) / 2);
  const top = Math.round((OG_H - lh) / 2);

  await sharp(bg)
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: logoPng, left, top },
    ])
    .jpeg({ quality: 90 })
    .toFile("public/og.jpg");
}

/**
 * Verify that required input assets exist before generation.
 * @returns Promise that resolves if all inputs exist; throws with a list otherwise.
 */
async function preflight(): Promise<void> {
  const missing: string[] = [];
  for (const p of [LOGO_FAV, LOGO_OG, BACKDROP]) {
    try {
      await fs.access(p);
    } catch {
      missing.push(p);
    }
  }
  if (missing.length) {
    const cwd = process.cwd();
    const list = missing.map((p) => `- ${path.resolve(cwd, p)}`).join("\n");
    throw new Error(`Required input not found:\n${list}`);
  }
}

/**
 * Orchestrate favicon and OG generation.
 * @returns Promise that resolves on successful completion.
 */
async function main(): Promise<void> {
  await preflight();
  await buildFavicons(); // PNGs only
  await buildOG();
  console.log("PNG favicons generated. Transparent by default; apple-touch-icon opaque seasalt.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
