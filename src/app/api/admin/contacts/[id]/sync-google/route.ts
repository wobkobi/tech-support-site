// src/app/api/admin/contacts/[id]/sync-google/route.ts
// Admin API to sync a single contact to Google Contacts.

import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/[id]/sync-google
 * Syncs the contact with Google Contacts.
 * @param request - Incoming request.
 * @param params - Route segment params wrapper.
 * @param params.params - Promise resolving to the route segment containing the contact ID.
 * @returns JSON `{ ok: true }`; 409 when the contact isn't one that syncs, 429 when Google is
 *   rate-limiting, 502 when the Google call failed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;

  const outcome = await syncContactToGoogle(id);
  if (outcome === "skipped") {
    return errorResponse("Only a live contact with an email syncs with Google.", 409);
  }
  if (outcome === "rate-limited") {
    return errorResponse("Google is limiting requests. Try again in a few minutes.", 429);
  }
  if (outcome === "failed") return errorResponse("Couldn't sync with Google just now.", 502);
  return NextResponse.json({ ok: true });
}
