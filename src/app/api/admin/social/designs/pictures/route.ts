// src/app/api/admin/social/designs/pictures/route.ts
// Exported design pictures for the mail Picture block's "Use a design" picker, newest
// first, with whether each still matches its design.

import { docHash, parseDesignDoc } from "@/features/social-design/lib/doc";
import { FORMATS, isFormatKey, type FormatKey } from "@/features/social-design/lib/formats";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
import { autoAltText } from "@/features/social-design/lib/pictures";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const MAX_DESIGNS = 40;
// Stories are too tall for email and profile pictures get cropped to a circle.
const NOT_FOR_EMAIL = new Set<FormatKey>(["story", "profile"]);

/** One stored size of a design. */
interface DesignPicture {
  format: FormatKey;
  label: string;
  url: string;
  width: number;
  height: number;
}

/** A design on offer, with its pictures. */
interface DesignPictures {
  id: string;
  name: string;
  /** Description for the email: the design's own, or one from its headline. */
  alt: string;
  /** Whether every picture still matches the design and the live contact and promo. */
  current: boolean;
  pictures: DesignPicture[];
}

/**
 * GET /api/admin/social/designs/pictures - exported design pictures for an email.
 * @param request - Incoming request.
 * @returns JSON `{ designs }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
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
  return noStore(okResponse({ designs }));
}
