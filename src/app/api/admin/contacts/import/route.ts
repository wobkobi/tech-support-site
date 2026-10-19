// src/app/api/admin/contacts/import/route.ts
// Admin API route to import contacts from Google Contacts.

import { importFromGoogleContacts } from "@/features/contacts/lib/google-contacts";
import { normaliseSoftDeleteField } from "@/features/contacts/lib/maintenance";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/import
 * Imports all contacts from Google Contacts into the local database.
 * @param request - Incoming request.
 * @returns JSON with importedCount on success, or error on failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // A missing deletedAt key hides rows from `deletedAt: null` readers and duplicates the import.
    await normaliseSoftDeleteField();
    const importedCount = await importFromGoogleContacts();
    return NextResponse.json({ ok: true, importedCount });
  } catch (error) {
    console.error("[api/admin/contacts/import] Error:", error);
    // Generic message to the client; Google/OAuth detail stays in the server log.
    return errorResponse("Contact import failed.", 500);
  }
}
