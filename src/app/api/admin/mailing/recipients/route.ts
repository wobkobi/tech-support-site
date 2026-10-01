// src/app/api/admin/mailing/recipients/route.ts
// Who's on the mailing list right now, and who has unsubscribed.

import { loadRecipients } from "@/features/mailing/lib/recipients";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/mailing/recipients
 * @param request - Incoming request.
 * @returns JSON `{ subscribed, unsubscribed }`, each a list of `{ contactId, name, email }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const { recipients, optedOut } = await loadRecipients();
  return okResponse({ subscribed: recipients, unsubscribed: optedOut });
}
