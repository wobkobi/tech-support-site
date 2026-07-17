// src/app/api/admin/bookings/[id]/route.ts
/**
 * @description Admin API for editing and cancelling bookings by ID.
 */

import { createDraftCancellationInvoice } from "@/features/business/lib/cancellation-invoice";
import { assessCancellation } from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { deleteBookingEvent, SCHEDULE_CALENDAR_TAG } from "@/features/calendar/lib/google-calendar";
import { sendCustomerReviewRequest } from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { isPastEditWindow, MAX_PAST_EDIT_HOURS } from "@/shared/lib/edit-window";
import { toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

interface PatchPayload {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  address?: string;
  status?: "confirmed" | "cancelled" | "completed";
  /**
   * "operator" (default) = operator cancel, no customer fee. "on-behalf" =
   * customer cancelled by phone/email; uses the standard fee rules.
   */
  cancelMode?: "operator" | "on-behalf";
  /** No-show: always charges callout + travel via the draft-invoice flow. */
  markNoShow?: boolean;
}

/**
 * PATCH /api/admin/bookings/[id]
 * Updates a booking's fields. Cancelling removes the calendar event and frees the slot.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route params.
 * @param params.params - Destructured route params containing booking id.
 * @returns JSON with ok flag or error.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as PatchPayload | null;
  if (!body) {
    return errorResponse("Invalid request body.", 400);
  }

  // Load the booking
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return errorResponse("Booking not found.", 404);
  }

  // Lock past events: refuse state changes (complete / cancel / no-show) on a
  // booking that ended more than 18h ago. Metadata-only edits (name/email/phone/
  // notes/address corrections) are still allowed.
  const isStateChange = body.status !== undefined || body.markNoShow === true;
  if (isStateChange && isPastEditWindow(booking.endAt.getTime(), Date.now())) {
    return errorResponse(
      `Can't change a booking more than ${MAX_PAST_EDIT_HOURS}h after it ended.`,
      409,
    );
  }

  // Sparse update: only fields present in the body get written.
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) data.name = body.name.trim();
  if (body.email !== undefined) data.email = body.email.trim();
  if (body.phone !== undefined) data.phone = toE164NZ(body.phone) || null;
  if (body.notes !== undefined) data.notes = body.notes;

  if (body.address !== undefined && body.notes === undefined) {
    const currentNotes = booking.notes ?? "";
    const newAddress = body.address.trim();
    if (/^Address:\s*/im.test(currentNotes)) {
      data.notes = currentNotes.replace(/^(Address:\s*).*$/im, newAddress ? `$1${newAddress}` : "");
    } else if (newAddress) {
      // No existing Address: line (e.g. a remote booking being made in-person) -
      // append one rather than dropping the edit, so notes and the contact agree.
      data.notes = currentNotes
        ? `${currentNotes}\nAddress: ${newAddress}`
        : `Address: ${newAddress}`;
    }
  }

  if (body.markNoShow && booking.status !== "cancelled") {
    // No-show ~ a customer cancel at startAt: both windows are inside.
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        console.error("[admin/bookings] Failed to delete calendar event:", err);
      }
    }
    const noShowAt = new Date();
    const { CANCELLATION: noShowPolicy } = await getPolicy();
    // A no-show always charges - they never called. The policy still decides
    // whether a drive is billed, since a remote no-show has none.
    const noShowCharge = assessCancellation(booking.startAt, noShowAt, {
      reason: "no-show",
      meetingType: booking.meetingType === "remote" ? "remote" : "in-person",
      policy: noShowPolicy,
    });
    data.status = "cancelled";
    data.activeSlotKey = `released:${id}`;
    data.cancelledAt = noShowAt;
    data.cancelledBy = "customer";
    data.lateCancellation = true;
    data.travelChargeApplies = noShowCharge.travelApplies;
    data.noShow = true;
  } else if (body.status === "cancelled" && booking.status !== "cancelled") {
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        console.error("[admin/bookings] Failed to delete calendar event:", err);
      }
    }
    const now = new Date();
    const onBehalf = body.cancelMode === "on-behalf";
    data.status = "cancelled";
    data.activeSlotKey = `released:${id}`;
    data.cancelledAt = now;
    // Operator cancels never charge; on-behalf follows customer fee rules.
    data.cancelledBy = onBehalf ? "customer" : "operator";
    const { CANCELLATION } = await getPolicy();
    // In-person and remote have their own windows and fees, so the policy reads
    // the booking rather than one set of windows being applied to both.
    const charge = assessCancellation(booking.startAt, now, {
      reason: "late-cancellation",
      meetingType: booking.meetingType === "remote" ? "remote" : "in-person",
      policy: CANCELLATION,
    });
    data.lateCancellation = onBehalf ? charge.fee > 0 : false;
    data.travelChargeApplies = onBehalf ? charge.travelApplies : false;
  } else if (body.status === "completed") {
    data.status = "completed";
    data.activeSlotKey = `released:${id}`;
  } else if (body.status === "confirmed") {
    data.status = "confirmed";
  }

  // Apply the update
  const updated = await prisma.booking.update({ where: { id }, data });

  // Same cancellation draft applies to on-behalf and no-show paths.
  if (
    updated.lateCancellation &&
    updated.cancelledBy === "customer" &&
    booking.status !== "cancelled"
  ) {
    void createDraftCancellationInvoice(updated, {
      reason: updated.noShow ? "no-show" : "late-cancellation",
    }).catch((err) => console.error("[admin/bookings] Failed to draft cancellation invoice:", err));
  }

  // When transitioning to "completed", send the review request email if one
  // has not already gone out. updateMany with the null-or-missing guard is
  // atomic, so it cannot race with the /api/cron/send-review-emails cron - if
  // the cron already claimed the send, the updateMany returns count=0 and the
  // send is skipped. Same `isSet: false` clause as the cron to handle MongoDB
  // documents where `reviewSentAt` was never written (pre-schema docs).
  let reviewSent = false;
  if (
    body.status === "completed" &&
    booking.status !== "completed" &&
    booking.email &&
    booking.reviewToken
  ) {
    const claim = await prisma.booking.updateMany({
      where: {
        id,
        OR: [{ reviewSentAt: null }, { reviewSentAt: { isSet: false } }],
      },
      data: { reviewSentAt: new Date() },
    });

    if (claim.count > 0) {
      // Claim won - sendCustomerReviewRequest never throws (catches its own
      // errors and logs), so the PATCH response stays successful even if
      // Resend has a hiccup. Trade-off: a single failed send won't auto-retry.
      await sendCustomerReviewRequest({
        id,
        name: booking.name,
        email: booking.email,
        reviewToken: booking.reviewToken,
      });
      reviewSent = true;
    }
  }

  // Sync contact details. Match on the primary OR any alt email, case-insensitively,
  // and skip soft-deleted contacts so an edit lands on the live contact.
  const contactEmailMatch = booking.email
    ? {
        OR: [
          { email: { equals: booking.email, mode: "insensitive" as const } },
          { altEmails: { has: booking.email.toLowerCase() } },
        ],
        deletedAt: null,
      }
    : null;

  if (body.address !== undefined && contactEmailMatch) {
    try {
      await prisma.contact.updateMany({
        where: contactEmailMatch,
        data: { address: body.address.trim() || null },
      });
    } catch (err) {
      console.error("[admin/bookings] Failed to update contact address:", err);
    }
  }

  if (body.phone !== undefined && contactEmailMatch) {
    try {
      await prisma.contact.updateMany({
        where: contactEmailMatch,
        data: { phone: toE164NZ(body.phone) || null },
      });
    } catch (err) {
      console.error("[admin/bookings] Failed to update contact phone:", err);
    }
  }

  revalidateTag(SCHEDULE_CALENDAR_TAG, {});
  return NextResponse.json({ ok: true, reviewSent });
}

/**
 * DELETE /api/admin/bookings/[id]
 * Permanently deletes a booking and its calendar event.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route params.
 * @param params.params - Destructured route params containing booking id.
 * @returns JSON with ok flag or error.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return errorResponse("Booking not found.", 404);
  }

  if (booking.calendarEventId) {
    try {
      await deleteBookingEvent({ eventId: booking.calendarEventId });
    } catch (err) {
      console.error("[admin/bookings] Failed to delete calendar event:", err);
    }
  }

  // Drop the dangling reference first: Review.bookingId is a bare ObjectId, not
  // a relation, so deleting the booking would otherwise leave reviews pointing at
  // a row that no longer exists. The review itself is kept (it stays linked to
  // its contact via contactId/customerRef).
  await prisma.review.updateMany({ where: { bookingId: id }, data: { bookingId: null } });
  await prisma.booking.delete({ where: { id } });

  revalidateTag(SCHEDULE_CALENDAR_TAG, {});
  return NextResponse.json({ ok: true });
}
