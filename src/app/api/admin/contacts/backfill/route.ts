// src/app/api/admin/contacts/backfill/route.ts
// Admin trigger for the booking-to-contact backfill (shared with the sync-contacts cron).

import {
  backfillContactsFromBookings,
  mergePhoneOnlyContacts,
} from "@/features/contacts/lib/maintenance";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/backfill
 * Merges phone-only duplicates then upserts a Contact per unique booking email.
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
