// src/app/api/admin/social/designs/upload/route.ts
// Stores a photo placed in a post maker design in the public Blob store, which serves
// it with CORS so the canvas can export it.

import { handleImageUpload } from "@/shared/lib/image-upload";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/designs/upload - multipart form with a `file` field.
 * @param request - Incoming request.
 * @returns JSON `{ url }` of the stored image.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleImageUpload(request, "social-design");
}
