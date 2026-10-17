// src/app/api/admin/social/designs/photos/route.ts
// Recent photos for the post maker's photo picker: every photo already used in a
// design or template (photo layers and photo backdrops), newest design first, so the
// same photo can go into another design without uploading it again.

import { isAllowedImageUrl } from "@/features/social-design/lib/doc";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const MAX_PHOTOS = 60;
// Designs scanned for photos; older ones rarely hold a photo that newer ones don't.
const MAX_DESIGNS = 200;

/** A photo on offer, with its size when a photo layer recorded it. */
interface RecentPhoto {
  url: string;
  width: number | null;
  height: number | null;
}

/**
 * Photos in one stored document. Read loosely: a document that fails the full check
 * can still offer its photos, and only addresses on the site's Blob store come back.
 * @param doc - Stored document JSON.
 * @returns Photos in stack order, top layer first.
 */
function photosIn(doc: unknown): RecentPhoto[] {
  const layers = (doc as { layers?: unknown } | null)?.layers;
  if (!Array.isArray(layers)) return [];
  const out: RecentPhoto[] = [];
  for (const raw of [...layers].reverse()) {
    const l = raw as Record<string, unknown> | null;
    if (!l || typeof l.src !== "string" || !isAllowedImageUrl(l.src)) continue;
    if (l.type === "image") {
      out.push({
        url: l.src,
        width: typeof l.naturalWidth === "number" ? l.naturalWidth : null,
        height: typeof l.naturalHeight === "number" ? l.naturalHeight : null,
      });
    } else if (l.type === "backdrop" && l.source === "photo") {
      out.push({ url: l.src, width: null, height: null });
    }
  }
  return out;
}

/**
 * GET /api/admin/social/designs/photos - photos used in designs, newest first.
 * @param request - Incoming request.
 * @returns JSON `{ photos }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const rows = await prisma.socialDesign.findMany({
    orderBy: { updatedAt: "desc" },
    take: MAX_DESIGNS,
    select: { doc: true },
  });
  const seen = new Set<string>();
  const photos: RecentPhoto[] = [];
  for (const row of rows) {
    for (const photo of photosIn(row.doc)) {
      if (seen.has(photo.url)) continue;
      seen.add(photo.url);
      photos.push(photo);
      if (photos.length >= MAX_PHOTOS) return noStore(okResponse({ photos }));
    }
  }
  return noStore(okResponse({ photos }));
}
