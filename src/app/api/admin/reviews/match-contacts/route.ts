// src/app/api/admin/reviews/match-contacts/route.ts
/**
 * @file route.ts
 * @description Admin API to auto-match reviews to contacts by email or phone.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { toE164NZ, normalizePhone } from "@/shared/lib/normalize-phone";

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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const unmatched = await prisma.review.findMany({
      where: { contactId: null },
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
        const norm = normalizePhone(toE164NZ(b.phone) || b.phone);
        if (norm) bookingPhoneById.set(b.id, norm);
      }
    }

    // Load ReviewRequests so customerRef (token) can be resolved to an email or phone.
    const rrRows = await prisma.reviewRequest.findMany({
      select: { reviewToken: true, email: true, phone: true },
    });
    const rrEmailByToken = new Map<string, string>();
    const rrPhoneByToken = new Map<string, string>();
    for (const rr of rrRows) {
      if (rr.email) rrEmailByToken.set(rr.reviewToken, rr.email.toLowerCase());
      if (rr.phone) {
        const norm = normalizePhone(toE164NZ(rr.phone) || rr.phone);
        if (norm) rrPhoneByToken.set(rr.reviewToken, norm);
      }
    }

    const contacts = await prisma.contact.findMany({
      select: { id: true, email: true, phone: true },
    });

    const contactIdByEmail = new Map(
      contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]),
    );
    const contactIdByPhone = new Map<string, string>();
    for (const c of contacts) {
      if (c.phone) {
        const norm = normalizePhone(c.phone);
        if (norm && !contactIdByPhone.has(norm)) contactIdByPhone.set(norm, c.id);
      }
    }

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
        // customerRef is a reviewToken UUID - look it up via ReviewRequest
        const email = rrEmailByToken.get(review.customerRef);
        if (email) contactId = contactIdByEmail.get(email);
        if (!contactId) {
          const phone = rrPhoneByToken.get(review.customerRef);
          if (phone) contactId = contactIdByPhone.get(phone);
        }
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
