// src/app/api/admin/reviews/match-contacts/route.ts
/**
 * @description Admin trigger to link reviews to contacts by email, phone, or token.
 * Delegates to the shared contacts maintenance module so this route and the
 * admin-page auto-maintain use identical matching (including the ambiguous-phone
 * guard that skips numbers shared by more than one contact).
 */

import { matchReviewsToContacts } from "@/features/contacts/lib/maintenance";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/reviews/match-contacts
 * Links reviews that have no contactId to their matching Contact.
 * Requires X-Admin-Secret header.
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
