// src/app/api/admin/reviews/match-contacts/route.ts
/**
 * @file route.ts
 * @description Admin API to auto-match reviews to contacts by email.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * POST /api/admin/reviews/match-contacts
 * For each review that has a bookingId but no contactId, loads the booking to
 * get the email and finds the matching Contact. Also falls back to customerRef
 * as an email if no bookingId is present. Updates review.contactId when a match
 * is found.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with { ok: true, matchedCount } on success, or error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Load all reviews that don't yet have a contactId.
    const unmatched = await prisma.review.findMany({
      where: { contactId: null },
      select: { id: true, bookingId: true, customerRef: true },
    });

    if (unmatched.length === 0) {
      return NextResponse.json({ ok: true, matchedCount: 0 });
    }

    // Collect booking IDs we need to look up.
    const bookingIds = unmatched.map((r) => r.bookingId).filter((id): id is string => id !== null);

    // Load all relevant bookings in one query.
    const bookings =
      bookingIds.length > 0
        ? await prisma.booking.findMany({
            where: { id: { in: bookingIds } },
            select: { id: true, email: true },
          })
        : [];

    const bookingEmailMap = new Map(bookings.map((b) => [b.id, b.email]));

    // Collect all emails we'll need to look up contacts for.
    const emailSet = new Set<string>();
    for (const review of unmatched) {
      const email = review.bookingId
        ? bookingEmailMap.get(review.bookingId)
        : (review.customerRef ?? null);
      if (email) emailSet.add(email.toLowerCase());
    }

    if (emailSet.size === 0) {
      return NextResponse.json({ ok: true, matchedCount: 0 });
    }

    // Load all contacts matching those emails in one query.
    const contacts = await prisma.contact.findMany({
      where: { email: { in: Array.from(emailSet) } },
      select: { id: true, email: true },
    });

    const contactEmailMap = new Map(contacts.map((c) => [c.email.toLowerCase(), c.id]));

    // Update each review that can be matched.
    let matchedCount = 0;
    for (const review of unmatched) {
      const rawEmail = review.bookingId
        ? bookingEmailMap.get(review.bookingId)
        : (review.customerRef ?? null);

      if (!rawEmail) continue;

      const contactId = contactEmailMap.get(rawEmail.toLowerCase());
      if (!contactId) continue;

      await prisma.review.update({
        where: { id: review.id },
        data: { contactId },
      });
      matchedCount++;
    }

    return NextResponse.json({ ok: true, matchedCount });
  } catch (error) {
    console.error("[admin/reviews/match-contacts] POST error:", error);
    return NextResponse.json({ error: "Failed to match contacts" }, { status: 500 });
  }
}
