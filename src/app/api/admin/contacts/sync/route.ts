// src/app/api/admin/contacts/sync/route.ts
/**
 * @file route.ts
 * @description Admin API route for two-way Google Contacts sync.
 * Imports all Google contacts into the local DB, then pushes all local contacts to Google.
 */

import {
  importFromGoogleContacts,
  syncAllContactsToGoogle,
} from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/contacts/sync
 * Two-way sync: pulls all Google contacts into the local DB, then pushes all local contacts to Google.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with importedCount and syncedCount on success, or error on failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // Push local contacts to Google first so local edits are not overwritten by the import.
    const syncedCount = await syncAllContactsToGoogle();
    // Then pull new Google contacts in (existing records only get googleContactId linked).
    const importedCount = await importFromGoogleContacts();
    return NextResponse.json({ ok: true, importedCount, syncedCount });
  } catch (error) {
    console.error("[api/admin/contacts/sync] Error:", error);
    // Generic message to the client; the OAuth / Google API detail goes only
    // to the server log so a transient Google failure can't leak the shape of
    // the credentials or the integration internals.
    return errorResponse("Contact sync failed.", 500);
  }
}
