// Resolves Google Calendar booking events into a job prefill: corrected on-site times,
// the booking's client details, and one round trip of frozen drive time. Used by the
// calculator's "Bill in calculator" deep link and the draft-invoice editor's AI box.

import type { EventPrefill, EventPrefillSlot } from "@/features/business/types/business";
import { fetchBookingEvent } from "@/features/calendar/lib/google-calendar";
import { prisma } from "@/shared/lib/prisma";
import { NZ_TZ } from "@/shared/lib/timezone-utils";

/** Booking fields the prefill needs, shared by every merged event's lookup. */
const BOOKING_SELECT = {
  id: true,
  name: true,
  email: true,
  address: true,
  unit: true,
  meetingType: true,
  travelMinsAtBooking: true,
  travelMinsBackAtBooking: true,
} as const;

/**
 * Formats an ISO timestamp in a Pacific/Auckland part set.
 * @param iso - ISO timestamp.
 * @param options - Intl date/time part options.
 * @returns Formatted NZ-local string.
 */
function formatNz(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NZ_TZ, ...options }).format(new Date(iso));
}

/** One resolved calendar event plus the records that back it. */
interface ResolvedEvent {
  id: string;
  start: string;
  end: string;
  summary: string | null;
  location: string | null;
  booking: {
    id: string;
    name: string;
    email: string;
    address: string | null;
    unit: string | null;
    meetingType: string | null;
    travelMinsAtBooking: number | null;
    travelMinsBackAtBooking: number | null;
  } | null;
  travelBlock: { rawTravelMinutes: number | null; rawTravelBackMinutes: number | null } | null;
}

/**
 * Loads one calendar event with its Booking row and frozen TravelBlock. Live
 * event fetch - a just-saved time correction must be reflected, not the 60s
 * schedule cache.
 * @param eventId - Google Calendar event id.
 * @returns The resolved event, or null when it is missing or unbillable.
 */
async function resolveEvent(eventId: string): Promise<ResolvedEvent | null> {
  const event = await fetchBookingEvent(eventId);
  if (!event) return null;

  const [booking, travelBlock] = await Promise.all([
    prisma.booking
      .findFirst({ where: { calendarEventId: eventId }, select: BOOKING_SELECT })
      .catch(() => null),
    // Frozen drive prediction for the event's actual window. Raw minutes, not
    // rounded - the rounding carries the scheduling buffer, which pads the
    // calendar but must not be billed.
    prisma.travelBlock
      .findFirst({
        where: { sourceEventId: eventId },
        select: { rawTravelMinutes: true, rawTravelBackMinutes: true },
      })
      .catch(() => null),
  ]);

  return {
    id: eventId,
    start: event.start,
    end: event.end,
    summary: event.summary,
    location: event.location,
    booking,
    travelBlock,
  };
}

/**
 * Drive prediction for one event, preferring the frozen TravelBlock over the
 * booking snapshot. Booking snapshots are only trusted when they carry a back
 * leg - that field exists only since the traffic-aware two-leg change, so
 * one-way-only snapshots are free-flow-era quotes that would bill as if there
 * were no traffic.
 * @param resolved - The resolved event.
 * @returns There/back raw minutes; either may be null when nothing is known.
 */
function travelFor(resolved: ResolvedEvent): { there: number | null; back: number | null } {
  const snapshotIsTrafficAware = resolved.booking?.travelMinsBackAtBooking != null;
  return {
    there:
      resolved.travelBlock?.rawTravelMinutes ??
      (snapshotIsTrafficAware ? (resolved.booking?.travelMinsAtBooking ?? null) : null),
    back:
      resolved.travelBlock?.rawTravelBackMinutes ??
      (snapshotIsTrafficAware ? (resolved.booking?.travelMinsBackAtBooking ?? null) : null),
  };
}

/**
 * Flattens a calendar location or booking address to one line. Calendar
 * locations are often multi-line; `<input>` values strip newlines into
 * run-together text ("RoadEpsom"), so they are comma-joined instead.
 * @param resolved - The resolved event to read an address from.
 * @returns Single-line address, or an empty string when there is none.
 */
function addressOf(resolved: ResolvedEvent): string {
  const raw =
    (resolved.booking?.address
      ? [resolved.booking.unit, resolved.booking.address].filter(Boolean).join("/")
      : resolved.location) ?? "";
  return raw.replace(/,?\s*[\r\n]+\s*/g, ", ").trim();
}

/**
 * Builds the calculator prefill for one or more booking-calendar events. A
 * single id behaves exactly as before; several ids bill as one job, with each
 * event contributing its own time slot so the gaps between them are never
 * billed. Client details come from the earliest event that has a Booking row,
 * and travel is one round trip - out to the first event, home from the last -
 * because that is what the day actually cost.
 * @param eventIds - Google Calendar event ids, in any order.
 * @returns Prefill object, or null when no id resolves to a billable event.
 */
export async function buildEventPrefill(eventIds: string[]): Promise<EventPrefill | null> {
  const resolved = (await Promise.all(eventIds.map(resolveEvent)))
    .filter((e): e is ResolvedEvent => e !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (resolved.length === 0) return null;

  const first = resolved[0]!;
  const last = resolved[resolved.length - 1]!;
  // Client identity comes from the earliest event that actually has a booking:
  // a merged run can start with a bare calendar entry and still be the same
  // customer's job.
  const withBooking = resolved.find((e) => e.booking) ?? first;
  const booking = withBooking.booking;

  const slots: EventPrefillSlot[] = resolved.map((e) => ({
    calendarEventId: e.id,
    bookingId: e.booking?.id ?? null,
    date: formatNz(e.start, { year: "numeric", month: "2-digit", day: "2-digit" }),
    startTime: formatNz(e.start, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    endTime: formatNz(e.end, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    summary: e.summary ?? "(no title)",
  }));

  // One round trip for the whole job: drive out for the first event, home
  // after the last. Hops between merged events are not billed - they are the
  // same trip, and the operator never charges twice for being in the area.
  const outbound = travelFor(first);
  const inbound = travelFor(last);

  return {
    calendarEventId: first.id,
    bookingId: booking?.id ?? null,
    jobDate: formatNz(first.start, { year: "numeric", month: "2-digit", day: "2-digit" }),
    slots,
    clientName: booking?.name ?? withBooking.summary ?? "",
    clientEmail: booking?.email ?? "",
    jobAddress: addressOf(withBooking) || addressOf(first),
    // Cancel mode bills no round trip on a remote session. Map the Prisma enum
    // to the hyphenated form the client side uses; null when no booking backs
    // the event, and the calculator falls back to inferring from the address.
    meetingType:
      booking?.meetingType === "remote"
        ? "remote"
        : booking?.meetingType === "in_person"
          ? "in-person"
          : null,
    travelMinsThere: outbound.there,
    travelMinsBack: inbound.back ?? outbound.back,
  };
}
