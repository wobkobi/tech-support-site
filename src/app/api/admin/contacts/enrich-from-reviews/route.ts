// src/app/api/admin/contacts/enrich-from-reviews/route.ts
// Admin trigger returning contacts whose reviewer name differs from the stored name.

import { enrichContactsFromReviews } from "@/features/contacts/lib/maintenance";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/enrich-from-reviews
 * Returns a name conflict per Contact whose reviewer name differs from the stored name.
 * @param request - Incoming request.
 * @returns JSON with a conflicts array for manual resolution.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const conflicts = await enrichContactsFromReviews();
  return NextResponse.json({ ok: true, conflicts });
}
