// src/app/api/admin/contacts/check/route.ts
/**
 * @description Lightweight contact lookup by email. The post-save "Add to
 * contacts?" popup uses `exists` to decide whether to prompt; the calculator
 * uses `contactId` to link an invoice to a customer who is already on file.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/contacts/check?email=...
 * Returns { exists, contactId } for the given email (case-insensitive). Empty
 * or invalid email returns exists=false so callers can fail-quiet.
 * @param request - Incoming request.
 * @returns JSON { ok, exists, contactId }.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const email = normaliseEmail(request.nextUrl.searchParams.get("email"));
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: true, exists: false, contactId: null });
  }

  const hit = await prisma.contact.findFirst({
    where: {
      OR: [{ email: { equals: email, mode: "insensitive" } }, { altEmails: { has: email } }],
      deletedAt: null,
    },
    select: { id: true },
  });
  // The id was always selected but never returned, so a customer already on
  // file could not be linked to their invoice.
  return NextResponse.json({ ok: true, exists: Boolean(hit), contactId: hit?.id ?? null });
}
