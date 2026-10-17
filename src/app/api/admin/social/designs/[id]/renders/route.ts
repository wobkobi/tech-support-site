// src/app/api/admin/social/designs/[id]/renders/route.ts
// Stores one size's exported picture. The browser draws each size at its exact pixel
// size and sends them one at a time, so a failed upload is retried for that size alone.
// The file is kept as drawn: never shrunk, since it is already the size the app wants.

import { parseObjectId } from "@/features/business/lib/validation";
import { parseDesignDoc } from "@/features/social-design/lib/doc";
import { FORMATS, isFormatKey } from "@/features/social-design/lib/formats";
import {
  deleteUnusedPictures,
  writeKeepingUpdatedAt,
} from "@/features/social-design/lib/picture-store";
import { RENDER_PREFIX } from "@/features/social-design/lib/pictures";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { canUploadImages } from "@/shared/lib/image-upload";
import { jpegSize } from "@/shared/lib/jpeg-size";
import { prisma } from "@/shared/lib/prisma";
import type { DesignRender } from "@prisma/client";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

// Under the 4.5 MB function body limit; a 1x export at quality 0.9 is well under 1 MB.
const MAX_BYTES = 4 * 1024 * 1024;

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/social/designs/[id]/renders - multipart form with `format`,
 * `docHash` (the design's fingerprint as drawn) and `file` (a JPEG at the size's exact
 * pixel size).
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the design id.
 * @returns JSON `{ render }`, 503 when uploads are off.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  if (!canUploadImages()) {
    return errorResponse("Pictures can't be stored until BLOB_READ_WRITE_TOKEN is set.", 503);
  }
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Design not found.", 404);

  const form = await request.formData().catch(() => null);
  const format = form?.get("format");
  const docHash = form?.get("docHash");
  const file = form?.get("file");
  if (typeof format !== "string" || !isFormatKey(format)) {
    return errorResponse("format isn't a known size.", 400);
  }
  if (typeof docHash !== "string" || !/^[0-9a-f]{16}$/.test(docHash)) {
    return errorResponse("docHash is missing.", 400);
  }
  if (!(file instanceof File) || file.type !== "image/jpeg") {
    return errorResponse("Send the picture as a JPEG.", 400);
  }
  if (file.size > MAX_BYTES) return errorResponse("That picture is over 4 MB.", 400);

  // The stored size is what the file really is, checked against the size it's for:
  // Instagram's width rules are judged on these numbers.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = jpegSize(bytes);
  const want = FORMATS[format];
  if (!size || size.width !== want.width || size.height !== want.height) {
    return errorResponse(`The ${want.label} picture must be ${want.width}x${want.height}.`, 400);
  }

  const design = await prisma.socialDesign.findUnique({ where: { id }, select: { doc: true } });
  if (!design) return errorResponse("Design not found.", 404);
  const parsed = parseDesignDoc(design.doc);
  if ("error" in parsed || !parsed.doc.formats.includes(format)) {
    return errorResponse("This design doesn't have that size any more.", 409);
  }

  let url: string;
  try {
    // Random suffix: a post that used the last picture keeps pointing at it.
    url = (
      await put(`${RENDER_PREFIX}${format}.jpg`, file, {
        access: "public",
        addRandomSuffix: true,
        contentType: "image/jpeg",
      })
    ).url;
  } catch (error) {
    console.error("[social-design/renders] upload failed:", error);
    return errorResponse("Couldn't store the picture.", 500);
  }

  const render: DesignRender = {
    format,
    url,
    width: size.width,
    height: size.height,
    docHash,
    renderedAt: new Date(),
  };
  // Sizes no longer in the design drop out with this write.
  const sizes = new Set<string>(parsed.doc.formats);
  /**
   * Whether a stored picture stays: another size the design still has.
   * @param r - Stored picture.
   * @returns True to keep it.
   */
  const kept = (r: DesignRender): boolean => r.format !== format && sizes.has(r.format);
  const before = await writeKeepingUpdatedAt(id, (d) => ({
    renders: [...d.renders.filter(kept), render],
  }));
  if (!before) {
    await deleteUnusedPictures([url]);
    return errorResponse("Design not found.", 404);
  }
  await deleteUnusedPictures(before.renders.filter((r) => !kept(r)).map((r) => r.url));
  return okResponse({ render: { ...render, renderedAt: render.renderedAt.toISOString() } });
}
