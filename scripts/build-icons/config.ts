// scripts/build-icons/config.ts
/**
 * @file config.ts
 * @description Configuration and specifications for icon/image generation.
 */

/* ---------- Brand Palette ---------- */

export const PALETTE = {
  seasalt500: "#f6f7f8",
  seasalt800: "#fcfcfc",
  richBlack500: "#001514",
  russianViolet500: "#0c0a3e",
  coquelicot500: "#f34213",
  moonstone500: "#43bccd",
} as const;

/* ---------- Source Files ---------- */

export const LOGO_MARK = "public/source/logo.svg"; // Square logo mark (441x441)
export const LOGO_FULL = "public/source/logo-full.svg"; // Full wordmark (2000x673)
export const LOGO_PROFILE = "public/source/profile.svg"; // Profile picture logo (542x542)
export const BACKDROP = "public/source/backdrop.jpg"; // Background image

/* ---------- Favicon Specs ---------- */

/**
 * Specification for a single favicon variant.
 */
export interface IconSpec {
  /** Output filename without extension. */
  name: string;
  /** Pixel dimensions (square). */
  size: number;
  /** Whether to render on an opaque background. */
  opaque: boolean;
}

export const FAVICON_SPECS: IconSpec[] = [
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

/**
 * Specification for a social media image variant.
 */
export interface SocialSpec {
  /** Output filename without extension. */
  name: string;
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Gaussian blur radius applied to the backdrop. */
  blur: number;
  /** Logo scale as a fraction of the canvas dimensions. */
  logoScale: number;
  /** JPEG output quality (1–100). */
  quality: number;
  /** Use square logo mark instead of full wordmark. */
  useMarkLogo?: boolean;
}

export const SOCIAL_SPECS: SocialSpec[] = [
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

/**
 * Specification for an additional marketing asset.
 */
export interface AdditionalAsset {
  /** Output filename without extension. */
  name: string;
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Compositing type determining which layers to include. */
  type: "logo-on-bg" | "logo-only" | "mark-only" | "mark-on-bg" | "bg-only";
  /** Output file format. */
  format: "png" | "jpg";
}

export const ADDITIONAL_ASSETS: AdditionalAsset[] = [
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

/**
 * Specification for a QR code variant.
 */
export interface QRCodeSpec {
  /** Output filename without extension. */
  name: string;
  /** Human-readable label used in log output. */
  displayName: string;
  /** URL encoded in the QR code. */
  url: string;
}

export const QR_CODE_SPECS: QRCodeSpec[] = [
  {
    name: "qr-booking",
    displayName: "Booking QR Code",
    url: "tothepoint.co.nz/booking", // Shorter URL without https://
  },
];
