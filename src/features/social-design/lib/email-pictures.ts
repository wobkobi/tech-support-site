// src/features/social-design/lib/email-pictures.ts
// Exported design pictures an email can use: what the mail Picture block's "Use a design" picker
// offers, and what Draft with AI may reuse instead of making a new picture.

import { docHash, parseDesignDoc } from "@/features/social-design/lib/doc";
import { FORMATS, isFormatKey, type FormatKey } from "@/features/social-design/lib/formats";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
import { autoAltText } from "@/features/social-design/lib/pictures";
import { prisma } from "@/shared/lib/prisma";

const MAX_DESIGNS = 40;
// Stories are too tall for email and profile pictures get cropped to a circle.
const NOT_FOR_EMAIL = new Set<FormatKey>(["story", "profile"]);

/** One stored size of a design. */
export interface DesignPicture {
  format: FormatKey;
  label: string;
  url: string;
  width: number;
  height: number;
}

/** A design on offer, with its pictures. */
export interface DesignPictures {
  id: string;
  name: string;
  /** Description for the email: the design's own, or one from its headline. */
  alt: string;
  /** Whether every picture still matches the design and the live contact and promo. */
  current: boolean;
  /** Widest first, so the first suits an email best. */
  pictures: DesignPicture[];
}

/**
 * Designs with an exported picture an email can use, most recently changed first.
 * @returns The designs.
 */
export async function loadEmailPictures(): Promise<DesignPictures[]> {
  const [rows, bound] = await Promise.all([
    prisma.socialDesign.findMany({
      where: { isTemplate: false, renders: { isEmpty: false } },
      orderBy: { updatedAt: "desc" },
      take: MAX_DESIGNS,
    }),
    loadBoundValues(),
  ]);

  const designs: DesignPictures[] = [];
  for (const row of rows) {
    const parsed = parseDesignDoc(row.doc);
    const doc = "error" in parsed ? null : parsed.doc;
    const hash = doc ? docHash(doc, bound) : null;
    const pictures = row.renders
      .filter((r) => isFormatKey(r.format) && !NOT_FOR_EMAIL.has(r.format))
      .map((r) => ({
        format: r.format as FormatKey,
        label: FORMATS[r.format as FormatKey].label,
        url: r.url,
        width: r.width,
        height: r.height,
      }))
      .toSorted((a, b) => a.height / a.width - b.height / b.width);
    if (pictures.length === 0) continue;
    designs.push({
      id: row.id,
      name: row.name,
      alt: (doc?.altText.trim() || (doc ? autoAltText(doc) : "")).slice(0, 200),
      current: hash !== null && row.renders.every((r) => r.docHash === hash),
      pictures,
    });
  }
  return designs;
}
