// src/app/api/admin/reviews/match-contacts/route.ts
/**
 * @file route.ts
 * @description Admin API to auto-match reviews to contacts by email or phone.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { toE164NZ, normalisePhone } from "@/shared/lib/normalise-phone";

/**
 * POST /api/admin/reviews/match-contacts
 * For each review that has a bookingId but no contactId, loads the booking to
 * get the email (primary) or phone (fallback) and finds the matching Contact.
 * Also falls back to customerRef as an email if no bookingId is present.
 * Updates review.contactId when a match is found.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with { ok: true, matchedCount } on success, or error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // MongoDB gotcha: `contactId: null` only matches documents where the field
    // exists and equals null. Reviews created before contactId was added to
    // the schema have no contactId field at all, so they need the `isSet:
    // false` branch to be matched and eligible for linking.
    const unmatched = await prisma.review.findMany({
      where: { OR: [{ contactId: null }, { contactId: { isSet: false } }] },
      select: { id: true, bookingId: true, customerRef: true },
    });

    if (unmatched.length === 0) {
      return NextResponse.json({ ok: true, matchedCount: 0 });
    }

    const bookingIds = unmatched.map((r) => r.bookingId).filter((id): id is string => id !== null);

    const bookings =
      bookingIds.length > 0
        ? await prisma.booking.findMany({
            where: { id: { in: bookingIds } },
            select: { id: true, email: true, phone: true },
          })
        : [];

    const bookingEmailById = new Map(bookings.map((b) => [b.id, b.email]));
    const bookingPhoneById = new Map<string, string>();
    for (const b of bookings) {
      if (b.phone) {
        const norm = normalisePhone(toE164NZ(b.phone) || b.phone);
        if (norm) bookingPhoneById.set(b.id, norm);
      }
    }

    const contacts = await prisma.contact.findMany({
      select: { id: true, email: true, phone: true, reviewToken: true },
    });

    const contactIdByEmail = new Map(
      contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]),
    );
    const contactIdByPhone = new Map<string, string>();
    for (const c of contacts) {
      if (c.phone) {
        const norm = normalisePhone(c.phone);
        if (norm && !contactIdByPhone.has(norm)) contactIdByPhone.set(norm, c.id);
      }
    }
    // Standalone reviews (no booking) carry the Contact's reviewToken in
    // customerRef, so a token-based lookup replaces the old ReviewRequest path.
    const contactIdByToken = new Map(
      contacts.filter((c) => c.reviewToken).map((c) => [c.reviewToken!, c.id]),
    );

    let matchedCount = 0;
    for (const review of unmatched) {
      let contactId: string | undefined;

      if (review.bookingId) {
        const email = bookingEmailById.get(review.bookingId);
        if (email) contactId = contactIdByEmail.get(email.toLowerCase());
        if (!contactId) {
          const phone = bookingPhoneById.get(review.bookingId);
          if (phone) contactId = contactIdByPhone.get(phone);
        }
      } else if (review.customerRef) {
        contactId = contactIdByToken.get(review.customerRef);
      }

      if (!contactId) continue;

      await prisma.review.update({ where: { id: review.id }, data: { contactId } });
      matchedCount++;
    }

    return NextResponse.json({ ok: true, matchedCount });
  } catch (error) {
    console.error("[admin/reviews/match-contacts] POST error:", error);
    return NextResponse.json({ error: "Failed to match contacts" }, { status: 500 });
  }
}
