// src/shared/lib/image-upload.ts
// Stores an admin-uploaded image in the public Blob store, for the mailing and social
// editors. The editors shrink images in the browser first, so uploads are a few hundred
// KB and fit well inside the function body limit; the 5 MB cap only stops something
// unshrunk slipping through.

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
 * Whether image uploads are available.
 * @returns True when the Blob token is set.
 */
export function canUploadImages(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * Handles an admin image upload: a multipart form with a `file` field.
 * @param request - Incoming request.
 * @param folder - Blob path prefix, like "mailing" or "social".
 * @returns JSON `{ url }` of the stored image, or an error response.
 */
export async function handleImageUpload(
  request: NextRequest,
  folder: string,
): Promise<NextResponse> {
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
    // since a sent email or published post keeps pointing at its image forever.
    const blob = await put(`${folder}/image.${ext}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });
    return okResponse({ url: blob.url });
  } catch (error) {
    console.error(`[${folder}/upload] Error:`, error);
    return errorResponse("Couldn't upload the image.", 500);
  }
}
