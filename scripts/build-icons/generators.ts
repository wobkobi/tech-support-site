// scripts/build-icons/generators.ts
/**
 * @file generators.ts
 * @description Generator functions for favicons, social images, additional assets, QR codes, and manifests.
 */

import sharp from "sharp";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import {
  PALETTE,
  LOGO_MARK,
  LOGO_FULL,
  LOGO_PROFILE,
  BACKDROP,
  FAVICON_SPECS,
  SOCIAL_SPECS,
  ADDITIONAL_ASSETS,
  QR_CODE_SPECS,
} from "./config.js";
import { ensureDir, makeFrostedCard, makeCoquelicotSvg } from "./helpers.js";

// Dynamic import for CommonJS module
const QRCodeStylingModule = await import("qr-code-styling");
const QRCodeStyling = QRCodeStylingModule.default;

// Load the native Canvas addon via CJS require to avoid ERR_INTERNAL_ASSERTION
// in Node.js v22 when the ESM loader attempts to wrap native bindings directly.
const canvas = createRequire(import.meta.url)("canvas") as typeof import("canvas");

/* ---------- Favicon Generation ---------- */

/**
 * Build all favicon variations including dark mode versions.
 * @returns Promise that resolves when all favicons are generated.
 */
export async function buildFavicons(): Promise<void> {
  console.log("🎨 Building favicons...");
  await ensureDir("public");

  // Read the SVG
  const svgBuffer = await fs.readFile(LOGO_MARK);
  const coquelicotSvgBuffer = await makeCoquelicotSvg(svgBuffer);

  // Create light version (original Russian Violet on transparent)
  const light512 = await sharp(svgBuffer).resize(512, 512).png().toBuffer();

  // Create coquelicot version for dark mode
  const coquelicot512 = await sharp(coquelicotSvgBuffer).resize(512, 512).png().toBuffer();

  for (const { name, size, opaque } of FAVICON_SPECS) {
    if (opaque) {
      // Light mode: Russian Violet logo on Seasalt background
      const bg = sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 246, g: 247, b: 248, alpha: 1 }, // seasalt
        },
      });

      const logoResized = await sharp(svgBuffer)
        .resize(Math.round(size * 0.85), Math.round(size * 0.85))
        .png()
        .toBuffer();

      await bg
        .composite([{ input: logoResized, gravity: "centre" }])
        .png()
        .toFile(`public/${name}.png`);

      // Dark mode: Coquelicot logo on Rich Black background
      const bgDark = sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 0, g: 21, b: 20, alpha: 1 }, // rich-black
        },
      });

      const logoResizedCoquelicot = await sharp(coquelicotSvgBuffer)
        .resize(Math.round(size * 0.85), Math.round(size * 0.85))
        .png()
        .toBuffer();

      await bgDark
        .composite([{ input: logoResizedCoquelicot, gravity: "centre" }])
        .png()
        .toFile(`public/${name}-dark.png`);
    } else {
      // Transparent - Light mode: Russian Violet
      await sharp(light512).resize(size, size).png().toFile(`public/${name}.png`);

      // Transparent - Dark mode: Coquelicot
      await sharp(coquelicot512).resize(size, size).png().toFile(`public/${name}-dark.png`);
    }

    console.log(`  ✓ ${name} (${size}x${size})`);
  }

  // Generate ICO file (copy 32x32)
  await fs.copyFile("public/favicon-32x32.png", "public/favicon.ico");
  console.log("  ✓ favicon.ico");
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
    const { name, width, height, blur, logoScale, quality, useMarkLogo } = spec;

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

    console.log(`  ✓ ${name} (${width}x${height})`);
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

      // Save PNG
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

/* ---------- Manifest Files ---------- */

/**
 * Build web manifest and browserconfig files.
 * @returns Promise that resolves when manifest files are generated.
 */
export async function buildManifest(): Promise<void> {
  console.log("📋 Building manifest files...");

  // Web manifest
  const webManifest = {
    name: "To The Point Tech",
    short_name: "ToThePoint",
    description: "Local tech support in Point Chevalier, Auckland",
    start_url: "/",
    display: "standalone",
    background_color: PALETTE.seasalt500,
    theme_color: PALETTE.russianViolet500,
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  await fs.writeFile("public/site.webmanifest", JSON.stringify(webManifest, null, 2));
  console.log("  ✓ site.webmanifest");

  // browserconfig.xml for MS tiles
  const browserConfig = `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square150x150logo src="/mstile-150x150.png"/>
      <TileColor>${PALETTE.russianViolet500}</TileColor>
    </tile>
  </msapplication>
</browserconfig>`;

  await fs.writeFile("public/browserconfig.xml", browserConfig);
  console.log("  ✓ browserconfig.xml");
}
