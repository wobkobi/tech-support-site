// src/app/api/admin/mailing/upload/route.ts
// Stores an email image in the public Blob store.

import { handleImageUpload } from "@/shared/lib/image-upload";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/mailing/upload - multipart form with a `file` field.
 * @param request - Incoming request.
 * @returns JSON `{ url }` of the stored image.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleImageUpload(request, "mailing");
}
