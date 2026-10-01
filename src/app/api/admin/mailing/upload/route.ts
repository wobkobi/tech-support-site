// src/app/api/admin/mailing/upload/route.ts
// Stores an email image in the public Blob store. The editor shrinks images in the
// browser first, so uploads are a few hundred KB and fit well inside the function body
// limit; the 5 MB cap only stops something unshrunk slipping through.

import { canUploadImages } from "@/features/mailing/lib/context";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * POST /api/admin/mailing/upload - multipart form with a `file` field.
 * @param request - Incoming request.
 * @returns JSON `{ url }` of the stored image.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  if (!canUploadImages()) {
    return errorResponse("Images are off until BLOB_READ_WRITE_TOKEN is set.", 503);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return errorResponse("No image was sent.", 400);
  const ext = EXTENSIONS[file.type];
  if (!ext) return errorResponse("Use a JPEG, PNG or WebP image.", 400);
  if (file.size > MAX_BYTES) return errorResponse("That image is over 5 MB.", 400);

  try {
    // Random suffix: two uploads called "photo.jpg" must not overwrite each other,
    // since a sent email keeps pointing at its image forever.
    const blob = await put(`mailing/image.${ext}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });
    return okResponse({ url: blob.url });
  } catch (error) {
    console.error("[admin/mailing/upload] Error:", error);
    return errorResponse("Couldn't upload the image.", 500);
  }
}
