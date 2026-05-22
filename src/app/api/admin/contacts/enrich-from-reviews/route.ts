// src/app/api/admin/contacts/enrich-from-reviews/route.ts
/**
 * @file route.ts
 * @description Enriches Contact records by comparing them against Review data.
 * Returns a list of name conflicts where review-supplied names differ from the
 * Contact's stored name so the admin can resolve them manually. The standalone
 * ReviewRequest model has been retired, so phone-enrichment from RRs is gone -
 * bookings handle phone enrichment via auto-maintain.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

export interface ConflictEntry {
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Where the conflicting data came from. */
  source: "Review" | "Booking";
  sourceId: string;
  /** Suggested name (present when name is a conflicting field). */
  sourceName: string | null;
  /** Suggested phone (present when phone is a conflicting field). */
  sourcePhone: string | null;
  conflictFields: ("name" | "phone")[];
}

/**
 * POST /api/admin/contacts/enrich-from-reviews
 * Compares Review records against their linked Contacts and returns a name
 * conflict entry per Contact where the reviewer's displayed name differs from
 * the stored name.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with enrichedCount and conflicts array.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allContacts = await prisma.contact.findMany({
    select: { id: true, name: true, email: true, phone: true, reviewToken: true },
  });
  const contactByToken = new Map(
    allContacts.filter((c) => c.reviewToken).map((c) => [c.reviewToken!, c]),
  );

  const reviews = await prisma.review.findMany({
    where: { customerRef: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, firstName: true, lastName: true, customerRef: true },
  });

  const conflicts: ConflictEntry[] = [];
  const seenRev = new Set<string>();

  for (const review of reviews) {
    if (!review.customerRef) continue;
    const contact = contactByToken.get(review.customerRef);
    if (!contact || seenRev.has(contact.id)) continue;
    seenRev.add(contact.id);

    // If the review has no last name, don't flag a name conflict - the reviewer's
    // choice of display name (first name only) is not a suggestion to drop the
    // contact's last name.
    if (!review.lastName) continue;
    const proposedName = [review.firstName, review.lastName].filter(Boolean).join(" ").trim();
    if (!proposedName || !contact.name) continue;
    if (proposedName.toLowerCase() === contact.name.toLowerCase()) continue;

    conflicts.push({
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      source: "Review",
      sourceId: review.id,
      sourceName: proposedName,
      sourcePhone: null,
      conflictFields: ["name"],
    });
  }

  return NextResponse.json({
    ok: true,
    enrichedCount: 0,
    conflicts,
  });
}
