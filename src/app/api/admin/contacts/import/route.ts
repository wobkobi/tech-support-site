// src/app/api/admin/contacts/import/route.ts
/**
 * @description Admin API route to import contacts from Google Contacts.
 */

import { importFromGoogleContacts } from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/contacts/import
 * Imports all contacts from Google Contacts into the local database.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with importedCount on success, or error on failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const importedCount = await importFromGoogleContacts();
    return NextResponse.json({ ok: true, importedCount });
  } catch (error) {
    console.error("[api/admin/contacts/import] Error:", error);
    // Generic message to the client; the OAuth / Google API detail goes only
    // to the server log so a transient Google failure can't leak credential
    // shape or integration internals.
    return errorResponse("Contact import failed.", 500);
  }
}
