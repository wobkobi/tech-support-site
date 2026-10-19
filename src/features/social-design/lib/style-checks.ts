// src/features/social-design/lib/style-checks.ts
// Post maker style checks: small words, too much text, words in cropped areas, button lookalikes,
// emoji and low contrast. Warnings only. Contrast reads real pixels of the size drawn without
// words; the rest works from the design alone. Pure; check-social-design covers them.

import { boundText } from "@/features/social-design/lib/bound";
import { hexOf, type ColourKey } from "@/features/social-design/lib/brand";
import {
  TEXT_LIKE,
  type BoundValues,
  type DesignDoc,
  type Geometry,
  type Layer,
} from "@/features/social-design/lib/doc";
import { FORMATS, safeRect, type FormatKey } from "@/features/social-design/lib/formats";
import { leftOffPaidAd } from "@/features/social-design/lib/pictures";

/** Smallest font that reads as a phone-feed thumbnail, in pixels on a 1080-wide picture. */
export const MIN_TEXT_PX = 28;
/** Most pieces of text a picture carries before it stops reading at a glance (ads guide). */
export const MAX_WORD_LAYERS = 3;
/** Lowest contrast ratio for large text (WCAG AA), against the worst tenth of what's behind it. */
export const MIN_CONTRAST = 3;

/** What a check found. */
export type CheckKind = "small-text" | "many-words" | "covered" | "button" | "emoji" | "contrast";

/** One warning, for one layer (or the whole design) on one or more sizes. */
export interface StyleIssue {
  kind: CheckKind;
  /** The layer it's about, or null for the whole design. */
  layerId: string | null;
  /** Sizes it happens on, in tab order. */
  formats: FormatKey[];
  message: string;
}

/** Pixels behind the words, as a canvas `ImageData` holds them. */
export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel, rows top to bottom. */
  data: Uint8ClampedArray;
}

// Words that tell people to tap something on a picture, where nothing can be tapped.
const BUTTON_WORDS =
  /\b(?:(?:tap|click|press)(?: (?:here|below|now|the link|to \w+))?|learn more|shop now|sign up|swipe up|link in bio|find out more)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
// A box this small or smaller, holding a few words, reads as a button.
const BUTTON_MAX_WORDS = 4;
const BUTTON_MAX_SHARE = 0.25;

/**
 * Words a layer draws, or "" for a layer with none.
 * @param layer - Layer.
 * @param bound - Live values for contact and promo layers.
 * @returns The words.
 */
export function wordsOf(layer: Layer, bound: BoundValues): string {
  switch (layer.type) {
    case "text":
      return layer.text;
    case "bullets":
      return layer.items.join("\n");
    case "contact":
    case "promo":
      return boundText(layer, bound);
    default:
      return "";
  }
}

/**
 * Short name for a layer in a warning: its first words in quotes, or its name.
 * @param layer - Layer.
 * @param bound - Live values.
 * @returns The label.
 */
function labelOf(layer: Layer, bound: BoundValues): string {
  const words = wordsOf(layer, bound).replace(/\s+/g, " ").trim();
  if (!words) return layer.name;
  return `"${words.length > 32 ? `${words.slice(0, 30).trimEnd()}...` : words}"`;
}

/**
 * Sizes in a readable list: "Post 4:5", "Post 4:5 and Story", "Post 4:5, Square and Story".
 * @param formats - Sizes.
 * @returns The list.
 */
export function sizeList(formats: FormatKey[]): string {
  const labels = formats.map((f) => FORMATS[f].label);
  return labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Text layers drawing words on a size: shown there, kept on a paid ad, with words in.
 * @param doc - Design.
 * @param format - Size.
 * @param bound - Live values.
 * @returns Each layer with its geometry, bottom first.
 */
export function wordLayersOn(
  doc: DesignDoc,
  format: FormatKey,
  bound: BoundValues,
): { layer: Layer; g: Geometry }[] {
  const layout = doc.layouts[format] ?? {};
  return doc.layers.flatMap((layer) => {
    const g = layout[layer.id];
    if (!g || g.hidden || !TEXT_LIKE.has(layer.type) || leftOffPaidAd(layer, doc.paidAd)) return [];
    return wordsOf(layer, bound).trim() ? [{ layer, g }] : [];
  });
}

/**
 * Whether a box reaches outside the area every app shows (story bands, banner sides on
 * phones, profile picture corners).
 * @param g - Layer geometry.
 * @param format - Size.
 * @returns True when part of it may be covered or cut.
 */
function outsideSafe(g: Geometry, format: FormatKey): boolean {
  const f = FORMATS[format];
  if (!f.safeZone) return false;
  if (f.safeZone.circle) {
    const r = Math.min(f.width, f.height) / 2;
    const cx = f.width / 2;
    const cy = f.height / 2;
    const corners = [
      [g.x, g.y],
      [g.x + g.w, g.y],
      [g.x, g.y + g.h],
      [g.x + g.w, g.y + g.h],
    ];
    return corners.some(([x, y]) => Math.hypot(x! - cx, y! - cy) > r + 1);
  }
  const s = safeRect(format);
  return g.x < s.x1 - 1 || g.y < s.y1 - 1 || g.x + g.w > s.x2 + 1 || g.y + g.h > s.y2 + 1;
}

/**
 * Why words on a size may be covered or cut, in words.
 * @param format - Size.
 * @returns The reason.
 */
function coveredReason(format: FormatKey): string {
  if (format === "story") return "where Stories put the app's own name and buttons";
  if (FORMATS[format].safeZone?.circle) return "outside the circle profile pictures are cut to";
  return `outside the part every screen shows`;
}

/**
 * Whether a small filled or outlined rectangle under short words makes them look like a button.
 * @param doc - Design.
 * @param format - Size.
 * @param layer - The words.
 * @param g - Their geometry.
 * @returns True when they look like a button.
 */
function onButtonShape(doc: DesignDoc, format: FormatKey, layer: Layer, g: Geometry): boolean {
  const layout = doc.layouts[format] ?? {};
  const f = FORMATS[format];
  const below = doc.layers.slice(0, doc.layers.indexOf(layer));
  return below.some((s) => {
    const sg = layout[s.id];
    if (!sg || sg.hidden || s.type !== "shape" || s.shape !== "rect") return false;
    if (!s.fill && !s.stroke) return false;
    if (sg.w * sg.h > f.width * f.height * BUTTON_MAX_SHARE) return false;
    return (
      g.x >= sg.x - 2 &&
      g.y >= sg.y - 2 &&
      g.x + g.w <= sg.x + sg.w + 2 &&
      g.y + g.h <= sg.y + sg.h + 2
    );
  });
}

/**
 * Adds a per-size finding, merging it into the issue already there for that layer.
 * @param found - Findings so far, keyed by kind and layer.
 * @param key - Kind and layer key.
 * @param format - Size it was found on.
 * @param make - Builds the issue for the sizes found.
 */
function note(
  found: Map<string, { formats: FormatKey[]; make: (formats: FormatKey[]) => StyleIssue }>,
  key: string,
  format: FormatKey,
  make: (formats: FormatKey[]) => StyleIssue,
): void {
  const entry = found.get(key) ?? { formats: [], make };
  if (!entry.formats.includes(format)) entry.formats.push(format);
  found.set(key, entry);
}

/**
 * Every design-only check (all but contrast) on every size, one issue per layer and kind.
 * @param doc - Design.
 * @param bound - Live values for contact and promo layers.
 * @returns Issues, in the order the checks run.
 */
export function styleChecks(doc: DesignDoc, bound: BoundValues): StyleIssue[] {
  const found = new Map<string, { formats: FormatKey[]; make: (f: FormatKey[]) => StyleIssue }>();
  for (const format of doc.formats) {
    const f = FORMATS[format];
    const words = wordLayersOn(doc, format, bound);
    for (const { layer, g } of words) {
      const label = labelOf(layer, bound);
      const size = g.fontSize ?? 0;
      // Feeds scale a picture to the phone's width, so size counts against the width.
      if (size > 0 && (size * 1080) / f.width < MIN_TEXT_PX) {
        note(found, `small-text:${layer.id}`, format, (fs) => ({
          kind: "small-text",
          layerId: layer.id,
          formats: fs,
          message: `${label} is too small to read in a phone feed on ${sizeList(fs)}. Make it at least ${Math.ceil((MIN_TEXT_PX * FORMATS[fs[0]!].width) / 1080)}.`,
        }));
      }
      if (outsideSafe(g, format)) {
        note(found, `covered:${layer.id}:${format}`, format, (fs) => ({
          kind: "covered",
          layerId: layer.id,
          formats: fs,
          message: `${label} sits ${coveredReason(format)} on ${sizeList(fs)}, so part of it may be hidden.`,
        }));
      }
      const text = wordsOf(layer, bound);
      const shortWords = text.trim().split(/\s+/).length <= BUTTON_MAX_WORDS;
      if (BUTTON_WORDS.test(text) || (shortWords && onButtonShape(doc, format, layer, g))) {
        note(found, `button:${layer.id}`, format, (fs) => ({
          kind: "button",
          layerId: layer.id,
          formats: fs,
          message: `${label} looks like a button, but nothing on a picture can be tapped. Facebook and Instagram may hold back an ad that does this; say it in the post words instead.`,
        }));
      }
      if (EMOJI.test(text)) {
        note(found, `emoji:${layer.id}`, format, (fs) => ({
          kind: "emoji",
          layerId: layer.id,
          formats: fs,
          message: `${label} has an emoji, which is drawn in this computer's emoji style and won't match what people see in the app.`,
        }));
      }
    }
    // Contact details are small print people look up rather than read at a glance, and
    // paid ads leave them off, so they don't count towards the limit.
    const pieces = words.filter((w) => w.layer.type !== "contact").length;
    if (pieces > MAX_WORD_LAYERS) {
      note(found, `many-words:${pieces}`, format, (fs) => ({
        kind: "many-words",
        layerId: null,
        formats: fs,
        message: `${pieces} pieces of text on ${sizeList(fs)}. People take in about ${MAX_WORD_LAYERS} at a glance; move the rest into the post words.`,
      }));
    }
  }
  return [...found.values()].map((e) => e.make(e.formats));
}

/**
 * The design with every word layer taken out, for drawing what sits behind the words.
 * @param doc - Design.
 * @returns The design without text, ticked points, contact or promo layers.
 */
export function withoutWords(doc: DesignDoc): DesignDoc {
  return { ...doc, layers: doc.layers.filter((l) => !TEXT_LIKE.has(l.type)) };
}

/**
 * Relative luminance of an sRGB colour (WCAG 2).
 * @param r - Red, 0-255.
 * @param g - Green, 0-255.
 * @param b - Blue, 0-255.
 * @returns 0 (black) to 1 (white).
 */
export function luminance(r: number, g: number, b: number): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

/**
 * Luminance of a brand colour.
 * @param key - Colour.
 * @returns 0-1.
 */
function luminanceOf(key: ColourKey): number {
  const hex = hexOf(key);
  return luminance(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  );
}

/**
 * Contrast ratio between two luminances (WCAG 2): 1 for none, 21 for black on white.
 * @param a - One luminance.
 * @param b - The other.
 * @returns The ratio.
 */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Colour a word layer is drawn in.
 * @param layer - Word layer.
 * @returns Its colour, or null for a layer with no words.
 */
function inkOf(layer: Layer): ColourKey | null {
  switch (layer.type) {
    case "text":
    case "bullets":
    case "contact":
    case "promo":
      return layer.colour;
    default:
      return null;
  }
}

/**
 * Contrast of a layer's words against the worst tenth of the pixels under its box, so a pale
 * patch counts. Words on a highlight band are measured against the band.
 * @param layer - Word layer.
 * @param g - Its geometry on the size the pixels are of.
 * @param pixels - The size drawn without its words, at any scale.
 * @param scale - Pixels per design pixel in `pixels`.
 * @returns The contrast ratio, or null when the box is off the picture.
 */
export function wordContrast(
  layer: Layer,
  g: Geometry,
  pixels: Pixels,
  scale: number,
): number | null {
  const ink = inkOf(layer);
  if (!ink) return null;
  const inkL = luminanceOf(ink);
  if (layer.type === "text" && layer.highlight) {
    return contrastRatio(inkL, luminanceOf(layer.highlight));
  }
  const x1 = Math.max(0, Math.floor(g.x * scale));
  const y1 = Math.max(0, Math.floor(g.y * scale));
  const x2 = Math.min(pixels.width, Math.ceil((g.x + g.w) * scale));
  const y2 = Math.min(pixels.height, Math.ceil((g.y + g.h) * scale));
  if (x2 <= x1 || y2 <= y1) return null;
  // About 1,500 samples at most, spread evenly over the box.
  const step = Math.max(1, Math.floor(Math.sqrt(((x2 - x1) * (y2 - y1)) / 1500)));
  const ratios: number[] = [];
  for (let y = y1; y < y2; y += step) {
    for (let x = x1; x < x2; x += step) {
      const i = (y * pixels.width + x) * 4;
      const l = luminance(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!);
      ratios.push(contrastRatio(inkL, l));
    }
  }
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 10)] ?? null;
}

/**
 * Words that are hard to read against what's behind them, on one size.
 * @param doc - Design.
 * @param format - Size the pixels are of.
 * @param pixels - The size drawn by {@link withoutWords}, at any scale.
 * @param scale - Pixels per design pixel in `pixels`.
 * @param bound - Live values, for which bound layers draw words.
 * @returns One issue per hard-to-read layer.
 */
export function contrastIssues(
  doc: DesignDoc,
  format: FormatKey,
  pixels: Pixels,
  scale: number,
  bound: BoundValues,
): StyleIssue[] {
  return wordLayersOn(doc, format, bound).flatMap(({ layer, g }) => {
    const ratio = wordContrast(layer, g, pixels, scale);
    if (ratio === null || ratio >= MIN_CONTRAST) return [];
    return [
      {
        kind: "contrast" as const,
        layerId: layer.id,
        formats: [format],
        message: `${labelOf(layer, bound)} is hard to read against what's behind it on ${FORMATS[format].label}. Put it on a card, darken or lighten the backdrop, or change its colour.`,
      },
    ];
  });
}

/**
 * Merges per-size contrast issues into one per layer, sizes in tab order.
 * @param doc - Design, for the tab order.
 * @param issues - Contrast issues from each size.
 * @param bound - Live values, for the label.
 * @returns One issue per layer.
 */
export function mergeContrast(
  doc: DesignDoc,
  issues: StyleIssue[],
  bound: BoundValues,
): StyleIssue[] {
  const byLayer = new Map<string, FormatKey[]>();
  for (const issue of issues) {
    if (!issue.layerId) continue;
    byLayer.set(issue.layerId, [...(byLayer.get(issue.layerId) ?? []), ...issue.formats]);
  }
  return [...byLayer].flatMap(([id, formats]) => {
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return [];
    const fs = doc.formats.filter((f) => formats.includes(f));
    return [
      {
        kind: "contrast" as const,
        layerId: id,
        formats: fs,
        message: `${labelOf(layer, bound)} is hard to read against what's behind it on ${sizeList(fs)}. Put it on a card, darken or lighten the backdrop, or change its colour.`,
      },
    ];
  });
}
