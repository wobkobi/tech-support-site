// src/app/api/admin/contacts/sync/route.ts
/**
 * @file route.ts
 * @description Admin API route for two-way Google Contacts sync.
 * Imports all Google contacts into the local DB, then pushes all local contacts to Google.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import {
  importFromGoogleContacts,
  syncAllContactsToGoogle,
} from "@/features/contacts/lib/google-contacts";

/**
 * POST /api/admin/contacts/sync
 * Two-way sync: pulls all Google contacts into the local DB, then pushes all local contacts to Google.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with importedCount and syncedCount on success, or error on failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Push local contacts to Google first so local edits are not overwritten by the import.
    const syncedCount = await syncAllContactsToGoogle();
    // Then pull new Google contacts in (existing records only get googleContactId linked).
    const importedCount = await importFromGoogleContacts();
    return NextResponse.json({ ok: true, importedCount, syncedCount });
  } catch (error) {
    console.error("[api/admin/contacts/sync] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
