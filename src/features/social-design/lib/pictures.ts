// src/features/social-design/lib/pictures.ts
// The exported pictures of a design: whether they still match it, what a paid ad
// leaves off, the picture description written for the post when none is typed, and
// download file names. Pure, so the editor, the composer and the server agree.

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
 * Whether a layer is left off the pictures of a paid ad. Paid ads carry no contact
 * details: Meta's own button does that job.
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
 * Picture description for a post when the operator hasn't typed one: the headline and
 * the supporting line, read as sentences.
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

/**
 * Pixel size of a JPEG, read from its frame header, so the server stores what the file
 * really is rather than what the browser says it is.
 * @param bytes - The file.
 * @returns Width and height, or null when it isn't a readable JPEG.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  /**
   * One byte, 0 past the end.
   * @param k - Offset.
   * @returns Byte value.
   */
  const at = (k: number): number => bytes[k] ?? 0;
  if (at(0) !== 0xff || at(1) !== 0xd8) return null;
  let i = 2;
  while (i + 8 < bytes.length) {
    if (at(i) !== 0xff) return null;
    const marker = at(i + 1);
    // 0xFF runs are padding before a marker.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Restart and TEM markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // Start-of-frame markers C0-CF hold the size, except C4 (Huffman tables), C8
    // (reserved) and CC (arithmetic coding). Layout: length(2) precision(1) height(2) width(2).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (at(i + 5) << 8) | at(i + 6),
        width: (at(i + 7) << 8) | at(i + 8),
      };
    }
    i += 2 + ((at(i + 2) << 8) | at(i + 3));
  }
  return null;
}
