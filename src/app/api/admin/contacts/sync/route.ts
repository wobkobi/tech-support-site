// src/app/api/admin/contacts/sync/route.ts
/**
 * @description Admin API route for the manual full two-way Google Contacts sync.
 * Shares {@link runContactsSync} with the cron; the button force-pushes every
 * contact (full mode) rather than just the changed ones.
 */

import { runContactsSync } from "@/features/contacts/lib/contacts-sync";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Full mode pushes EVERY email-bearing contact (sequential People API calls
// at ~1s each), so the run scales with the contact count; give it the full
// serverless ceiling.
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
    const { pushed, imported } = await runContactsSync({ full: true });
    return NextResponse.json({ ok: true, importedCount: imported, syncedCount: pushed });
  } catch (error) {
    console.error("[api/admin/contacts/sync] Error:", error);
    // Generic message to the client; the OAuth / Google API detail goes only
    // to the server log so a transient Google failure can't leak the shape of
    // the credentials or the integration internals.
    return errorResponse("Contact sync failed.", 500);
  }
}
