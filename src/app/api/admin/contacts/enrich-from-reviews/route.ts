// src/app/api/admin/contacts/enrich-from-reviews/route.ts
/**
 * @description Admin trigger that returns review-sourced name conflicts (where a
 * reviewer's full name differs from the linked Contact's stored name) for manual
 * resolution. The comparison lives in the shared contacts maintenance module.
 */

import { enrichContactsFromReviews } from "@/features/contacts/lib/maintenance";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/contacts/enrich-from-reviews
 * Returns a name conflict per Contact whose reviewer display name differs from
 * the stored name. Requires X-Admin-Secret header.
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
