// src/features/business/lib/event-prefill.server.ts
// Resolves booking calendar events into a job prefill: corrected times, client details, and
// one round trip of frozen drive time.

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
 * Loads one event (live, so a just-saved time correction shows) with its Booking and TravelBlock.
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
    // Raw minutes: the rounded figure carries a scheduling buffer that must not be billed.
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
 * Drive prediction for one event: the frozen TravelBlock, else a booking snapshot only when it
 * has a back leg (one-way snapshots are traffic-free quotes).
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
 * Flattens an address to one comma-joined line, since `<input>` strips newlines ("RoadEpsom").
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
 * Builds the prefill for one or more events billed as one job, one slot each so gaps aren't
 * billed. Client from the earliest booked event; travel out to the first, home from the last.
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
  // A merged run can start with a bare calendar entry, so use the first booked event.
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

  // One round trip per job; hops between merged events aren't billed.
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
    // Prisma enum > client form; null lets the calculator infer from the address.
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
