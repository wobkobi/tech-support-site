// src/app/api/admin/social/upload/route.ts
// Stores a social post picture in the public Blob store, where Meta fetches it from.

import { handleImageUpload } from "@/shared/lib/image-upload";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/upload - multipart form with a `file` field.
 * @param request - Incoming request.
 * @returns JSON `{ url }` of the stored image.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleImageUpload(request, "social");
}
