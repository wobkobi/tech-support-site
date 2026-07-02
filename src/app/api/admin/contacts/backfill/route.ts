// src/app/api/admin/contacts/backfill/route.ts
/**
 * @description Admin trigger for the booking-to-contact backfill. Merges phone-only
 * duplicate contacts, then creates a Contact for every unique booking email that has
 * no live contact yet. The logic lives in the shared contacts maintenance module so
 * this route and the admin-page auto-maintain can never diverge.
 */

import {
  backfillContactsFromBookings,
  mergePhoneOnlyContacts,
} from "@/features/contacts/lib/maintenance";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/contacts/backfill
 * Merges phone-only duplicates then upserts a Contact per unique booking email.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with the number of contacts created.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  await mergePhoneOnlyContacts();
  const upsertedCount = await backfillContactsFromBookings();
  return NextResponse.json({ ok: true, upsertedCount });
}
