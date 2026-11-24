// src/features/reviews/lib/review-ask-job-type.server.ts
// Whether the job a review ask thanks someone for was remote, so the ask can say "letting me
// help" instead of "having me out". Unknown counts as in person, the usual case.

import { meetingTypeFromNotes } from "@/features/booking/lib/booking";
import { prisma } from "@/shared/lib/prisma";

// Line wording that only a remote or phone job uses. "Phone setup" or "TV remote" name a
// device, so the bare words "phone" and "remote" can't count.
const REMOTE_LINE = /\bremote session\b|\bover the phone\b/i;

/**
 * Whether a booking was a remote session, from its column or, on legacy rows, its notes.
 * @param booking - The booking's meeting type and notes.
 * @param booking.meetingType - The MeetingType column, null on legacy rows.
 * @param booking.notes - The notes blob, which states the type on legacy rows.
 * @returns True for a remote booking.
 */
export function isRemoteBooking(booking: {
  meetingType: string | null;
  notes: string | null;
}): boolean {
  return (booking.meetingType ?? meetingTypeFromNotes(booking.notes)) === "remote";
}

/**
 * Whether the job an invoice billed was remote: its booking says so, or a line says
 * "remote session" or "over the phone".
 * @param invoice - The invoice's booking link and line descriptions.
 * @param invoice.bookingId - Booking it billed, or null.
 * @param invoice.lineItems - Its lines; only the descriptions are read.
 * @returns True for a remote job.
 */
export async function isRemoteInvoiceJob(invoice: {
  bookingId: string | null;
  lineItems: Array<{ description: string }>;
}): Promise<boolean> {
  if (invoice.lineItems.some((l) => REMOTE_LINE.test(l.description))) return true;
  if (!invoice.bookingId) return false;
  const booking = await prisma.booking.findUnique({
    where: { id: invoice.bookingId },
    select: { meetingType: true, notes: true },
  });
  return booking ? isRemoteBooking(booking) : false;
}

/**
 * Whether this person's most recent booking that has already started was remote. Used by a
 * hand-sent ask, which names a person rather than a job.
 * @param email - Their email address, or null for a text-only ask.
 * @param now - Current instant.
 * @returns True when that booking was remote; false with no such booking.
 */
export async function latestJobWasRemote(email: string | null, now = new Date()): Promise<boolean> {
  if (!email) return false;
  const booking = await prisma.booking.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      status: { not: "cancelled" },
      startAt: { lte: now },
    },
    orderBy: { startAt: "desc" },
    select: { meetingType: true, notes: true },
  });
  return booking ? isRemoteBooking(booking) : false;
}
