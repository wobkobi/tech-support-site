// src/features/social-design/lib/pictures.ts
// A design's exported pictures: staleness, paid-ad omissions, default description and file names.
// Pure, so editor, composer and server agree.

import type { RenderRow } from "@/features/social-design/lib/design-row";
import {
  docHash,
  type BoundValues,
  type DesignDoc,
  type Layer,
} from "@/features/social-design/lib/doc";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";

/** Where a design's pictures stand against the design as it is now. */
export interface PictureState {
  /** "none" before any export, "current" when every size matches, else "stale". */
  status: "none" | "current" | "stale";
  /** Sizes whose picture is missing or was made from an older version of the design. */
  outdated: FormatKey[];
  /** Fingerprint of the design as it is now. */
  hash: string;
}

/**
 * Whether a layer is left off a paid ad's pictures; Meta's button replaces contact details.
 * @param layer - Layer.
 * @param paidAd - The design's paid-ad switch.
 * @returns True when the layer is left off.
 */
export function leftOffPaidAd(layer: Layer, paidAd: boolean): boolean {
  return paidAd && layer.type === "contact";
}

/**
 * Compares a design's exports with the design as it is now.
 * @param doc - Design.
 * @param bound - Live values the layers draw.
 * @param renders - Stored exports.
 * @returns Picture state.
 */
export function pictureState(
  doc: DesignDoc,
  bound: BoundValues,
  renders: Pick<RenderRow, "format" | "docHash">[],
): PictureState {
  const hash = docHash(doc, bound);
  if (renders.length === 0) return { status: "none", outdated: [...doc.formats], hash };
  const outdated = doc.formats.filter((f) => renders.find((r) => r.format === f)?.docHash !== hash);
  return { status: outdated.length === 0 ? "current" : "stale", outdated, hash };
}

/**
 * Default picture description: the headline and supporting line read as sentences.
 * @param doc - Design.
 * @returns Description, or "" when the design has no headline or supporting words.
 */
export function autoAltText(doc: DesignDoc): string {
  const parts = doc.layers
    .filter((l) => l.type === "text" && (l.role === "headline" || l.role === "support"))
    .map((l) => (l.type === "text" ? l.text.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean)
    .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`));
  return parts.join(" ").slice(0, 300);
}

/**
 * File name for a downloaded picture.
 * @param name - Design name.
 * @param format - Size.
 * @param scale - 1 or 2.
 * @param ext - "jpg" or "png".
 * @returns Name like "spring-promo-post-4-5-1080x1350.jpg".
 */
export function pictureFileName(
  name: string,
  format: FormatKey,
  scale: number,
  ext: "jpg" | "png",
): string {
  const f = FORMATS[format];
  /**
   * Lower-case words joined by hyphens.
   * @param s - Any text.
   * @returns Slug.
   */
  const slug = (s: string): string =>
    s
      // Macrons and other accents come off: "Māngere" > "mangere".
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return `${slug(name) || "design"}-${slug(f.label)}-${f.width * scale}x${f.height * scale}.${ext}`;
}

/** Blob path prefix of exported pictures; clean-up only ever deletes files under it. */
export const RENDER_PREFIX = "social-design/render-";

/**
 * Whether an address is an exported picture, as opposed to an uploaded photo.
 * @param url - Blob address.
 * @returns True for an export.
 */
export function isRenderUrl(url: string): boolean {
  return new URL(url, "https://x.invalid").pathname.startsWith(`/${RENDER_PREFIX}`);
}
