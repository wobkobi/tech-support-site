// src/app/api/admin/contacts/enrich-from-reviews/route.ts
/**
 * @file route.ts
 * @description Enriches Contact records by comparing them against ReviewRequest and Review data.
 * Auto-fills missing phone numbers from ReviewRequests, and returns a list of conflicts
 * where field values differ so the admin can resolve them manually.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { normalizePhone } from "@/shared/lib/normalize-phone";

export interface ConflictEntry {
  contactId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  /** Where the conflicting data came from. */
  source: "ReviewRequest" | "Review";
  sourceId: string;
  /** Suggested name (present when name is a conflicting field). */
  sourceName: string | null;
  /** Suggested phone (present when phone is a conflicting field). */
  sourcePhone: string | null;
  conflictFields: ("name" | "phone")[];
}

/**
 * POST /api/admin/contacts/enrich-from-reviews
 * Compares all ReviewRequest and Review records against Contact records (matched by email).
 * - Auto-fills a contact's missing phone from the most recent matching ReviewRequest.
 * - Returns a conflict entry for any matched pair where name or phone values differ.
 * Only the most recent ReviewRequest / Review per contact email is used to avoid duplicate conflicts.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with enrichedCount and conflicts array.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allContacts = await prisma.contact.findMany({
    select: { id: true, name: true, email: true, phone: true },
  });
  const contactByEmail = new Map(allContacts.map((c) => [c.email.toLowerCase(), c]));

  // Most recent first so the first match per contact wins
  const reviewRequests = await prisma.reviewRequest.findMany({
    where: { email: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, phone: true },
  });

  const reviews = await prisma.review.findMany({
    where: { customerRef: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, firstName: true, lastName: true, customerRef: true },
  });

  const conflicts: ConflictEntry[] = [];
  // One entry per source type per contact (most-recent wins)
  const seenRR = new Set<string>();
  const seenRev = new Set<string>();
  // contactId → raw phone string to enrich
  const phoneEnrichments = new Map<string, string>();

  for (const rr of reviewRequests) {
    if (!rr.email) continue;
    const contact = contactByEmail.get(rr.email.toLowerCase());
    if (!contact || seenRR.has(contact.id)) continue;
    seenRR.add(contact.id);

    const proposedName = rr.name.trim();
    const proposedPhoneRaw = rr.phone?.trim() ?? null;
    const proposedPhone = proposedPhoneRaw ? normalizePhone(proposedPhoneRaw) : null;
    const existingPhone = contact.phone ? normalizePhone(contact.phone) : null;

    const conflictFields: ("name" | "phone")[] = [];

    if (proposedName && contact.name && proposedName.toLowerCase() !== contact.name.toLowerCase()) {
      conflictFields.push("name");
    }

    if (proposedPhone) {
      if (!existingPhone) {
        phoneEnrichments.set(contact.id, proposedPhoneRaw!);
      } else if (proposedPhone !== existingPhone) {
        conflictFields.push("phone");
      }
    }

    if (conflictFields.length > 0) {
      conflicts.push({
        contactId: contact.id,
        contactName: contact.name,
        contactEmail: contact.email,
        contactPhone: contact.phone,
        source: "ReviewRequest",
        sourceId: rr.id,
        sourceName: conflictFields.includes("name") ? proposedName : null,
        sourcePhone: conflictFields.includes("phone") ? proposedPhoneRaw : null,
        conflictFields,
      });
    }
  }

  for (const review of reviews) {
    if (!review.customerRef) continue;
    const contact = contactByEmail.get(review.customerRef.toLowerCase());
    if (!contact || seenRev.has(contact.id)) continue;
    seenRev.add(contact.id);

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

  await Promise.all(
    [...phoneEnrichments.entries()].map(([id, phone]) =>
      prisma.contact.update({ where: { id }, data: { phone } }),
    ),
  );

  return NextResponse.json({ ok: true, enrichedCount: phoneEnrichments.size, conflicts });
}
