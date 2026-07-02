// src/app/api/admin/contacts/merge/route.ts
/**
 * @description Admin API to merge two Contact records into one. Reviews on the
 * secondary contact are reassigned to the primary, the primary's blank fields are
 * filled from the secondary, and the secondary is soft-deleted (its Google contact
 * removed best-effort). Used to collapse the duplicate a person creates by booking
 * under two different emails, which nothing merges automatically.
 */

import { deleteContactFromGoogle } from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

interface MergeBody {
  /** The contact to keep. Its non-blank fields win. */
  primaryId: string;
  /** The contact to merge away. Soft-deleted after its data/reviews move over. */
  secondaryId: string;
}

/**
 * POST /api/admin/contacts/merge
 * Merges the secondary contact into the primary and soft-deletes the secondary.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request with primaryId and secondaryId.
 * @returns JSON { ok: true } on success, or an error response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { primaryId, secondaryId } = (await request.json()) as MergeBody;
  if (!primaryId || !secondaryId) {
    return errorResponse("Both primaryId and secondaryId are required.", 400);
  }
  if (primaryId === secondaryId) {
    return errorResponse("Cannot merge a contact into itself.", 400);
  }

  const [primary, secondary] = await Promise.all([
    prisma.contact.findUnique({ where: { id: primaryId } }),
    prisma.contact.findUnique({ where: { id: secondaryId } }),
  ]);
  if (!primary || !secondary) {
    return errorResponse("Contact not found.", 404);
  }

  // Fill only the primary's blanks from the secondary; the primary keeps its own
  // non-blank values and its reviewToken (moved reviews resolve by contactId).
  const fill: Record<string, string> = {};
  if (!primary.phone && secondary.phone) fill.phone = secondary.phone;
  if (!primary.email && secondary.email) fill.email = secondary.email;
  if (!primary.address && secondary.address) fill.address = secondary.address;

  try {
    await prisma.$transaction([
      prisma.review.updateMany({
        where: { contactId: secondaryId },
        data: { contactId: primaryId },
      }),
      ...(Object.keys(fill).length > 0
        ? [prisma.contact.update({ where: { id: primaryId }, data: fill })]
        : []),
      prisma.contact.update({ where: { id: secondaryId }, data: { deletedAt: new Date() } }),
    ]);
  } catch (error) {
    console.error("[admin/contacts/merge] POST error:", error);
    return errorResponse("Failed to merge contacts.", 500);
  }

  // Best-effort: remove the now-defunct secondary from Google Contacts.
  if (secondary.googleContactId) {
    await deleteContactFromGoogle(secondary.googleContactId);
  }

  return NextResponse.json({ ok: true });
}
