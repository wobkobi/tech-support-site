// src/features/social-design/lib/formats.ts
// Every picture size the post maker can export, with the guides drawn over each one.
// Core sizes cover the composer's apps; extras are banners and profile pictures that
// the build-icons script also makes.

/** Key of one export size. */
export type FormatKey =
  | "feed-4x5"
  | "square"
  | "story"
  | "google-4x3"
  | "landscape"
  | "fb-cover"
  | "linkedin"
  | "x"
  | "youtube"
  | "profile";

/**
 * The part of a picture an app always shows, as fractions of each side cut off.
 * `circle` marks a profile picture that apps crop to the inscribed circle.
 */
export interface SafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
  circle?: boolean;
}

/** One export size. */
export interface Format {
  key: FormatKey;
  label: string;
  width: number;
  height: number;
  group: "core" | "extra";
  /** Where the picture ends up, shown under the size tab. */
  usedFor: string;
  safeZone?: SafeZone;
}

const NO_CUT: SafeZone = { top: 0, right: 0, bottom: 0, left: 0 };

export const FORMATS: Record<FormatKey, Format> = {
  "feed-4x5": {
    key: "feed-4x5",
    label: "Post 4:5",
    width: 1080,
    height: 1350,
    group: "core",
    usedFor: "Facebook and Instagram posts",
  },
  square: {
    key: "square",
    label: "Square",
    width: 1080,
    height: 1080,
    group: "core",
    usedFor: "Square posts and ads",
  },
  story: {
    key: "story",
    label: "Story",
    width: 1080,
    height: 1920,
    group: "core",
    usedFor: "Stories and Reels covers",
    // Meta's profile bar covers the top 14% and the reply box the bottom 20%.
    safeZone: { top: 0.14, right: 0, bottom: 0.2, left: 0 },
  },
  "google-4x3": {
    key: "google-4x3",
    label: "Google 4:3",
    width: 1200,
    height: 900,
    group: "core",
    usedFor: "Google Business Profile posts",
  },
  landscape: {
    key: "landscape",
    label: "Landscape",
    width: 1200,
    height: 630,
    group: "core",
    usedFor: "Facebook link posts and wide ads",
  },
  "fb-cover": {
    key: "fb-cover",
    label: "Facebook cover",
    width: 1640,
    height: 624,
    group: "extra",
    usedFor: "Facebook Page cover",
    // Phones show the middle 16:9 of the cover: 624 * 16/9 = 1109 of 1640px wide.
    safeZone: { top: 0, right: 0.162, bottom: 0, left: 0.162 },
  },
  linkedin: {
    key: "linkedin",
    label: "LinkedIn",
    width: 1200,
    height: 627,
    group: "extra",
    usedFor: "LinkedIn posts",
  },
  x: {
    key: "x",
    label: "X",
    width: 1600,
    height: 900,
    group: "extra",
    usedFor: "X posts",
  },
  youtube: {
    key: "youtube",
    label: "YouTube banner",
    width: 2560,
    height: 1440,
    group: "extra",
    usedFor: "YouTube channel banner",
    // Only the centre 1546x423 shows on every device.
    safeZone: { top: 0.353, right: 0.198, bottom: 0.353, left: 0.198 },
  },
  profile: {
    key: "profile",
    label: "Profile picture",
    width: 1000,
    height: 1000,
    group: "extra",
    usedFor: "Profile pictures (cut to a circle)",
    safeZone: { ...NO_CUT, circle: true },
  },
};

/** Every format key, core first, in tab order. */
export const FORMAT_KEYS = Object.keys(FORMATS) as FormatKey[];

/** Sizes a new design starts with. */
export const CORE_FORMATS: FormatKey[] = FORMAT_KEYS.filter((k) => FORMATS[k].group === "core");

/**
 * Whether a string is a known format key.
 * @param value - Raw value.
 * @returns True for a key in {@link FORMATS}.
 */
export function isFormatKey(value: unknown): value is FormatKey {
  return typeof value === "string" && Object.hasOwn(FORMATS, value);
}

/**
 * The always-visible rectangle of a format in pixels.
 * @param key - Format.
 * @returns Left, top, right and bottom edges of the safe area.
 */
export function safeRect(key: FormatKey): { x1: number; y1: number; x2: number; y2: number } {
  const f = FORMATS[key];
  const z = f.safeZone ?? NO_CUT;
  return {
    x1: f.width * z.left,
    y1: f.height * z.top,
    x2: f.width * (1 - z.right),
    y2: f.height * (1 - z.bottom),
  };
}
