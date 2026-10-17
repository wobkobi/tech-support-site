// src/features/social-design/lib/brand.ts
// The house style the post maker is limited to: brand colour swatches, text presets
// and the logo and backdrop files. Hexes match the @theme tokens in globals.css; keys
// are stored in designs so a design never carries an off-brand colour.

/** One colour the operator can pick. */
export interface Swatch {
  key: string;
  label: string;
  hex: string;
}

export const SWATCHES: Swatch[] = [
  { key: "white", label: "White", hex: "#ffffff" },
  { key: "seasalt", label: "Seasalt", hex: "#f6f7f8" },
  { key: "seasalt-200", label: "Seasalt 200", hex: "#c6ccd2" },
  { key: "seasalt-600", label: "Seasalt 600", hex: "#5a6672" },
  { key: "russian-violet", label: "Russian violet", hex: "#0c0a3e" },
  { key: "russian-violet-700", label: "Russian violet 700", hex: "#191584" },
  { key: "moonstone", label: "Moonstone", hex: "#43bccd" },
  { key: "moonstone-600", label: "Moonstone 600", hex: "#2b93a1" },
  { key: "moonstone-700", label: "Moonstone 700", hex: "#206f79" },
  { key: "moonstone-100", label: "Moonstone 100", hex: "#d7f1f4" },
  { key: "coquelicot", label: "Coquelicot", hex: "#f34213" },
  { key: "coquelicot-600", label: "Coquelicot 600", hex: "#c2320a" },
  { key: "mustard", label: "Mustard", hex: "#fed766" },
  { key: "rich-black", label: "Rich black", hex: "#001514" },
];

const SWATCH_BY_KEY = new Map(SWATCHES.map((s) => [s.key, s]));

/** Key of a brand swatch. */
export type ColourKey = string;

/**
 * Whether a key names a brand swatch.
 * @param value - Raw value.
 * @returns True for a key in {@link SWATCHES}.
 */
export function isColourKey(value: unknown): value is ColourKey {
  return typeof value === "string" && SWATCH_BY_KEY.has(value);
}

/**
 * Hex for a swatch key, falling back to russian violet for an unknown key.
 * @param key - Swatch key.
 * @returns The hex colour.
 */
export function hexOf(key: ColourKey): string {
  return SWATCH_BY_KEY.get(key)?.hex ?? "#0c0a3e";
}

/** Text style presets; the font is always Exo. */
export type TextPreset = "headline" | "support" | "small" | "accent";

/**
 * Starting values for each preset at a 1080px-wide picture. Headline matches the
 * build-ads h1 (Exo 800, tight tracking); support text sits at 75-78% opacity there,
 * so it is seasalt 600 here rather than a translucent violet.
 */
export const TEXT_PRESETS: Record<
  TextPreset,
  {
    label: string;
    fontSize: number;
    weight: number;
    colour: ColourKey;
    lineHeight: number;
    letterSpacing: number;
  }
> = {
  headline: {
    label: "Headline",
    fontSize: 96,
    weight: 800,
    colour: "russian-violet",
    lineHeight: 1.05,
    letterSpacing: -2,
  },
  support: {
    label: "Support",
    fontSize: 44,
    weight: 500,
    colour: "seasalt-600",
    lineHeight: 1.3,
    letterSpacing: 0,
  },
  small: {
    label: "Small",
    fontSize: 32,
    weight: 500,
    colour: "seasalt-600",
    lineHeight: 1.35,
    letterSpacing: 0,
  },
  accent: {
    label: "Accent",
    fontSize: 40,
    weight: 700,
    colour: "moonstone-600",
    lineHeight: 1.2,
    letterSpacing: 0.5,
  },
};

export const TEXT_PRESET_KEYS = Object.keys(TEXT_PRESETS) as TextPreset[];

/** Logo artwork in public/source, with each file's width-to-height ratio. */
export const LOGOS = {
  mark: { label: "Mark", src: "/source/logo.svg", ratio: 1 },
  profile: { label: "Mark with accent", src: "/source/profile.svg", ratio: 1 },
  wordmark: { label: "Wordmark", src: "/source/logo-wordmark.svg", ratio: 2000 / 674 },
  full: { label: "Wordmark and tagline", src: "/source/logo-full.svg", ratio: 2000 / 674 },
} as const;

/** Logo variant key. */
export type LogoVariant = keyof typeof LOGOS;

/**
 * The brand backdrop, pre-blurred by build-icons (BACKDROP_VARIANTS) so the canvas
 * never runs a live blur over a 1080x1920 picture.
 */
export const BACKDROP_BLURRED_SRC = "/source/backdrop-blur.webp";
export const BACKDROP_SRC = "/source/backdrop.jpg";

/**
 * Frosted card, matching FrostedSection and the build-ads card: white at 60%, a 2px
 * seasalt-200 border at 40%, a navy-tinted shadow.
 */
export const FROSTED = {
  fill: "rgba(252,252,252,0.6)",
  stroke: "rgba(191,198,205,0.4)",
  strokeWidth: 2,
  shadow: "rgba(12,10,62,0.18)",
  shadowBlur: 40,
  shadowOffsetY: 12,
} as const;
