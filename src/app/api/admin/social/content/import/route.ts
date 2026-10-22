// src/app/api/admin/social/content/import/route.ts
// Adds the starter content set to the library. Safe to run again: items already added are skipped.

import { importStarterContent } from "@/features/social/lib/starter-content.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/content/import
 * @param request - Incoming request.
 * @returns JSON `{ created, skipped }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  try {
    const result = await importStarterContent();
    if (!result.ok) return errorResponse(result.error, 409);
    return okResponse({ created: result.created, skipped: result.skipped });
  } catch (error) {
    console.error("[admin/social/content/import] Import failed:", error);
    return errorResponse("Couldn't add the starter content.", 500);
  }
}
