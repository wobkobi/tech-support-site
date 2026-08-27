// src/app/api/admin/bookings/[id]/route.ts
/**
 * @description Admin API for editing and cancelling bookings by ID.
 */

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import { combineUnitAndAddress } from "@/features/booking/lib/booking";
import { loadBlockingBookings } from "@/features/booking/lib/existing-bookings.server";
import { createDraftCancellationInvoice } from "@/features/business/lib/cancellation-invoice";
import { assessCancellation } from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import {
  deleteBookingEvent,
  fetchAllCalendarEvents,
  patchBookingEvent,
  SCHEDULE_CALENDAR_TAG,
} from "@/features/calendar/lib/google-calendar";
import {
  sendCustomerBookingConfirmation,
  sendCustomerReviewRequest,
  sendOwnerBookingNotification,
} from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { isPastEditWindow } from "@/shared/lib/edit-window";
import { toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * Longest span a hand-typed time edit may produce. Not a policy limit - it's a
 * typo guard, since getting the date wrong on one of the two fields yields a
 * booking days long rather than an obviously bad value.
 */
const MAX_SPAN_HOURS = 12;

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
  /** New start (ISO) for a time edit. Must be sent together with `endAt`. */
  startAt?: string;
  /** New end (ISO) for a time edit. Must be sent together with `startAt`. */
  endAt?: string;
  /** Save a future time change that overlaps something else anyway. */
  force?: boolean;
}

/**
 * Looks for anything already sitting in a proposed booking window: another live
 * booking, or an event on any of the watched calendars.
 *
 * Raw overlap only - the booking engine's travel buffers are deliberately not
 * applied here. An operator typing times by hand has already accounted for the
 * drive, and a buffer-based check would flag nearly every deliberate
 * back-to-back as a conflict.
 * @param bookingId - The booking being moved, so it can't clash with itself.
 * @param calendarEventId - Its own event, excluded for the same reason.
 * @param startAt - Proposed start.
 * @param endAt - Proposed end.
 * @returns Description of the first clash found, or null when the window is clear.
 */
async function findScheduleConflict(
  bookingId: string,
  calendarEventId: string | null,
  startAt: Date,
  endAt: Date,
): Promise<string | null> {
  // loadBlockingBookings drops anything finishing before its cutoff, so passing
  // the proposed start narrows it to the bookings that could actually overlap.
  const [bookings, events] = await Promise.all([
    loadBlockingBookings(startAt, { excludeId: bookingId }),
    fetchAllCalendarEvents(startAt, endAt).catch((err: unknown) => {
      // A calendar outage must not block the edit - fall through to "no clash".
      console.error("[admin/bookings] Conflict check couldn't read the calendar:", err);
      return [];
    }),
  ]);

  const clash = bookings.find((b) => b.startAt < endAt && b.endAt > startAt);
  if (clash) {
    return `another booking (${formatDateTimeShort(clash.startAt)} - ${formatDateTimeShort(clash.endAt)})`;
  }

  const event = events.find(
    (e) => e.id !== calendarEventId && new Date(e.start) < endAt && new Date(e.end) > startAt,
  );
  if (event) {
    return `"${event.summary ?? "an untitled event"}" on your calendar`;
  }

  return null;
}

/**
 * PATCH /api/admin/bookings/[id]
 * Updates a booking's fields. Cancelling removes the calendar event and frees the slot.
 *
 * Sending `startAt` + `endAt` moves the booking, and what that means depends on
 * where both the old and new times sit. Shifting a job that has already run to
 * another past time is the operator recording what actually happened, and stays
 * silent; anything else is a real reschedule (conflicts checked, travel
 * re-snapshotted, both parties emailed). Either way the Google event is patched
 * to match, so the row and the calendar never drift.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route params.
 * @param params.params - Destructured route params containing booking id.
 * @returns JSON with ok flag or error; `notified` and `calendarWarning` on a time edit.
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

  const now = new Date();

  // Lock past events: state changes and time edits both feed billing, so a booking that
  // ended more than the configured window ago can't be rewritten by accident.
  // Metadata-only edits (name/email/phone/notes/address) are still allowed.
  const isStateChange = body.status !== undefined || body.markNoShow === true;
  const isTimeChange = body.startAt !== undefined || body.endAt !== undefined;
  const { scheduling } = await getSettings();
  if (
    (isStateChange || isTimeChange) &&
    isPastEditWindow(booking.endAt.getTime(), now.getTime(), scheduling.pastEditLockHours)
  ) {
    return errorResponse(
      `Can't change a booking more than ${scheduling.pastEditLockHours}h after it ended.`,
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

  // Time edit. Runs before the status branches so that cancelling in the same
  // request still wins the activeSlotKey - a cancelled booking must release its
  // slot, not move it.
  let timeChange: { startAt: Date; endAt: Date; notify: boolean } | null = null;
  if (isTimeChange) {
    if (body.startAt === undefined || body.endAt === undefined) {
      return errorResponse("Send both a start and a finish time.", 400);
    }
    const startAt = new Date(body.startAt);
    const endAt = new Date(body.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return errorResponse("Invalid start or finish time.", 400);
    }
    if (endAt <= startAt) {
      return errorResponse("The finish time has to be after the start time.", 400);
    }
    if (endAt.getTime() - startAt.getTime() > MAX_SPAN_HOURS * 60 * 60 * 1000) {
      return errorResponse(
        `That's over ${MAX_SPAN_HOURS} hours long - check the date on both fields.`,
        400,
      );
    }

    // Staying silent needs BOTH times in the past - only then is the edit purely
    // "record what actually happened". Anything moving into the future is a reschedule
    // the customer may not know about yet, so it notifies.
    const alreadyRun =
      booking.startAt.getTime() <= now.getTime() && startAt.getTime() <= now.getTime();
    const notify = !alreadyRun && booking.status !== "cancelled";

    if (notify && !body.force) {
      const conflict = await findScheduleConflict(id, booking.calendarEventId, startAt, endAt);
      if (conflict) {
        return errorResponse(`That overlaps ${conflict}.`, 409);
      }
    }

    data.startAt = startAt;
    data.endAt = endAt;
    // Only a booking still holding its slot carries a live key; cancelled and
    // completed rows keep `released:<id>` and must not reclaim one.
    if (!booking.activeSlotKey?.startsWith("released:")) {
      data.activeSlotKey = startAt.toISOString();
    }
    // A moved start needs its 24h nudge again, and nothing else clears the stamp. Gated on
    // the start actually changing, so correcting only the finish time doesn't re-send a
    // reminder the customer already has.
    if (startAt.getTime() !== booking.startAt.getTime()) {
      data.emailReminderSentAt = null;
    }

    if (notify) {
      // The replacement invite only supersedes the old one when its SEQUENCE
      // rises, and the ICS sequence is built from rescheduleCount.
      data.rescheduleCount = { increment: 1 };
      // Re-snapshot both drive legs at the new times so a later cancellation bills the
      // right travel. Not done on the past branch - travel freezes once a job has run, and
      // a lookup against a historic departure time would only blank it.
      if (booking.meetingType === "in_person" && booking.address) {
        try {
          const drive = await lookupDriveRoundTrip(booking.address, startAt, endAt);
          if (drive.status === "ok") {
            data.travelMinsAtBooking = drive.data.there.durationMins;
            data.travelMinsBackAtBooking = drive.data.back.durationMins;
          }
        } catch (err) {
          console.warn("[admin/bookings] travel-time snapshot failed:", err);
        }
      }
    }

    timeChange = { startAt, endAt, notify };
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

  // activeSlotKey is unique, so a time edit onto a start another live booking holds
  // surfaces as P2002. Unlike an overlap it can't be forced through - that constraint is
  // what keeps two bookings off the same slot.
  const updated = await prisma.booking.update({ where: { id }, data }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  });
  if (!updated) {
    return errorResponse("Another booking already starts at that time.", 409);
  }

  // Keep the Google event in step with the row. Best-effort by necessity - the
  // booking is already written - but a silent failure would recreate the exact
  // drift this exists to remove, so it comes back as a warning.
  let calendarWarning: string | undefined;
  if (timeChange && booking.calendarEventId) {
    try {
      const { config } = await getAvailabilityConfig();
      await patchBookingEvent({
        eventId: booking.calendarEventId,
        startAt: timeChange.startAt,
        endAt: timeChange.endAt,
        timeZone: config.timeZone,
        notifyAttendees: timeChange.notify,
      });
    } catch (err) {
      console.error("[admin/bookings] Failed to move calendar event:", err);
      calendarWarning = "Saved, but the calendar event didn't move - check Google Calendar.";
    }
  }

  // Tell both parties about a genuine reschedule. Both helpers catch their own
  // errors and never throw, so a Resend hiccup can't fail the edit.
  if (timeChange?.notify) {
    const emailAddress = combineUnitAndAddress(updated.unit ?? "", updated.address ?? "");
    await Promise.all([
      sendCustomerBookingConfirmation(
        {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          notes: updated.notes ?? "",
          startAt: timeChange.startAt,
          endAt: timeChange.endAt,
          cancelToken: updated.cancelToken,
          promoTitleAtBooking: updated.promoTitleAtBooking,
          address: emailAddress,
          meetingType: updated.meetingType,
          rescheduleCount: updated.rescheduleCount,
        },
        { kind: "rescheduled", previousStartAt: booking.startAt },
      ),
      sendOwnerBookingNotification(
        {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          notes: updated.notes ?? "",
          startAt: timeChange.startAt,
          endAt: timeChange.endAt,
          cancelToken: updated.cancelToken,
          address: emailAddress,
          meetingType: updated.meetingType,
        },
        { kind: "rescheduled", previousStartAt: booking.startAt },
      ),
    ]);
  }

  // Same cancellation draft applies to on-behalf and no-show paths.
  if (
    updated.lateCancellation &&
    updated.cancelledBy === "customer" &&
    booking.status !== "cancelled"
  ) {
    // Awaited, not detached: Vercel freezes the instance once the response is sent, and
    // the no-show path skips the awaits further down that would otherwise give a `void`
    // call an incidental window - the fee invoice would never be drafted.
    try {
      await createDraftCancellationInvoice(updated, {
        reason: updated.noShow ? "no-show" : "late-cancellation",
      });
    } catch (err) {
      console.error("[admin/bookings] Failed to draft cancellation invoice:", err);
    }
  }

  // Atomic claim: updateMany returns count=0 if the send-review-emails cron got there
  // first, so the two can never double-send. `isSet: false` also covers Mongo docs
  // written before reviewSentAt existed, which have no such key at all.
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
  return NextResponse.json({
    ok: true,
    reviewSent,
    ...(timeChange ? { notified: timeChange.notify } : {}),
    ...(calendarWarning ? { calendarWarning } : {}),
  });
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

  // Drop the dangling reference first: Review.bookingId is a bare ObjectId, not a
  // relation, so deleting the booking would leave reviews pointing at nothing. The review
  // is kept - it stays linked to its contact via contactId/customerRef.
  await prisma.review.updateMany({ where: { bookingId: id }, data: { bookingId: null } });
  await prisma.booking.delete({ where: { id } });

  revalidateTag(SCHEDULE_CALENDAR_TAG, {});
  return NextResponse.json({ ok: true });
}
