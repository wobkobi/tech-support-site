// src/app/api/admin/mailing/opt-outs/route.ts
// Operator-side unsubscribe for someone who asks by phone or reply, and the email asking
// someone who wants back on to confirm it.

import { parseObjectId } from "@/features/business/lib/validation";
import { optOutContact } from "@/features/mailing/lib/opt-out";
import { askToResubscribe } from "@/features/mailing/lib/resubscribe-ask";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/mailing/opt-outs
 * Body: `{ action: "unsubscribe" | "ask-resubscribe", contactId }`. ask-resubscribe only
 * sends the email; they're back on the list once they press its button.
 * @param request - Incoming request.
 * @returns JSON `{ ok }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    contactId?: unknown;
  } | null;
  const contactId = parseObjectId(body?.contactId);
  if (!contactId) return errorResponse("contactId isn't a valid id.", 400);

  if (body?.action === "ask-resubscribe") {
    const asked = await askToResubscribe(contactId);
    return asked.ok ? okResponse() : errorResponse(asked.error, asked.status);
  }
  if (body?.action === "unsubscribe") {
    const done = await optOutContact(contactId, "manual");
    return done ? okResponse() : errorResponse("That contact has no email address.", 404);
  }
  return errorResponse('action must be "unsubscribe" or "ask-resubscribe".', 400);
}
