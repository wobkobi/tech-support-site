// src/app/api/admin/contacts/check/route.ts
// Contact lookup by email for the "Add to contacts?" popup and invoice linking. A local miss
// is re-checked against Google; `linkedContactId` is the contact matched by Google link.

import { importGoogleContactByEmail } from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/contacts/check?email=...&googleContactId=...
 * Looks up a contact by email (case-insensitive; invalid gives exists=false), falling back
 * to Google, then to a `googleContactId` match for `existingContactId` and `linkedContactId`.
 * The existing contact's phone and address come back too, so the popup can show which of two
 * same-named people the email would go onto.
 * @param request - Incoming request.
 * @returns JSON { ok, exists, contactId, linkedContactId, existingContactId?, existingContactName?,
 *   existingContactPhone?, existingContactAddress? }.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const email = normaliseEmail(request.nextUrl.searchParams.get("email"));
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: true, exists: false, contactId: null });
  }

  const googleContactId = request.nextUrl.searchParams.get("googleContactId")?.trim();
  const linked = googleContactId
    ? await prisma.contact.findFirst({
        where: { googleContactId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, phone: true, address: true },
      })
    : null;
  const linkedContactId = linked?.id ?? null;

  const hit = await prisma.contact.findFirst({
    where: {
      OR: [{ email: { equals: email, mode: "insensitive" } }, { altEmails: { has: email } }],
      deletedAt: null,
    },
    select: { id: true },
  });
  if (hit) return NextResponse.json({ ok: true, exists: true, contactId: hit.id, linkedContactId });

  // The local table lags Google by a cron cycle, so ask Google; a hit is reconciled now.
  const reconciled = await importGoogleContactByEmail(email);
  if (reconciled) {
    return NextResponse.json({
      ok: true,
      exists: true,
      contactId: reconciled.contactId,
      linkedContactId,
    });
  }

  // Picked from Google but email unknown: report the contact so the email gets added to it.
  return NextResponse.json({
    ok: true,
    exists: false,
    contactId: null,
    linkedContactId,
    existingContactId: linkedContactId,
    existingContactName: linked?.name ?? null,
    existingContactPhone: linked?.phone ?? null,
    existingContactAddress: linked?.address ?? null,
  });
}
