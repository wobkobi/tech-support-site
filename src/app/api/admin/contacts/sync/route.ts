// src/app/api/admin/contacts/sync/route.ts
// Manual full two-way Google Contacts sync (runContactsSync in full mode).

import { CONTACTS_SYNC_LOCK_KEY, runContactsSync } from "@/features/contacts/lib/contacts-sync";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { isRunLocked } from "@/shared/lib/run-lock";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/sync
 * Full two-way sync: dedup locally, push every contact to Google, then pull back.
 * @param request - Incoming request.
 * @returns JSON with the imported, synced, failed and unreached counts, or error on failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const result = await runContactsSync({ full: true });
    if (result.alreadyRunning) {
      // 409 so a second sync can't race the merge passes.
      return errorResponse("A contact sync is already running. Give it a minute.", 409);
    }
    return NextResponse.json({
      ok: true,
      importedCount: result.imported,
      syncedCount: result.pushed,
      failedCount: result.failed,
      leftCount: result.left,
      rateLimited: result.rateLimited,
    });
  } catch (error) {
    console.error("[api/admin/contacts/sync] Error:", error);
    // Generic message to the client; Google detail stays in the server log.
    return errorResponse("Contact sync failed.", 500);
  }
}

/**
 * GET /api/admin/contacts/sync
 * Whether a sync is running, so the button shows real state.
 * @param request - Incoming request.
 * @returns JSON `{ ok, running }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  return NextResponse.json({ ok: true, running: await isRunLocked(CONTACTS_SYNC_LOCK_KEY) });
}
