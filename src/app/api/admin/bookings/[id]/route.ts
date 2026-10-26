// src/app/api/admin/bookings/[id]/route.ts
// Admin API for editing and cancelling bookings by ID.

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import { BOOKING_FIELD_LIMITS, combineUnitAndAddress } from "@/features/booking/lib/booking";
import { loadBlockingBookings } from "@/features/booking/lib/existing-bookings.server";
import { createDraftCancellationInvoice } from "@/features/business/lib/cancellation-invoice";
import { assessCancellation } from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { releaseBookingRedemptions } from "@/features/business/lib/promo-redemption";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import {
  fetchAllCalendarEvents,
  patchBookingEvent,
  SCHEDULE_CALENDAR_TAG,
} from "@/features/calendar/lib/google-calendar";
import { removeBookingEvent } from "@/features/calendar/lib/pending-calendar-deletes";
import {
  sendCustomerBookingConfirmation,
  sendOwnerBookingNotification,
} from "@/features/reviews/lib/email-booking";
import { cancelHeldBookingEmails } from "@/features/reviews/lib/email-core";
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

/**
 * Longest span a hand-typed time edit may produce: a typo guard, not a policy limit.
 */
const MAX_SPAN_HOURS = 12;

interface PatchPayload {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  /** Visit notes (parking, directions, access); blank clears them. */
  accessNotes?: string;
  address?: string;
  status?: "confirmed" | "cancelled" | "completed";
  /**
   * "operator" (default): no fee. "on-behalf": customer cancelled, standard fee rules.
   */
  cancelMode?: "operator" | "on-behalf";
  /** No-show: always charges callout + travel via the draft-invoice flow. */
  markNoShow?: boolean;
  /**
   * Charging paths only. False records the fee but skips the invoice draft. Default true.
   */
  draftInvoice?: boolean;
  /** New start (ISO) for a time edit. Must be sent together with `endAt`. */
  startAt?: string;
  /** New end (ISO) for a time edit. Must be sent together with `startAt`. */
  endAt?: string;
  /**
   * Time edits only. False moves silently: no emails, silent invite. Default true.
   */
  notifyCustomer?: boolean;
  /** Save a future time change that overlaps something else anyway. */
  force?: boolean;
}

/**
 * Finds a live booking or watched-calendar event in the proposed window. Raw overlap only:
 * hand-typed times already allow for the drive.
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
  // Passing the proposed start as the cutoff narrows to bookings that could overlap.
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
 * Updates a booking. Cancelling frees the slot. A past-to-past time move records what
 * happened silently; any other move is a full reschedule. The Google event always follows.
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

  // Lock money-moving changes and time edits on well-past bookings; metadata edits and
  // completing (which costs nothing) stay allowed.
  const isMoneyStateChange =
    (body.status !== undefined && body.status !== "completed") || body.markNoShow === true;
  const isTimeChange = body.startAt !== undefined || body.endAt !== undefined;
  const { scheduling } = await getSettings();
  if (
    (isMoneyStateChange || isTimeChange) &&
    isPastEditWindow(booking.endAt.getTime(), now.getTime(), scheduling.pastEditLockHours)
  ) {
    return errorResponse(
      `Can't change a booking more than ${scheduling.pastEditLockHours}h after it ended.`,
      409,
    );
  }

  // A completed job happened, so it can't be cancelled or marked a no-show.
  if (booking.status === "completed" && (body.status === "cancelled" || body.markNoShow === true)) {
    return errorResponse("This booking is already completed.", 409);
  }

  // Sparse update: only fields present in the body get written.
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) data.name = body.name.trim();
  if (body.email !== undefined) data.email = body.email.trim();
  if (body.phone !== undefined) data.phone = toE164NZ(body.phone) || null;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.accessNotes !== undefined) {
    data.accessNotes = body.accessNotes.trim().slice(0, BOOKING_FIELD_LIMITS.accessNotes) || null;
  }
  // The column is what the detail page, its Maps button and the emails read.
  if (body.address !== undefined) data.address = body.address.trim() || null;

  if (body.address !== undefined && body.notes === undefined) {
    const currentNotes = booking.notes ?? "";
    const newAddress = body.address.trim();
    if (/^Address:\s*/im.test(currentNotes)) {
      data.notes = currentNotes.replace(/^(Address:\s*).*$/im, newAddress ? `$1${newAddress}` : "");
    } else if (newAddress) {
      // No Address: line yet, so append one.
      data.notes = currentNotes
        ? `${currentNotes}\nAddress: ${newAddress}`
        : `Address: ${newAddress}`;
    }
  }

  // Time edit runs before the status branches so a same-request cancel still releases the slot.
  // `notify` means the customer hears about it.
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

    // Silent only when BOTH times are past; anything else notifies.
    const alreadyRun =
      booking.startAt.getTime() <= now.getTime() && startAt.getTime() <= now.getTime();
    const isReschedule = !alreadyRun && booking.status !== "cancelled";
    // Muting only skips emails; everything below still runs.
    const notify = isReschedule && body.notifyCustomer !== false;

    if (isReschedule && !body.force) {
      const conflict = await findScheduleConflict(id, booking.calendarEventId, startAt, endAt);
      if (conflict) {
        return errorResponse(`That overlaps ${conflict}.`, 409);
      }
    }

    data.startAt = startAt;
    data.endAt = endAt;
    // Released rows keep `released:<id>` and must not reclaim a slot.
    if (!booking.activeSlotKey?.startsWith("released:")) {
      data.activeSlotKey = startAt.toISOString();
    }
    // A moved start needs its 24h reminder again; a finish-only change doesn't.
    if (startAt.getTime() !== booking.startAt.getTime()) {
      data.emailReminderSentAt = null;
    }

    if (isReschedule) {
      // The ICS SEQUENCE comes from rescheduleCount and must rise to supersede.
      data.rescheduleCount = { increment: 1 };
      // Re-snapshot travel at the new times; past jobs keep their frozen travel.
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
      // Silent, or the cancellation email reads as the operator calling it off.
      await removeBookingEvent({ eventId: booking.calendarEventId, notifyAttendees: false });
    }
    const noShowAt = new Date();
    const { CANCELLATION: noShowPolicy } = await getPolicy();
    // A no-show always charges; the policy still decides whether a drive is billed.
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
      await removeBookingEvent({ eventId: booking.calendarEventId });
    }
    const onBehalf = body.cancelMode === "on-behalf";
    data.status = "cancelled";
    data.activeSlotKey = `released:${id}`;
    data.cancelledAt = now;
    // Operator cancels never charge; on-behalf follows customer fee rules.
    data.cancelledBy = onBehalf ? "customer" : "operator";
    const { CANCELLATION } = await getPolicy();
    // In-person and remote have their own windows and fees.
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

  // activeSlotKey is unique: P2002 means another live booking holds that start (can't be forced).
  const updated = await prisma.booking.update({ where: { id }, data }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  });
  if (!updated) {
    return errorResponse("Another booking already starts at that time.", 409);
  }

  // Recall now-wrong held Resend emails (reminders, earlier "moved" notices) before holding
  // the new one. Only on a moved start, matching the reminder reset above.
  const cancelledNow = updated.status === "cancelled" && booking.status !== "cancelled";
  const startMoved =
    timeChange !== null && timeChange.startAt.getTime() !== booking.startAt.getTime();
  if (cancelledNow || startMoved) {
    await cancelHeldBookingEmails(id);
  }

  // Keep the Google event in step; best-effort, but a failure comes back as a warning.
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

  // Tell both parties about a real reschedule; the helpers never throw.
  if (timeChange?.notify) {
    const emailAddress = combineUnitAndAddress(updated.unit ?? "", updated.address ?? "");
    await Promise.all([
      sendCustomerBookingConfirmation(
        {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          notes: updated.notes ?? "",
          accessNotes: updated.accessNotes,
          startAt: timeChange.startAt,
          endAt: timeChange.endAt,
          cancelToken: updated.cancelToken,
          promoTitleAtBooking: updated.promoTitleAtBooking,
          address: emailAddress,
          meetingType: updated.meetingType,
          rescheduleCount: updated.rescheduleCount,
        },
        // Operator-driven, so it waits for the quiet window.
        { kind: "rescheduled", previousStartAt: booking.startAt, quietHours: true },
      ),
      sendOwnerBookingNotification(
        {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          notes: updated.notes ?? "",
          accessNotes: updated.accessNotes,
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

  // A cancelled or no-show booking frees its promo redemption. Swallows its own errors.
  if (updated.status === "cancelled" && booking.status !== "cancelled") {
    await releaseBookingRedemptions(id);
  }

  // Cancellation draft for on-behalf and no-show; opting out skips only the invoice, not the fee.
  if (
    updated.lateCancellation &&
    updated.cancelledBy === "customer" &&
    booking.status !== "cancelled" &&
    body.draftInvoice !== false
  ) {
    // Awaited: Vercel freezes the instance after the response, so a detached call may never run.
    try {
      await createDraftCancellationInvoice(updated, {
        reason: updated.noShow ? "no-show" : "late-cancellation",
      });
    } catch (err) {
      console.error("[admin/bookings] Failed to draft cancellation invoice:", err);
    }
  }

  // Sync the live contact matched by primary or alt email, case-insensitively.
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
    ...(timeChange ? { notified: timeChange.notify } : {}),
    ...(calendarWarning ? { calendarWarning } : {}),
  });
}

/**
 * DELETE /api/admin/bookings/[id]
 * Permanently deletes a booking and its calendar event.
 * Requires an admin session (cookie or X-Admin-Secret header).
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

  // A Google failure is queued for the reconcile cron, so the event goes even with the row.
  if (booking.calendarEventId) {
    await removeBookingEvent({ eventId: booking.calendarEventId });
  }

  // Review.bookingId is a bare ObjectId, so clear it; the review keeps its contact link.
  await prisma.review.updateMany({ where: { bookingId: id }, data: { bookingId: null } });
  // Drop an unsettled redemption; a settled one records a real discount and stays.
  await releaseBookingRedemptions(id);
  await cancelHeldBookingEmails(id);
  await prisma.booking.delete({ where: { id } });

  revalidateTag(SCHEDULE_CALENDAR_TAG, {});
  return NextResponse.json({ ok: true });
}
