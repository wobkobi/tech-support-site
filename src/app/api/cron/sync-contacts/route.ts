// src/app/api/cron/sync-contacts/route.ts
/**
 * @description Cron endpoint (Bearer-authorised) that runs the incremental two-way
 * Google Contacts sync via {@link runContactsSync}: local dedup/merge first, then
 * push the changed contacts, then pull Google's changes back. Designed to run every
 * few hours via cron-job.org and returns 503 when the sync throws.
 */

import { runContactsSync } from "@/features/contacts/lib/contacts-sync";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (Google People API) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/sync-contacts
 * Runs an incremental two-way Google Contacts sync.
 * Run every few hours via cron-job.org with Authorization: Bearer <CRON_SECRET>.
 * @param request - Incoming cron request.
 * @returns JSON with pushed/imported/conflicts/skipped counts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const result = await runContactsSync({});
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/sync-contacts] failed:", err);
    return errorResponse("Contact sync failed", 503);
  }
}
