// src/features/booking/lib/booking-event.server.ts
// The booking calendar event's title, invite text and location, built from the saved row so
// an edit that doesn't move the time can bring the existing event up to date.

import {
  buildAppointmentDescription,
  combineUnitAndAddress,
  parseBookingNotes,
  type JobDuration,
} from "@/features/booking/lib/booking";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { MeetingType } from "@prisma/client";

/**
 * Event title, as a public booking names it ("Tech Support: Jo Bloggs - Standard 60 min").
 * @param name - Customer name.
 * @param duration - Booked job length.
 * @param minutes - That length in minutes.
 * @returns The event summary.
 */
export function bookingEventSummary(name: string, duration: JobDuration, minutes: number): string {
  return `Tech Support: ${name} - ${duration === "short" ? "Standard" : "Extended"} ${minutes} min`;
}

/**
 * The event's invite text and location for a booking row. The customer is an attendee, so
 * the text carries only their own notes, never the internal metadata or quote.
 * @param booking - The saved booking fields the event shows.
 * @param booking.cancelToken - Token for the change and cancel links.
 * @param booking.notes - Raw notes blob; only the customer's own text is used.
 * @param booking.accessNotes - Parking, directions and other visit notes.
 * @param booking.meetingType - Column value; legacy rows fall back to the notes.
 * @param booking.address - Street address column (without the unit).
 * @param booking.unit - Unit column.
 * @returns The description and location (null for a remote session).
 */
export async function bookingEventDetails(booking: {
  cancelToken: string;
  notes: string | null;
  accessNotes: string | null;
  meetingType: MeetingType | null;
  address: string | null;
  unit: string | null;
}): Promise<{ description: string; location: string | null }> {
  const parsed = parseBookingNotes(booking.notes);
  const isRemote = booking.meetingType
    ? booking.meetingType === "remote"
    : parsed.meetingType === "remote";
  const address = booking.address
    ? combineUnitAndAddress(booking.unit ?? "", booking.address)
    : parsed.address;
  const identity = await getIdentity();
  const siteUrl = getSiteUrl();
  const token = encodeURIComponent(booking.cancelToken);
  return {
    description: buildAppointmentDescription({
      company: identity.company,
      phone: identity.phone,
      email: identity.email,
      isRemote,
      userNotes: parsed.userNotes,
      accessNotes: booking.accessNotes,
      manageUrl: `${siteUrl}/booking/edit?token=${token}`,
      cancelUrl: `${siteUrl}/booking/cancel?token=${token}`,
    }),
    location: !isRemote && address ? address : null,
  };
}
