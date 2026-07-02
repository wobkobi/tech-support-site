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
import { normaliseContactPhone } from "@/shared/lib/normalise-phone";
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
  const data: {
    phone?: string;
    email?: string;
    address?: string;
    reviewToken?: string;
    altEmails: { set: string[] };
    altPhones: { set: string[] };
    altReviewTokens: { set: string[] };
  } = { altEmails: { set: [] }, altPhones: { set: [] }, altReviewTokens: { set: [] } };
  if (!primary.phone && secondary.phone) data.phone = secondary.phone;
  if (!primary.email && secondary.email) data.email = secondary.email;
  if (!primary.address && secondary.address) data.address = secondary.address;
  if (!primary.reviewToken && secondary.reviewToken) data.reviewToken = secondary.reviewToken;

  // Fold every email both contacts know into altEmails (minus the surviving
  // primary address). This is what stops the pair re-splitting: a future booking
  // or review under the secondary's email now resolves back to this one contact.
  const survivingPrimaryEmail = (data.email ?? primary.email)?.toLowerCase() ?? null;
  const alts = new Set<string>();
  for (const e of [secondary.email, ...secondary.altEmails, ...primary.altEmails]) {
    if (!e) continue;
    const lc = e.toLowerCase();
    if (lc !== survivingPrimaryEmail) alts.add(lc);
  }
  data.altEmails = { set: [...alts] };

  // Same folding for phone numbers, keyed on the canonical form so a domestic
  // and E.164 spelling of one number don't produce a phantom alt.
  const survivingPrimaryPhone = normaliseContactPhone(data.phone ?? primary.phone);
  const altPhones = new Set<string>();
  for (const p of [secondary.phone, ...secondary.altPhones, ...primary.altPhones]) {
    const key = normaliseContactPhone(p);
    if (key && key !== survivingPrimaryPhone) altPhones.add(key);
  }
  data.altPhones = { set: [...altPhones] };

  // Fold review tokens the same way so links already sent under the secondary's
  // token keep working (the /review page, submission verify, and review matcher
  // all accept a contact's primary OR alt tokens).
  const survivingToken = data.reviewToken ?? primary.reviewToken ?? null;
  const altTokens = new Set<string>();
  for (const t of [
    secondary.reviewToken,
    ...secondary.altReviewTokens,
    ...primary.altReviewTokens,
  ]) {
    if (t && t !== survivingToken) altTokens.add(t);
  }
  data.altReviewTokens = { set: [...altTokens] };

  try {
    await prisma.$transaction([
      prisma.review.updateMany({
        where: { contactId: secondaryId },
        data: { contactId: primaryId },
      }),
      prisma.contact.update({ where: { id: primaryId }, data }),
      prisma.contact.update({ where: { id: secondaryId }, data: { deletedAt: new Date() } }),
    ]);
  } catch (error) {
    console.error("[admin/contacts/merge] POST error:", error);
    return errorResponse("Failed to merge contacts.", 500);
  }

  // Best-effort: remove the now-defunct secondary from Google Contacts - but
  // never when both rows point at the SAME Google contact (import artefacts do),
  // as that would delete the keeper's Google entry.
  if (secondary.googleContactId && secondary.googleContactId !== primary.googleContactId) {
    await deleteContactFromGoogle(secondary.googleContactId);
  }

  return NextResponse.json({ ok: true });
}
