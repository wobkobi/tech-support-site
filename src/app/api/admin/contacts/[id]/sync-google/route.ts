// src/app/api/admin/contacts/[id]/sync-google/route.ts
/**
 * @file route.ts
 * @description Admin API to sync a single contact to Google Contacts.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";

/**
 * POST /api/admin/contacts/[id]/sync-google
 * Syncs the specified contact to Google Contacts.
 * Never throws — all errors are captured and returned as { ok: false, error }.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route segment params wrapper.
 * @param params.params - Promise resolving to the route segment containing the contact ID.
 * @returns JSON with { ok: true } on success, or { ok: false, error } on failure.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await syncContactToGoogle(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/contacts/${id}/sync-google] POST error:`, error);
    return NextResponse.json({ ok: false, error: "Sync failed" });
  }
}
