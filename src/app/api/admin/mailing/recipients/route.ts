// src/app/api/admin/mailing/recipients/route.ts
// Who a mailing-list email would go to right now, and who has unsubscribed.

import { parseAudience } from "@/features/mailing/lib/audience";
import { loadRecipients } from "@/features/mailing/lib/recipients";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/mailing/recipients?audience=everyone|site_reviewers
 * @param request - Incoming request; `audience` defaults to everyone.
 * @returns JSON `{ subscribed, unsubscribed }`, each a list of `{ contactId, name, email }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const raw = request.nextUrl.searchParams.get("audience");
  const audience = raw === null ? "everyone" : parseAudience(raw);
  if (!audience) return errorResponse('audience must be "everyone" or "site_reviewers".', 400);
  const { recipients, optedOut } = await loadRecipients([], audience);
  return okResponse({ subscribed: recipients, unsubscribed: optedOut });
}
