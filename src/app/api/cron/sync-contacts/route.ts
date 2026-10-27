// src/app/api/cron/sync-contacts/route.ts
// Cron (every few hours) running the incremental two-way Google Contacts sync: local
// dedup, push changes, then pull Google's.

import { runContactsSync } from "@/features/contacts/lib/contacts-sync";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/sync-contacts
 * Runs an incremental two-way Google Contacts sync.
 * @param request - Incoming cron request.
 * @returns JSON with the pushed, failed, unreached, imported and conflict counts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const result = await runContactsSync({});
    // Failed contacts are tried again next run; the 500 makes cron-job.org flag this one. A
    // rate limit counts its one contact as failed but only pauses the sync, so it isn't one.
    const hardFailures = result.failed - (result.rateLimited ? 1 : 0);
    return NextResponse.json(
      { ok: hardFailures <= 0, ...result },
      { status: hardFailures > 0 ? 500 : 200 },
    );
  } catch (err) {
    console.error("[cron/sync-contacts] failed:", err);
    return errorResponse("Contact sync failed", 503);
  }
}
