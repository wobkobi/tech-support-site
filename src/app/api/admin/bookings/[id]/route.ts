// src/app/api/admin/bookings/[id]/route.ts
/**
 * @file route.ts
 * @description Admin API for editing and cancelling bookings by ID.
 */

import { createDraftCancellationInvoice } from "@/features/business/lib/cancellation-invoice";
import {
  isWithinCancellationWindow,
  isWithinTravelWindow,
} from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { deleteBookingEvent, SCHEDULE_CALENDAR_TAG } from "@/features/calendar/lib/google-calendar";
import { sendCustomerReviewRequest } from "@/features/reviews/lib/email";
import { isAdminRequest } from "@/shared/lib/auth";
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as PatchPayload;

  // Load the booking
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
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
    data.status = "cancelled";
    data.activeSlotKey = `released:${id}`;
    data.cancelledAt = new Date();
    data.cancelledBy = "customer";
    data.lateCancellation = true;
    data.travelChargeApplies = true;
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
    data.lateCancellation = onBehalf
      ? isWithinCancellationWindow(booking.startAt, now, CANCELLATION.freeNoticeHours)
      : false;
    data.travelChargeApplies = onBehalf
      ? isWithinTravelWindow(booking.startAt, now, CANCELLATION.travelChargeHours)
      : false;
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
      includeTravel: updated.travelChargeApplies,
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

  // Sync contact details
  if (body.address !== undefined && booking.email) {
    try {
      await prisma.contact.updateMany({
        where: { email: booking.email },
        data: { address: body.address.trim() || null },
      });
    } catch (err) {
      console.error("[admin/bookings] Failed to update contact address:", err);
    }
  }

  if (body.phone !== undefined && booking.email) {
    try {
      await prisma.contact.updateMany({
        where: { email: booking.email },
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  if (booking.calendarEventId) {
    try {
      await deleteBookingEvent({ eventId: booking.calendarEventId });
    } catch (err) {
      console.error("[admin/bookings] Failed to delete calendar event:", err);
    }
  }

  await prisma.booking.delete({ where: { id } });

  revalidateTag(SCHEDULE_CALENDAR_TAG, {});
  return NextResponse.json({ ok: true });
}
