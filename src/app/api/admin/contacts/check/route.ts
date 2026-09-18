// src/app/api/admin/contacts/check/route.ts
// Lightweight contact lookup by email. The post-save "Add to contacts?" popup uses
// `exists` to decide whether to prompt; the calculator uses `contactId` to link an
// invoice to a customer who is already on file, and `existingContactId` for one matched
// by Google link who is on file without this email.

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/contacts/check?email=...&googleContactId=...
 * Returns { exists, contactId } for the given email (case-insensitive). Empty
 * or invalid email returns exists=false so callers can fail-quiet. On an email
 * miss, an optional googleContactId that matches a live contact fills
 * `existingContactId` and `existingContactName`.
 * @param request - Incoming request.
 * @returns JSON { ok, exists, contactId, existingContactId?, existingContactName? }.
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
  if (hit) return NextResponse.json({ ok: true, exists: true, contactId: hit.id });

  // Email not on file, but the client was picked from Google: the contact may exist
  // without this email. Report it so the invoice links to it and the popup offers to
  // add the email to it rather than to add a new contact.
  const googleContactId = request.nextUrl.searchParams.get("googleContactId")?.trim();
  const linked = googleContactId
    ? await prisma.contact.findFirst({
        where: { googleContactId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      })
    : null;
  return NextResponse.json({
    ok: true,
    exists: false,
    contactId: null,
    existingContactId: linked?.id ?? null,
    existingContactName: linked?.name ?? null,
  });
}
