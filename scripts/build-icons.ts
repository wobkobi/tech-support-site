// scripts/build-icons.ts
/**
 * @file build-icons.ts
 * @description Generates all favicon, OG, and social media images for the site.
 * Run with: npm run build:icons
 */

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

// Dynamic import for CommonJS module
const QRCodeStylingModule = await import("qr-code-styling");
const QRCodeStyling = QRCodeStylingModule.default;

// Load the native Canvas addon via CJS require to avoid ERR_INTERNAL_ASSERTION
// in Node.js v22 when the ESM loader attempts to wrap native bindings directly.
const canvas = createRequire(import.meta.url)("canvas") as typeof import("canvas");

/* ---------- Brand Palette ---------- */

const PALETTE = {
  seasalt500: "#f6f7f8",
  seasalt800: "#fcfcfc",
  richBlack500: "#001514",
  russianViolet500: "#0c0a3e",
  coquelicot500: "#f34213",
  moonstone500: "#43bccd",
} as const;

/* ---------- Source Files ---------- */

const LOGO_MARK = "public/source/logo.svg"; // Square logo mark (441x441)
const LOGO_FULL = "public/source/logo-full.svg"; // Full wordmark (2000x673)
const LOGO_PROFILE = "public/source/profile.svg"; // Profile picture logo (542x542)
const BACKDROP = "public/source/backdrop.jpg"; // Background image

/* ---------- Favicon Specs ---------- */

interface IconSpec {
  name: string;
  size: number;
  opaque: boolean;
}

const FAVICON_SPECS: IconSpec[] = [
  // Apple
  { name: "apple-touch-icon", size: 180, opaque: true },
  // Android/Chrome
  { name: "android-chrome-192x192", size: 192, opaque: false },
  { name: "android-chrome-512x512", size: 512, opaque: false },
  // Standard favicons
  { name: "favicon-32x32", size: 32, opaque: false },
  { name: "favicon-16x16", size: 16, opaque: false },
  // MS Tile
  { name: "mstile-150x150", size: 150, opaque: true },
];

/* ---------- Social Image Specs ---------- */

interface SocialSpec {
  name: string;
  width: number;
  height: number;
  blur: number;
  logoScale: number;
  quality: number;
  useMarkLogo?: boolean; // Use square logo mark instead of full wordmark
}

const SOCIAL_SPECS: SocialSpec[] = [
  // Open Graph (Facebook, LinkedIn, Discord, etc.)
  { name: "og-1200x630", width: 1200, height: 630, blur: 25, logoScale: 0.85, quality: 90 },
  // Twitter/X Card
  {
    name: "twitter-card-1200x600",
    width: 1200,
    height: 600,
    blur: 25,
    logoScale: 0.85,
    quality: 90,
  },
  // General social banner (high-res)
  {
    name: "banner-social-1600x900",
    width: 1600,
    height: 900,
    blur: 32,
    logoScale: 0.8,
    quality: 90,
  },
  // Facebook cover photo
  {
    name: "facebook-cover-1640x624",
    width: 1640,
    height: 624,
    blur: 30,
    logoScale: 0.75,
    quality: 90,
  },
  // LinkedIn banner
  {
    name: "linkedin-banner-1584x396",
    width: 1584,
    height: 396,
    blur: 28,
    logoScale: 0.6,
    quality: 90,
  },
  // YouTube banner
  {
    name: "youtube-banner-2560x1440",
    width: 2560,
    height: 1440,
    blur: 35,
    logoScale: 0.5,
    quality: 85,
  },
  // Profile pics (square) - use profile logo
  {
    name: "profile-square-1000",
    width: 1000,
    height: 1000,
    blur: 25,
    logoScale: 0.85,
    quality: 90,
    useMarkLogo: true,
  },
  {
    name: "profile-square-512",
    width: 512,
    height: 512,
    blur: 20,
    logoScale: 0.85,
    quality: 90,
    useMarkLogo: true,
  },
  {
    name: "profile-square-200",
    width: 200,
    height: 200,
    blur: 12,
    logoScale: 0.85,
    quality: 90,
    useMarkLogo: true,
  },
  // Circle-safe profile pics (scaled to fit within inscribed circle)
  {
    name: "profile-circle-1000",
    width: 1000,
    height: 1000,
    blur: 25,
    logoScale: 0.65,
    quality: 90,
    useMarkLogo: true,
  },
  {
    name: "profile-circle-512",
    width: 512,
    height: 512,
    blur: 20,
    logoScale: 0.65,
    quality: 90,
    useMarkLogo: true,
  },
  {
    name: "profile-circle-200",
    width: 200,
    height: 200,
    blur: 12,
    logoScale: 0.65,
    quality: 90,
    useMarkLogo: true,
  },
  // Platform-specific profile pics
  {
    name: "instagram-profile-320",
    width: 320,
    height: 320,
    blur: 15,
    logoScale: 0.65,
    quality: 90,
    useMarkLogo: true,
  },
  {
    name: "google-business-720",
    width: 720,
    height: 720,
    blur: 22,
    logoScale: 0.65,
    quality: 90,
    useMarkLogo: true,
  },
];

/* ---------- Additional Assets ---------- */

interface AdditionalAsset {
  name: string;
  width: number;
  height: number;
  type: "logo-on-bg" | "logo-only" | "mark-only" | "mark-on-bg" | "bg-only";
  format: "png" | "jpg";
}

const ADDITIONAL_ASSETS: AdditionalAsset[] = [
  // Email signature logo (full wordmark, transparent)
  { name: "email-signature-400x135", width: 400, height: 135, type: "logo-only", format: "png" },
  // Invoice/document header
  { name: "document-header-800x270", width: 800, height: 270, type: "logo-only", format: "png" },
  // Business card back (print-ready)
  { name: "card-back-1050x600", width: 1050, height: 600, type: "logo-on-bg", format: "jpg" },
  // QR code landing background
  {
    name: "qr-landing-bg-1080x1920",
    width: 1080,
    height: 1920,
    type: "bg-only",
    format: "jpg",
  },
  // Square logo mark only (transparent)
  { name: "logo-mark-512", width: 512, height: 512, type: "mark-only", format: "png" },
  { name: "logo-mark-256", width: 256, height: 256, type: "mark-only", format: "png" },
  // Square mark on background (for WhatsApp, etc.)
  { name: "logo-mark-bg-512", width: 512, height: 512, type: "mark-on-bg", format: "jpg" },
];

/* ---------- QR Code Specs ---------- */

interface QRCodeSpec {
  name: string;
  displayName: string;
  url: string;
}

const QR_CODE_SPECS: QRCodeSpec[] = [
  {
    name: "qr-booking",
    displayName: "Booking QR Code",
    url: "tothepoint.co.nz/booking", // Shorter URL without https://
  },
];

/* ---------- Helpers ---------- */

/**
 * Ensure output directory exists.
 * @param dir - Directory path to create
 */
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Create a frosted white card/box SVG centered on the canvas (like the website's cards).
 * Matches the website's bg-seasalt-800/60 style (60% opacity #fcfcfc).
 * @param w - Canvas width in pixels
 * @param h - Canvas height in pixels
 * @param logoScale - Scale factor of the logo (to size the card appropriately)
 * @returns SVG buffer
 */
function makeFrostedCard(w: number, h: number, logoScale: number): Buffer {
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
 * Replace Russian Violet with Coquelicot in SVG for dark mode
 * @param svgBuffer - Original SVG buffer
 * @returns Modified SVG buffer with coquelicot color
 */
async function makeCoquelicotSvg(svgBuffer: Buffer): Promise<Buffer> {
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

/* ---------- Favicon Generation ---------- */

/**
 * Build all favicon variations including dark mode versions
 */
async function buildFavicons(): Promise<void> {
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
 * Build all social media images (OG, Twitter, Facebook, etc.)
 */
async function buildSocialImages(): Promise<void> {
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
 * Build additional marketing assets
 */
async function buildAdditionalAssets(): Promise<void> {
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
 * Build QR codes as both SVG and high-res PNG
 */
async function buildQRCodes(): Promise<void> {
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
 * Build web manifest and browserconfig files
 */
async function buildManifest(): Promise<void> {
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

/* ---------- Preflight Check ---------- */

/**
 * Verify all required source files exist before generation
 * @throws {Error} If any required file is missing
 */
async function preflight(): Promise<void> {
  console.log("🔍 Checking source files...");
  const required = [LOGO_MARK, LOGO_FULL, LOGO_PROFILE, BACKDROP];

  for (const file of required) {
    try {
      await fs.access(path.resolve(file));
      console.log(`  ✓ ${file}`);
    } catch {
      throw new Error(`Missing required file: ${file}`);
    }
  }
}

/* ---------- Summary ---------- */

/**
 * Print summary of all generated assets
 */
function printSummary(): void {
  console.log("\n📦 Generated assets summary:\n");

  console.log("Favicons (public/):");
  FAVICON_SPECS.forEach((s) => console.log(`  • ${s.name}.png / ${s.name}-dark.png (coquelicot)`));
  console.log("  • favicon.ico\n");

  console.log("Social Images (public/):");
  SOCIAL_SPECS.forEach((s) => console.log(`  • ${s.name}.jpg (${s.width}x${s.height})`));
  console.log("");

  console.log("Additional Assets (public/assets/):");
  ADDITIONAL_ASSETS.forEach((a) =>
    console.log(`  • ${a.name}.${a.format} (${a.width}x${a.height})`),
  );
  console.log("");

  console.log("QR Codes (public/):");
  QR_CODE_SPECS.forEach((s) => console.log(`  • ${s.name}.svg + ${s.name}.png (${s.displayName})`));
  console.log("");

  console.log("Manifest Files (public/):");
  console.log("  • site.webmanifest");
  console.log("  • browserconfig.xml");
  console.log("");

  console.log("✅ All assets generated successfully!");
  console.log("💡 Note: Dark mode icons use coquelicot (#f34213) color");
}

/* ---------- Main ---------- */

/**
 * Main execution function - runs all generation tasks
 */
async function main(): Promise<void> {
  console.log("\n🚀 Building site images and icons...\n");

  await preflight();
  await buildFavicons();
  await buildSocialImages();
  await buildAdditionalAssets();
  await buildQRCodes();
  await buildManifest();

  printSummary();
}

main().catch((err) => {
  console.error("\n❌ Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
