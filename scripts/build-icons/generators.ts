// scripts/build-icons/generators.ts
/**
 * @file generators.ts
 * @description Generator functions for favicons, social images, additional assets, QR codes, and manifests.
 */

import { JSDOM } from "jsdom";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import pngToIco from "png-to-ico";
import sharp from "sharp";
import {
  ADDITIONAL_ASSETS,
  BACKDROP,
  BACKDROP_VARIANTS,
  FAVICON_SPECS,
  LOGO_FULL,
  LOGO_MARK,
  LOGO_PROFILE,
  PALETTE,
  QR_CODE_SPECS,
  SOCIAL_SPECS,
} from "./config.js";
import { ensureDir, makeCoquelicotSvg, makeFrostedCard } from "./helpers.js";

// Opaque background colours used by the favicon renderer.
const BG_LIGHT = { r: 246, g: 247, b: 248, alpha: 1 } as const; // seasalt
const BG_DARK = { r: 0, g: 21, b: 20, alpha: 1 } as const; // rich-black

// qr-code-styling is a CommonJS module; load it via dynamic import.
const QRCodeStylingModule = await import("qr-code-styling");
const QRCodeStyling = QRCodeStylingModule.default;

// Load the native Canvas addon via CJS require to avoid ERR_INTERNAL_ASSERTION
// in Node.js v22 when the ESM loader attempts to wrap native bindings directly.
const canvas = createRequire(import.meta.url)("canvas") as typeof import("canvas");

/* ---------- Favicon Generation ---------- */

/**
 * Render a single favicon variant from an SVG logo buffer.
 *
 * - `opaque: false` > resize logo to fill the canvas (transparent passthrough).
 * - `opaque: true` > composite logo onto a coloured background at `logoScale`.
 * @param logoSvg - SVG source buffer (light or dark colour variant).
 * @param size - Output square size in pixels.
 * @param opaque - Whether to render on an opaque background.
 * @param background - Background colour (used when `opaque` is true).
 * @param logoScale - Logo size as fraction of canvas (used when `opaque`).
 * @returns PNG buffer.
 */
async function renderFavicon(
  logoSvg: Buffer,
  size: number,
  opaque: boolean,
  background: sharp.Color,
  logoScale: number,
): Promise<Buffer> {
  if (!opaque) {
    return sharp(logoSvg).resize(size, size).png().toBuffer();
  }
  const logo = await sharp(logoSvg)
    .resize(Math.round(size * logoScale), Math.round(size * logoScale))
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toBuffer();
}

/**
 * Build all favicon variations and the multi-resolution favicon.ico.
 *
 * Each spec produces a light PNG. Specs flagged `hasDarkVariant` also produce
 * a `-dark.png`. Maskable specs use a smaller logo scale (80%) so the safe
 * zone survives Android's circle/squircle/rounded-square crop.
 * @returns Promise that resolves when all favicons are generated.
 */
export async function buildFavicons(): Promise<void> {
  console.log("🎨 Building favicons...");
  await ensureDir("public");

  const lightSvg = await fs.readFile(LOGO_MARK);
  const darkSvg = await makeCoquelicotSvg(lightSvg);

  for (const { name, size, opaque, hasDarkVariant, maskable } of FAVICON_SPECS) {
    // Maskable icons need a 10% safe zone on all sides (logo at 80% of canvas).
    // Other opaque icons use 85% to match the existing visual padding.
    const logoScale = maskable ? 0.8 : 0.85;

    const lightBuf = await renderFavicon(lightSvg, size, opaque, BG_LIGHT, logoScale);
    await fs.writeFile(`public/${name}.png`, lightBuf);

    if (hasDarkVariant) {
      const darkBuf = await renderFavicon(darkSvg, size, opaque, BG_DARK, logoScale);
      await fs.writeFile(`public/${name}-dark.png`, darkBuf);
    }

    console.log(`  ✓ ${name} (${size}x${size})${hasDarkVariant ? " + dark" : ""}`);
  }

  // Multi-resolution .ico (16/32/48) so the OS picks the sharpest size per
  // context - a single 32x32 PNG renders blurry in the Windows taskbar.
  const ico16 = await sharp(lightSvg).resize(16, 16).png().toBuffer();
  const ico32 = await sharp(lightSvg).resize(32, 32).png().toBuffer();
  const ico48 = await sharp(lightSvg).resize(48, 48).png().toBuffer();
  const icoBuffer = await pngToIco([ico16, ico32, ico48]);
  await fs.writeFile("public/favicon.ico", icoBuffer);
  console.log("  ✓ favicon.ico (16 + 32 + 48 multi-res)");
}

/* ---------- SVG Favicon ---------- */

/**
 * Build favicon.svg with embedded prefers-color-scheme styling.
 *
 * The injected CSS overrides the source SVG's inline `fill` attributes
 * because in SVG, `fill="..."` is a presentation attribute and any matching
 * CSS rule wins (no `!important` needed). Modern browsers prefer SVG
 * favicons over PNGs and handle dark mode natively in a single file.
 * @returns Promise that resolves when favicon.svg is written.
 */
export async function buildFaviconSvg(): Promise<void> {
  console.log("🖼️  Building favicon.svg (with dark-mode CSS)...");
  const svg = await fs.readFile(LOGO_MARK, "utf-8");

  const styleBlock = `<style>
    path, rect, circle, ellipse, line, polyline, polygon, text {
      fill: ${PALETTE.russianViolet500};
    }
    @media (prefers-color-scheme: dark) {
      path, rect, circle, ellipse, line, polyline, polygon, text {
        fill: ${PALETTE.coquelicot500};
      }
    }
  </style>`;

  // Inject the style block then strip inline `fill="#hex"` from children.
  // Without the strip, inline fills paint first - a "blue flash" before the
  // CSS dark-mode swap kicks in.
  const withStyle = svg.replace(/<svg([^>]*)>/, `<svg$1>${styleBlock}`);

  if (withStyle === svg) {
    throw new Error("favicon.svg generation: opening <svg> tag not found in source");
  }

  const styled = withStyle.replace(/\s+fill="#[0-9A-Fa-f]{3,8}"/g, "");

  await fs.writeFile("public/favicon.svg", styled, "utf-8");
  console.log("  ✓ favicon.svg");
}

/* ---------- Social Image Generation ---------- */

/**
 * Build all social media images (OG, Twitter, Facebook, etc.).
 * @returns Promise that resolves when all social images are generated.
 */
export async function buildSocialImages(): Promise<void> {
  console.log("📱 Building social images...");
  await ensureDir("public");

  // Read logos used by social specs
  const logoFullBuffer = await fs.readFile(LOGO_FULL);
  const logoProfileBuffer = await fs.readFile(LOGO_PROFILE);

  for (const spec of SOCIAL_SPECS) {
    const { name, width, height, blur, logoScale, quality, useMarkLogo, copyTo } = spec;

    // Create blurred background
    const bg = await sharp(BACKDROP)
      .resize(width, height, { fit: "cover", position: "centre" })
      .blur(blur)
      .toBuffer();

    // Create frosted card box
    const frostedCard = await sharp(makeFrostedCard(width, height, logoScale))
      .resize(width, height)
      .png()
      .toBuffer();

    // Select logo - use profile logo for profile pictures, otherwise use mark or full
    const logoSource = useMarkLogo ? logoProfileBuffer : logoFullBuffer;

    // Resize logo to fit
    const logo = await sharp(logoSource)
      .resize({
        width: Math.round(width * logoScale),
        height: Math.round(height * logoScale),
        fit: "inside",
      })
      .png()
      .toBuffer();

    // Composite all layers: blur, then frosted card, then logo
    await sharp(bg)
      .composite([{ input: frostedCard }, { input: logo, gravity: "centre" }])
      .jpeg({ quality })
      .toFile(`public/${name}.jpg`);

    // Mirror to any extra destination (e.g. Next's file-based opengraph-image)
    if (copyTo) {
      await fs.copyFile(`public/${name}.jpg`, copyTo);
      console.log(`  ✓ ${name} (${width}x${height}) > ${copyTo}`);
    } else {
      console.log(`  ✓ ${name} (${width}x${height})`);
    }
  }
}

/* ---------- Backdrop Variant Generation ---------- */

/**
 * Build optimised backdrop variants for site use (e.g. blurred page background).
 * Each variant is resized and compressed according to its spec in {@link BACKDROP_VARIANTS}.
 * @returns Promise that resolves when all backdrop variants are generated.
 */
export async function buildBackdropVariants(): Promise<void> {
  console.log("🌅 Building backdrop variants...");
  await ensureDir("public/source");

  for (const { name, width, quality, format } of BACKDROP_VARIANTS) {
    const outputPath = `public/source/${name}.${format}`;
    // Pre-blur at build time so the CSS doesn't pay the cost on every paint.
    // Saves ~1 s of LCP on mid-range mobile (vs `blur-xl` applied via CSS).
    const pipeline = sharp(BACKDROP)
      .resize(width, null, { withoutEnlargement: true })
      .blur(20)
      // Force sRGB so wide-gamut source (e.g. Display P3 phone photos) renders
      // the same across Safari/Chrome/Firefox.
      .toColorspace("srgb");

    if (format === "avif") {
      // effort=9 is the AVIF encoder's max; CPU-heavy but one-shot at build.
      await pipeline.avif({ quality, effort: 9 }).toFile(outputPath);
    } else if (format === "jpeg") {
      await pipeline.jpeg({ quality, mozjpeg: true }).toFile(outputPath);
    } else {
      await pipeline.webp({ quality, effort: 6, smartSubsample: true }).toFile(outputPath);
    }

    console.log(`  ✓ ${name}.${format} (${width}px @ q${quality}, pre-blurred σ=20)`);
  }
}

/* ---------- Additional Assets Generation ---------- */

/**
 * Build additional marketing assets.
 * @returns Promise that resolves when all additional assets are generated.
 */
export async function buildAdditionalAssets(): Promise<void> {
  console.log("🎁 Building additional assets...");
  await ensureDir("public/assets");

  const logoMarkBuffer = await fs.readFile(LOGO_MARK);
  const logoFullBuffer = await fs.readFile(LOGO_FULL);

  for (const { name, width, height, type, format } of ADDITIONAL_ASSETS) {
    let output: sharp.Sharp;

    if (type === "logo-only") {
      // Full wordmark on transparent background
      const logo = await sharp(logoFullBuffer)
        .resize({
          width: Math.round(width * 0.95),
          height: Math.round(height * 0.95),
          fit: "inside",
        })
        .png()
        .toBuffer();

      output = sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).composite([{ input: logo, gravity: "centre" }]);
    } else if (type === "mark-only") {
      // Square logo mark on transparent background
      const logo = await sharp(logoMarkBuffer)
        .resize({
          width: Math.round(width * 0.9),
          height: Math.round(height * 0.9),
          fit: "inside",
        })
        .png()
        .toBuffer();

      output = sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).composite([{ input: logo, gravity: "centre" }]);
    } else if (type === "mark-on-bg") {
      // Square logo mark on blurred background with frosted card
      const bg = await sharp(BACKDROP)
        .resize(width, height, { fit: "cover", position: "centre" })
        .blur(20)
        .toBuffer();

      const frostedCard = await sharp(makeFrostedCard(width, height, 0.65))
        .resize(width, height)
        .png()
        .toBuffer();

      const logo = await sharp(logoMarkBuffer)
        .resize({
          width: Math.round(width * 0.65),
          height: Math.round(height * 0.65),
          fit: "inside",
        })
        .png()
        .toBuffer();

      output = sharp(bg).composite([{ input: frostedCard }, { input: logo, gravity: "centre" }]);
    } else if (type === "bg-only") {
      // Just the blurred backdrop
      output = sharp(BACKDROP).resize(width, height, { fit: "cover", position: "centre" }).blur(30);
    } else {
      // logo-on-bg: Full wordmark on blurred background with frosted card
      const bg = await sharp(BACKDROP)
        .resize(width, height, { fit: "cover", position: "centre" })
        .blur(25)
        .toBuffer();

      const frostedCard = await sharp(makeFrostedCard(width, height, 0.8))
        .resize(width, height)
        .png()
        .toBuffer();

      const logo = await sharp(logoFullBuffer)
        .resize({
          width: Math.round(width * 0.8),
          height: Math.round(height * 0.7),
          fit: "inside",
        })
        .png()
        .toBuffer();

      output = sharp(bg).composite([{ input: frostedCard }, { input: logo, gravity: "centre" }]);
    }

    if (format === "png") {
      await output.png().toFile(`public/assets/${name}.png`);
    } else {
      await output.jpeg({ quality: 90 }).toFile(`public/assets/${name}.jpg`);
    }

    console.log(`  ✓ ${name} (${width}x${height})`);
  }
}

/* ---------- QR Code Generation ---------- */

/**
 * Build QR codes as both SVG and high-res PNG.
 * @returns Promise that resolves when all QR codes are generated.
 */
export async function buildQRCodes(): Promise<void> {
  console.log("🔲 Building QR codes...");
  await ensureDir("public");

  for (const spec of QR_CODE_SPECS) {
    const outputPathSVG = `public/${spec.name}.svg`;
    const outputPathPNG = `public/${spec.name}.png`;

    try {
      // Generate high-res PNG first (2000x2000 for print quality)
      const qrCodePNG = new QRCodeStyling({
        width: 2000,
        height: 2000,
        data: spec.url,
        margin: 10,
        type: "canvas",
        jsdom: JSDOM, // Node.js DOM environment
        nodeCanvas: canvas, // Node.js canvas module
        qrOptions: {
          typeNumber: 0,
          mode: "Byte",
          errorCorrectionLevel: "H",
        },
        dotsOptions: {
          type: "rounded",
          color: PALETTE.russianViolet500,
        },
        backgroundOptions: {
          color: "#ffffff",
        },
        cornersSquareOptions: {
          type: "extra-rounded",
          color: PALETTE.russianViolet500,
        },
        cornersDotOptions: {
          type: "dot",
          color: PALETTE.russianViolet500,
        },
      });

      const pngBuffer = await qrCodePNG.getRawData("png");

      if (!pngBuffer) {
        throw new Error("Failed to generate PNG QR code");
      }

      let finalPNGBuffer: Buffer;
      if (Buffer.isBuffer(pngBuffer)) {
        finalPNGBuffer = pngBuffer;
      } else {
        const arrayBuffer = await (pngBuffer as Blob).arrayBuffer();
        finalPNGBuffer = Buffer.from(arrayBuffer);
      }

      await fs.writeFile(outputPathPNG, finalPNGBuffer);
      console.log(`  ✓ ${spec.name}.png (${spec.displayName}) - PNG (2000x2000)`);

      // Convert PNG to SVG (embed as base64 in SVG for perfect rendering)
      const pngBase64 = finalPNGBuffer.toString("base64");
      const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="2000" height="2000" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <image width="2000" height="2000" xlink:href="data:image/png;base64,${pngBase64}"/>
</svg>`;

      await fs.writeFile(outputPathSVG, svgContent, "utf-8");
      console.log(`  ✓ ${spec.name}.svg (${spec.displayName}) - SVG (scalable)`);
      console.log(`    URL: ${spec.url}`);
      console.log(`    Style: qr-code-styling rounded blobs`);
    } catch (error) {
      console.error(`  ✗ Failed to generate ${spec.name}:`, error);
    }
  }
}

/* ---------- Manifest File ---------- */

/**
 * Build the web manifest (site.webmanifest) for PWA / Add to Home Screen.
 *
 * Lists every transparent android-chrome size so the OS picks the sharpest
 * fit per device, plus a dedicated maskable icon (separate file with safe-zone
 * padding) so Android does not clip the logo edges when cropping to a
 * circle/squircle.
 * @returns Promise that resolves when the manifest is written.
 */
export async function buildManifest(): Promise<void> {
  console.log("📋 Building site.webmanifest...");

  const webManifest = {
    name: "To The Point Tech",
    short_name: "ToThePoint",
    description: "Local tech support in Point Chevalier, Auckland",
    start_url: "/",
    display: "standalone",
    background_color: PALETTE.seasalt500,
    theme_color: PALETTE.russianViolet500,
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/android-chrome-256x256.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/android-chrome-384x384.png", sizes: "384x384", type: "image/png", purpose: "any" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/android-chrome-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  await fs.writeFile("public/site.webmanifest", JSON.stringify(webManifest, null, 2));
  console.log("  ✓ site.webmanifest");
}
