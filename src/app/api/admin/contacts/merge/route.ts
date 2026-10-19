// src/app/api/admin/contacts/merge/route.ts
// Admin API to merge a duplicate Contact into another: reviews move, blanks fill, and the
// secondary is soft-deleted (its Google contact removed best-effort).

import { deleteContactFromGoogle } from "@/features/contacts/lib/google-contacts";
import { optOutRepointOps } from "@/features/reviews/lib/review-ask-opt-out";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { normaliseEmailOrNull } from "@/shared/lib/normalise-email";
import { normaliseContactPhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import type { ReviewLinkMode } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

interface MergeBody {
  /** The contact to keep. Its non-blank fields win. */
  primaryId: string;
  /** The contact to merge away. Soft-deleted after its data/reviews move over. */
  secondaryId: string;
}

/**
 * POST /api/admin/contacts/merge
 * Merges the secondary contact into the primary and soft-deletes the secondary.
 * @param request - Incoming request with primaryId and secondaryId.
 * @returns JSON { ok: true } on success, or an error response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json().catch(() => null)) as MergeBody | null;
  if (!body) {
    return errorResponse("Invalid request body.", 400);
  }
  const { primaryId, secondaryId } = body;
  if (!primaryId || !secondaryId) {
    return errorResponse("Both primaryId and secondaryId are required.", 400);
  }
  if (primaryId === secondaryId) {
    return errorResponse("Cannot merge a contact into itself.", 400);
  }

  // Both sides must be live, or reviews move onto a hidden contact.
  const [primary, secondary] = await Promise.all([
    prisma.contact.findFirst({ where: { id: primaryId, deletedAt: null } }),
    prisma.contact.findFirst({ where: { id: secondaryId, deletedAt: null } }),
  ]);
  if (!primary || !secondary) {
    return errorResponse("Contact not found.", 404);
  }

  // Fill only the primary's blanks; it keeps its reviewToken.
  const data: {
    phone?: string;
    email?: string;
    address?: string;
    company?: string;
    reviewToken?: string;
    retainerTier?: string;
    retainerPrice?: number;
    retainerHours?: number;
    retainerSince?: Date;
    retainerNotes?: string;
    siteNotes?: string;
    reviewLinkSentAt?: Date;
    reviewLinkSentMode?: ReviewLinkMode | null;
    reviewLinkSubmittedAt?: Date;
    altEmails: { set: string[] };
    altPhones: { set: string[] };
    altReviewTokens: { set: string[] };
  } = { altEmails: { set: [] }, altPhones: { set: [] }, altReviewTokens: { set: [] } };
  if (!primary.phone && secondary.phone) data.phone = secondary.phone;
  if (!primary.email && secondary.email) data.email = secondary.email;
  if (!primary.address && secondary.address) data.address = secondary.address;
  if (!primary.company && secondary.company) data.company = secondary.company;
  if (!primary.reviewToken && secondary.reviewToken) data.reviewToken = secondary.reviewToken;
  if (!primary.siteNotes && secondary.siteNotes) data.siteNotes = secondary.siteNotes;
  // A secondary-only retainer moves over whole, never mixed with the primary's.
  if (!primary.retainerTier && secondary.retainerTier) {
    data.retainerTier = secondary.retainerTier;
    if (secondary.retainerPrice !== null) data.retainerPrice = secondary.retainerPrice;
    if (secondary.retainerHours !== null) data.retainerHours = secondary.retainerHours;
    if (secondary.retainerSince !== null) data.retainerSince = secondary.retainerSince;
    if (secondary.retainerNotes !== null) data.retainerNotes = secondary.retainerNotes;
  }

  // Fold every email into altEmails so the pair can't re-split.
  const survivingPrimaryEmail = normaliseEmailOrNull(data.email ?? primary.email);
  const alts = new Set<string>();
  for (const e of [secondary.email, ...secondary.altEmails, ...primary.altEmails]) {
    if (!e) continue;
    const lc = e.toLowerCase();
    if (lc !== survivingPrimaryEmail) alts.add(lc);
  }
  data.altEmails = { set: [...alts] };

  // Same for phones, keyed on the canonical form.
  const survivingPrimaryPhone = normaliseContactPhone(data.phone ?? primary.phone);
  const altPhones = new Set<string>();
  for (const p of [secondary.phone, ...secondary.altPhones, ...primary.altPhones]) {
    const key = normaliseContactPhone(p);
    if (key && key !== survivingPrimaryPhone) altPhones.add(key);
  }
  data.altPhones = { set: [...altPhones] };

  // Review-link history: the newer ask wins (with its mode), since the cooldown reads it.
  if (
    secondary.reviewLinkSentAt &&
    (!primary.reviewLinkSentAt || secondary.reviewLinkSentAt > primary.reviewLinkSentAt)
  ) {
    data.reviewLinkSentAt = secondary.reviewLinkSentAt;
    data.reviewLinkSentMode = secondary.reviewLinkSentMode;
  }
  // Having reviewed is permanent, so either row saying so is enough.
  if (!primary.reviewLinkSubmittedAt && secondary.reviewLinkSubmittedAt) {
    data.reviewLinkSubmittedAt = secondary.reviewLinkSubmittedAt;
  }

  // Fold review tokens too, so links already sent keep working.
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
      ...optOutRepointOps(secondaryId, primaryId),
      prisma.contact.update({ where: { id: primaryId }, data }),
      prisma.contact.update({ where: { id: secondaryId }, data: { deletedAt: new Date() } }),
    ]);
  } catch (error) {
    console.error("[admin/contacts/merge] POST error:", error);
    return errorResponse("Failed to merge contacts.", 500);
  }

  // Best-effort Google removal, skipped when both rows share one Google contact.
  if (secondary.googleContactId && secondary.googleContactId !== primary.googleContactId) {
    await deleteContactFromGoogle(secondary.googleContactId);
  }

  return NextResponse.json({ ok: true });
}
