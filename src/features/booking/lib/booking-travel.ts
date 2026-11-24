// src/features/booking/lib/booking-travel.ts
// Drive-time rule for a new in-person booking: the drive from the previous job (or, for a slot
// today, from the ring around home your phone is in) and on to the next one must fit around the
// slot. Pure, so the booking form can mask its grid with it.

import type { BookableDay } from "@/features/booking/lib/booking";
import { buildTimeline, type LocatedCommitment } from "@/features/calendar/lib/travel-timeline";
import { nzDateKey } from "@/shared/lib/timezone-utils";

const MIN = 60_000;

/** Customer-facing refusal when the drive from the previous job doesn't fit. */
export const TRAVEL_FROM_PREVIOUS_MESSAGE =
  "That time doesn't leave enough travel time from my previous job - please pick another.";

/** Customer-facing refusal when the drive on to the next job doesn't fit. */
export const TRAVEL_TO_NEXT_MESSAGE =
  "That time doesn't leave enough travel time to get to my next job - please pick another.";

/** Customer-facing refusal when the drive from where you are now doesn't fit, for a slot today. */
export const TRAVEL_FROM_HERE_MESSAGE =
  "That time doesn't leave me enough time to get to you from where I am - please pick a later time.";

/**
 * How far ahead of the next commitment's start the drive to it is priced. One departure per
 * commitment, not one per slot end, keeps it to one Distance Matrix call; the slots that hinge
 * on it end roughly a drive's length before that start, so traffic there is what matters.
 */
export const TO_NEXT_DEPARTURE_LEAD_MIN = 60;

/** Departures in a memo key are rounded to this, so near-identical lookups share a call. */
const DEPARTURE_ROUND_MS = 5 * MIN;

/** A located commitment plus the gap kept after it before driving on. */
export interface TravelCommitment extends LocatedCommitment {
  /** Minutes kept after the end in case it runs long. */
  bufferAfterMin: number;
}

/** One drive to price. */
export interface TravelLeg {
  origin: string;
  destination: string;
  /** Departure the traffic prediction is for. */
  departMs: number;
}

/**
 * Rings around home the phone position is reduced to, nearest first, each with the drive assumed
 * from anywhere inside it. Only the ring is used, so the real point is never sent to Google and
 * the "from where you are" drive costs no lookup. Beyond the last ring, {@link FAR_RING_DRIVE_MIN}.
 */
export const LOCATION_RINGS: ReadonlyArray<{ withinKm: number; driveMin: number }> = [
  { withinKm: 5, driveMin: 15 },
  { withinKm: 10, driveMin: 25 },
  { withinKm: 20, driveMin: 40 },
];

/** Drive assumed from further out than the last of {@link LOCATION_RINGS}. */
export const FAR_RING_DRIVE_MIN = 60;

/** Where you are right now, reduced to a ring around home (never at home: that's no spot). */
export interface CurrentSpot {
  /** Ring label for logs and the leg key, e.g. "within 10 km" or "further". */
  ring: string;
  /** Drive assumed from this ring to any customer. */
  driveMin: number;
  /** Now (ms). */
  atMs: number;
}

/**
 * The ring a phone position falls in, from its straight-line distance to home.
 * @param distanceM - Metres from home.
 * @param atHomeRadiusM - Within this, you count as home.
 * @returns "home", or the ring label and its drive minutes.
 */
export function locationRing(
  distanceM: number,
  atHomeRadiusM: number,
): "home" | { ring: string; driveMin: number } {
  if (distanceM <= atHomeRadiusM) return "home";
  for (const r of LOCATION_RINGS) {
    if (distanceM <= r.withinKm * 1000) {
      return { ring: `within ${r.withinKm} km`, driveMin: r.driveMin };
    }
  }
  return { ring: "further", driveMin: FAR_RING_DRIVE_MIN };
}

/** The drives a slot depends on; null where there's no commitment that side of it that day. */
export interface SlotTravelLegs {
  /**
   * Drive in from the previous commitment, or from where you are now; `readyMs` is when you can
   * set off, `fromHere` marks the drive from your ring, whose fixed minutes are `fixedMin`.
   */
  from: (TravelLeg & { readyMs: number; fromHere?: boolean; fixedMin?: number }) | null;
  /** Drive on to the next commitment; `arriveByMs` is its start. */
  to: (TravelLeg & { arriveByMs: number }) | null;
}

/** Whether a slot's drives fit, and which one doesn't when not. */
export type TravelVerdict = "ok" | "from-previous" | "from-here" | "to-next";

/** A grid start that the drive rules out, per job length. */
export interface TravelBlockedSlot {
  dateKey: string;
  startHour: number;
  minute: number;
  /** The 1hr job can't start here. */
  short: boolean;
  /** The 2hr job can't start here. */
  long: boolean;
}

/**
 * The located commitments a new booking has to fit between, with the gap each keeps after it:
 * bookings their after-booking buffer, calendar events the event buffer. Personal events follow
 * {@link buildTimeline}: the drive after one starts from home once you're back.
 * @param input - Commitments and the rules for reading them.
 * @param input.bookings - Confirmed in-person bookings.
 * @param input.events - Calendar events (not all-day, not a booking's own event).
 * @param input.personalCalId - The personal calendar's id ("" when not configured).
 * @param input.homeAddress - Home, where the drive after a personal event starts.
 * @param input.backMinByEventId - Travel-home minutes per event, from its TravelBlock.
 * @param input.bookingBufferMin - Gap kept after a booking.
 * @param input.eventBufferMin - Gap kept after a calendar event.
 * @returns Commitments ordered by start.
 */
export function buildTravelTimeline(input: {
  bookings: Array<{ startAt: Date; endAt: Date; address: string | null; notes: string | null }>;
  events: Array<{
    id: string;
    start: string;
    end: string;
    location?: string;
    calendarEmail: string;
  }>;
  personalCalId: string;
  homeAddress: string;
  backMinByEventId: Map<string, number>;
  bookingBufferMin: number;
  eventBufferMin: number;
}): TravelCommitment[] {
  const { personalCalId, homeAddress, backMinByEventId } = input;
  const fromBookings = buildTimeline(input.bookings, [], personalCalId, homeAddress, new Map());
  const fromEvents = buildTimeline([], input.events, personalCalId, homeAddress, backMinByEventId);
  return [
    ...fromBookings.map((c) => ({ ...c, bufferAfterMin: input.bookingBufferMin })),
    ...fromEvents.map((c) => ({ ...c, bufferAfterMin: input.eventBufferMin })),
  ].sort((a, b) => a.startMs - b.startMs);
}

/**
 * The drives a slot at `address` depends on: in from the commitment before it that NZ day and on
 * to the one after it. A day with no other commitment needs no drive priced; the drive from home
 * at the start of a day has no earlier finish to clash with. For a slot today, a known current
 * spot replaces the drive in once nothing earlier is still running: the phone is where you
 * actually are, whatever the calendar says.
 * @param slotStartMs - Slot start.
 * @param slotEndMs - Slot end.
 * @param address - The new customer's address.
 * @param timeline - Located commitments from {@link buildTravelTimeline}.
 * @param here - Where you are now, or null when the phone location isn't usable.
 * @returns The legs to price; either side null when nothing is there that day.
 */
export function slotTravelLegs(
  slotStartMs: number,
  slotEndMs: number,
  address: string,
  timeline: TravelCommitment[],
  here: CurrentSpot | null = null,
): SlotTravelLegs {
  const dayKey = nzDateKey(new Date(slotStartMs));
  let prev: TravelCommitment | null = null;
  let next: TravelCommitment | null = null;
  for (const c of timeline) {
    if (nzDateKey(new Date(c.startMs)) !== dayKey) continue;
    // Latest finish among those started before the slot: a personal event's travel home can
    // outlast a later, shorter commitment.
    if (c.startMs < slotStartMs && (!prev || c.endMs > prev.endMs)) prev = c;
    if (c.startMs >= slotEndMs && (!next || c.startMs < next.startMs)) next = c;
  }
  const fromHere =
    here !== null &&
    nzDateKey(new Date(here.atMs)) === dayKey &&
    here.atMs < slotStartMs &&
    (!prev || prev.endMs <= here.atMs);
  return {
    from: fromHere
      ? {
          origin: `ring:${here.ring}`,
          destination: address,
          departMs: here.atMs,
          // Still inside the last job's buffer: you set off once it's over.
          readyMs: Math.max(here.atMs, prev ? prev.endMs + prev.bufferAfterMin * MIN : 0),
          fromHere: true,
          fixedMin: here.driveMin,
        }
      : prev
        ? {
            origin: prev.leaveFrom,
            destination: address,
            departMs: prev.endMs,
            readyMs: prev.endMs + prev.bufferAfterMin * MIN,
          }
        : null,
    to: next
      ? {
          origin: address,
          destination: next.location,
          departMs: next.startMs - TO_NEXT_DEPARTURE_LEAD_MIN * MIN,
          arriveByMs: next.startMs,
        }
      : null,
  };
}

/**
 * Drive minutes for a slot's leg: the ring's fixed drive, else its Distance Matrix price.
 * @param leg - The leg, or null when that side has nothing.
 * @param prices - Priced legs by {@link travelLegKey}.
 * @returns Minutes, or null when there's no leg or it couldn't be priced.
 */
export function legMinutes(
  leg: (TravelLeg & { fixedMin?: number }) | null,
  prices: Map<string, number | null>,
): number | null {
  if (!leg) return null;
  return leg.fixedMin ?? prices.get(travelLegKey(leg)) ?? null;
}

/**
 * Memo key for a leg: same places, departure rounded to five minutes.
 * @param leg - The drive.
 * @returns Stable key.
 */
export function travelLegKey(leg: TravelLeg): string {
  const rounded = Math.round(leg.departMs / DEPARTURE_ROUND_MS) * DEPARTURE_ROUND_MS;
  return `${leg.origin.trim().toLowerCase()}|${leg.destination.trim().toLowerCase()}|${rounded}`;
}

/**
 * Whether the drives around a slot fit: ready to leave + drive in <= slot start, and slot end +
 * the slot's own after-booking buffer + drive on <= next start. A drive that couldn't be priced
 * (null) passes, so a failed lookup never hides a time.
 * @param slotStartMs - Slot start.
 * @param slotEndMs - Slot end.
 * @param slotBufferAfterMin - Gap kept after the new booking.
 * @param legs - The slot's legs from {@link slotTravelLegs}.
 * @param fromMin - Drive minutes for `legs.from`, or null when unpriced.
 * @param toMin - Drive minutes for `legs.to`, or null when unpriced.
 * @returns "ok", or the leg that doesn't fit.
 */
export function travelVerdict(
  slotStartMs: number,
  slotEndMs: number,
  slotBufferAfterMin: number,
  legs: SlotTravelLegs,
  fromMin: number | null,
  toMin: number | null,
): TravelVerdict {
  if (legs.from && fromMin !== null && legs.from.readyMs + fromMin * MIN > slotStartMs) {
    return legs.from.fromHere ? "from-here" : "from-previous";
  }
  if (
    legs.to &&
    toMin !== null &&
    slotEndMs + (slotBufferAfterMin + toMin) * MIN > legs.to.arriveByMs
  ) {
    return "to-next";
  }
  return "ok";
}

/**
 * The customer-facing refusal for a verdict.
 * @param verdict - A failing verdict.
 * @returns The message to show.
 */
export function travelVerdictMessage(verdict: Exclude<TravelVerdict, "ok">): string {
  if (verdict === "from-previous") return TRAVEL_FROM_PREVIOUS_MESSAGE;
  return verdict === "from-here" ? TRAVEL_FROM_HERE_MESSAGE : TRAVEL_TO_NEXT_MESSAGE;
}

/**
 * The grid with the drive-blocked starts closed. They aren't marked booked, so the picker leaves
 * them out rather than greying them.
 * @param days - Bookable days.
 * @param blocked - Starts the drive rules out.
 * @returns Days with those starts closed, and the window and day flags recomputed.
 */
export function applyTravelBlocks(
  days: BookableDay[],
  blocked: TravelBlockedSlot[],
): BookableDay[] {
  if (blocked.length === 0) return days;
  const byKey = new Map(blocked.map((b) => [`${b.dateKey}|${b.startHour}|${b.minute}`, b]));
  return days.map((day) => {
    if (!blocked.some((b) => b.dateKey === day.dateKey)) return day;
    const timeWindows = day.timeWindows.map((w) => {
      const subSlots = w.subSlots.map((s) => {
        const hit = byKey.get(`${day.dateKey}|${w.startHour}|${s.minute}`);
        if (!hit) return s;
        return {
          ...s,
          availableShort: s.availableShort && !hit.short,
          availableLong: s.availableLong && !hit.long,
        };
      });
      return {
        ...w,
        subSlots,
        availableShort: subSlots.some((s) => s.availableShort),
        availableLong: subSlots.some((s) => s.availableLong),
      };
    });
    return {
      ...day,
      timeWindows,
      hasAnySlots: timeWindows.some((w) => w.availableShort || w.availableLong),
    };
  });
}
