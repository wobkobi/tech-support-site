// src/app/api/admin/reviews/match-contacts/route.ts
// Admin trigger to link reviews to contacts by email, phone or token (same matching as the cron).

import { matchReviewsToContacts } from "@/features/contacts/lib/maintenance";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/reviews/match-contacts
 * Links reviews that have no contactId to their matching Contact.
 * @param request - Incoming request.
 * @returns JSON with { ok: true, matchedCount } on success, or error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const matchedCount = await matchReviewsToContacts();
    return NextResponse.json({ ok: true, matchedCount });
  } catch (error) {
    console.error("[admin/reviews/match-contacts] POST error:", error);
    return errorResponse("Failed to match contacts", 500);
  }
}
