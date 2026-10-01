// src/app/api/admin/mailing/opt-outs/route.ts
// Operator-side unsubscribe and resubscribe, for someone who asks by phone or reply.

import { parseObjectId } from "@/features/business/lib/validation";
import { optOutContact, resubscribeContact } from "@/features/mailing/lib/opt-out";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/mailing/opt-outs
 * Body: `{ action: "unsubscribe" | "resubscribe", contactId }`.
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

  if (body?.action === "resubscribe") {
    await resubscribeContact(contactId);
    return okResponse();
  }
  if (body?.action === "unsubscribe") {
    const done = await optOutContact(contactId, "manual");
    return done ? okResponse() : errorResponse("That contact has no email address.", 404);
  }
  return errorResponse('action must be "unsubscribe" or "resubscribe".', 400);
}
