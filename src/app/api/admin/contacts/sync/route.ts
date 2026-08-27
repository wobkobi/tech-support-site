// src/app/api/admin/contacts/sync/route.ts
/**
 * @description Admin API route for the manual full two-way Google Contacts sync.
 * Shares {@link runContactsSync} with the cron; the button force-pushes every
 * contact (full mode) rather than just the changed ones.
 */

import { CONTACTS_SYNC_LOCK_KEY, runContactsSync } from "@/features/contacts/lib/contacts-sync";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { isRunLocked } from "@/shared/lib/run-lock";
import { NextRequest, NextResponse } from "next/server";

// Full mode pushes EVERY email-bearing contact at ~1s per sequential People API
// call, so the run scales with the contact count - give it the full ceiling.
export const maxDuration = 300;

/**
 * POST /api/admin/contacts/sync
 * Full two-way sync: dedup/merge locally, push every contact to Google, then pull
 * Google contacts back in. Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with importedCount and syncedCount on success, or error on failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const { pushed, imported, alreadyRunning } = await runContactsSync({ full: true });
    if (alreadyRunning) {
      // 409, not 200: the button's local state resets on navigate-away, so without this
      // a second sync could race the merge passes that hard-delete duplicate contacts.
      return errorResponse("A contact sync is already running. Give it a minute.", 409);
    }
    return NextResponse.json({ ok: true, importedCount: imported, syncedCount: pushed });
  } catch (error) {
    console.error("[api/admin/contacts/sync] Error:", error);
    // Generic message to the client; the OAuth / Google detail stays in the server log
    // so a transient failure can't leak the integration internals.
    return errorResponse("Contact sync failed.", 500);
  }
}

/**
 * GET /api/admin/contacts/sync
 * Whether a sync is currently running, so the admin button can show real state
 * instead of a flag that resets whenever the operator navigates away and back.
 * @param request - Incoming request.
 * @returns JSON `{ ok, running }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  return NextResponse.json({ ok: true, running: await isRunLocked(CONTACTS_SYNC_LOCK_KEY) });
}
