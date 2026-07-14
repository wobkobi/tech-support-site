// src/app/api/admin/schedule/suggest-times/route.ts
/**
 * @description Admin "find open times" tool. Returns the next N genuinely-bookable
 * slots for a given job length + date range, so the operator can offer times to a
 * customer on the phone and one-click create the booking. Reuses the PUBLIC
 * availability engine (buildAvailableDays) so suggestions match exactly what the
 * public booking page would allow - working hours, breaks, buffers, caps, notice,
 * blocked days - and additionally injects existing TravelBlock rows as occupied
 * padding so a suggested slot leaves room for the drive to/from nearby jobs.
 */

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import { buildAvailableDays, type ExistingBooking } from "@/features/booking/lib/booking";
import { fetchAllCalendarEvents } from "@/features/calendar/lib/google-calendar";
import { calculateTravelMinutes } from "@/features/calendar/lib/travel-time";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { addDaysToDateKey, getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

// A slow Google/DB round-trip must not 504 on the default timeout.
export const maxDuration = 60;

// Cap results so a wide range doesn't return hundreds of rows; the operator only
// needs a handful of times to read out over the phone.
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;
// Default search/fetch window when no explicit range - bounds the Google fetch so
// the always-on schedule bar doesn't pull weeks of events on every page load.
const HORIZON_DAYS = 28;
// Cap suggestions per day so the list spreads across several days instead of
// offering a single busy day's worth of hours.
const PER_DAY_LIMIT = 3;

interface SuggestPayload {
  /** Job length to fit; maps to config.durations.short/long. */
  duration?: "short" | "long";
  /** Inclusive NZ date range (YYYY-MM-DD). Defaults to today > maxAdvance. */
  fromDateKey?: string;
  toDateKey?: string;
  /** Max slots to return (1..MAX_LIMIT). */
  limit?: number;
  /**
   * New customer's address (typed or from a looked-up contact). When set, slots
   * are gated by the real drive from the preceding located job to here and on to
   * the following one - so only times that actually fit the travel are returned.
   */
  address?: string;
}

interface SuggestedSlot {
  dateKey: string;
  /** UTC ISO of the slot start, ready to hand to ManualBookingModal. */
  startIso: string;
  startHour: number;
  minute: number;
  /** "Wed 16 Jul". */
  dayLabel: string;
  /** "9:00am". */
  timeLabel: string;
  /** Drive from the preceding job, set only when gated by address (e.g. "18 min drive"). */
  driveNote?: string;
}

interface LocatedCommitment {
  startMs: number;
  endMs: number;
  location: string;
}

// Cap how many candidates get priced with Google when gating by address, so a
// wide search can't fan out into an unbounded number of Distance Matrix calls.
const GATE_CAP = 12;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Formats an NZ hour + minute as a 12h label, e.g. (9, 0) > "9:00am".
 * @param hour - Hour of day 0-23.
 * @param minute - Minute past the hour.
 * @returns 12-hour label with am/pm.
 */
function timeLabel(hour: number, minute: number): string {
  const period = hour < 12 ? "am" : "pm";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")}${period}`;
}

/**
 * Picks up to `n` items evenly spread across `items` (always including the first
 * and last), so a capped-per-day set of suggestions covers the morning-to-afternoon
 * span rather than clustering at the start of the day.
 * @param items - Candidate items in chronological order.
 * @param n - Maximum items to pick.
 * @returns Up to `n` evenly-spaced items.
 */
function spreadEvenly<T>(items: T[], n: number): T[] {
  if (n <= 1) return items.slice(0, Math.max(0, n));
  if (items.length <= n) return items;
  const picks: T[] = [];
  for (let i = 0; i < n; i++) {
    picks.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  }
  return picks;
}

/**
 * A booking's job address: the dedicated field, else an "Address:" line parsed
 * from its notes (where the booking flows store it).
 * @param b - Booking to read a location from.
 * @param b.address - The booking's dedicated address field, if set.
 * @param b.notes - The booking's notes, which may carry an "Address:" line.
 * @returns The address string, or null when none is recorded.
 */
function bookingLocation(b: { address: string | null; notes: string | null }): string | null {
  const a = b.address?.trim();
  if (a) return a;
  return b.notes?.match(/Address:\s*(.+)/i)?.[1]?.trim() ?? null;
}

/**
 * Filters candidate slots to those that fit the real drive to a new customer's
 * address: you must be able to reach it from the preceding located job in time
 * and still leave for the following one. Prices only the first GATE_CAP candidates
 * (a bounded pair of Distance Matrix calls each, run in parallel) and annotates the
 * survivors with the drive from the previous job.
 * @param rawSlots - Candidate slots in chronological order.
 * @param address - The new job's address.
 * @param durationMin - Job length in minutes, for the slot's end time.
 * @param bookings - Upcoming bookings, for their job addresses.
 * @param events - Calendar events, for their locations.
 * @param limit - Max surviving slots to return.
 * @returns Slots that fit the drive, annotated, capped at `limit`.
 */
async function gateByTravel(
  rawSlots: SuggestedSlot[],
  address: string,
  durationMin: number,
  bookings: Array<{ startAt: Date; endAt: Date; address: string | null; notes: string | null }>,
  events: Array<{ start: string; end: string; location?: string }>,
  limit: number,
): Promise<SuggestedSlot[]> {
  const timeline: LocatedCommitment[] = [];
  for (const b of bookings) {
    const loc = bookingLocation(b);
    if (loc)
      timeline.push({ startMs: b.startAt.getTime(), endMs: b.endAt.getTime(), location: loc });
  }
  for (const e of events) {
    if (e.location) {
      timeline.push({
        startMs: new Date(e.start).getTime(),
        endMs: new Date(e.end).getTime(),
        location: e.location,
      });
    }
  }
  timeline.sort((a, b) => a.startMs - b.startMs);

  const gated = await Promise.all(
    rawSlots.slice(0, GATE_CAP).map(async (slot): Promise<SuggestedSlot | null> => {
      const startMs = new Date(slot.startIso).getTime();
      const endMs = startMs + durationMin * 60_000;
      // Nearest located job ending before the slot, and the first starting after it.
      let prev: LocatedCommitment | undefined;
      let next: LocatedCommitment | undefined;
      for (const c of timeline) {
        if (c.endMs <= startMs) prev = c;
        else if (c.startMs >= endMs && !next) next = c;
      }
      // Price both legs at once - departing the previous job at its end, and the
      // new job at its end. Driving uses a known departure, so no arrive-by needed.
      const [driveIn, driveOut] = await Promise.all([
        prev
          ? calculateTravelMinutes(prev.location, address, new Date(prev.endMs), {
              mode: "driving",
            })
          : Promise.resolve(null),
        next
          ? calculateTravelMinutes(address, next.location, new Date(endMs), { mode: "driving" })
          : Promise.resolve(null),
      ]);
      // A null result = API misconfig/failure; don't drop the slot on that alone.
      if (prev && driveIn != null && prev.endMs + driveIn * 60_000 > startMs) return null;
      if (next && driveOut != null && endMs + driveOut * 60_000 > next.startMs) return null;
      if (prev && driveIn != null) return { ...slot, driveNote: `${driveIn} min drive` };
      return slot;
    }),
  );
  return gated.filter((s): s is SuggestedSlot => s !== null).slice(0, limit);
}

/**
 * POST /api/admin/schedule/suggest-times
 * Body: { duration, fromDateKey?, toDateKey?, limit? }. Requires admin auth.
 * @param request - Incoming request (admin-authenticated).
 * @returns JSON `{ slots, duration, durationMin }` or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json().catch(() => null)) as SuggestPayload | null;
  const duration = body?.duration === "long" ? "long" : "short";
  const limit = Math.min(MAX_LIMIT, Math.max(1, body?.limit ?? DEFAULT_LIMIT));
  const fromDateKey =
    body?.fromDateKey && DATE_KEY_RE.test(body.fromDateKey) ? body.fromDateKey : null;
  const toDateKey = body?.toDateKey && DATE_KEY_RE.test(body.toDateKey) ? body.toDateKey : null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";

  const now = new Date();
  // Admin tool: use the availability CONFIG but ignore the public accepting-bookings
  // master switch - the operator books on behalf even while public booking is paused.
  const { config } = await getAvailabilityConfig();
  const durationMin = duration === "long" ? config.durations.long : config.durations.short;

  const searchDays = Math.min(config.maxAdvanceDays, HORIZON_DAYS);
  const maxDate = new Date(now.getTime() + (searchDays + 1) * 24 * 60 * 60 * 1000);
  const todayNzKey = now.toLocaleDateString("en-CA", { timeZone: config.timeZone });
  const horizonKey = addDaysToDateKey(todayNzKey, searchDays);
  // Never suggest a day past the fetched window - its events aren't loaded, so it
  // would look falsely free. A caller-supplied toDateKey only tightens this.
  const effectiveToKey = toDateKey && toDateKey < horizonKey ? toDateKey : horizonKey;

  // Existing commitments: DB bookings (held/confirmed, still upcoming) + calendar
  // events + travel padding, all fed to the same slot engine the public flow uses.
  const [existingBookings, rawEvents, travelBlocks] = await Promise.all([
    prisma.booking.findMany({
      where: { status: { in: ["held", "confirmed"] }, endAt: { gte: now } },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
        address: true,
        notes: true,
      },
    }),
    fetchAllCalendarEvents(now, maxDate).catch(() => []),
    prisma.travelBlock.findMany({
      where: { eventStartAt: { lt: maxDate }, eventEndAt: { gte: now } },
      select: {
        id: true,
        eventStartAt: true,
        eventEndAt: true,
        roundedMinutes: true,
        roundedBackMinutes: true,
        beforeEventId: true,
        afterEventId: true,
        travelBackSuppressed: true,
      },
    }),
  ]);

  const existingForSlots: ExistingBooking[] = existingBookings.map((b) => ({
    id: b.id,
    startAt: b.startAt,
    endAt: b.endAt,
    bufferBeforeMin: b.bufferBeforeMin,
    bufferAfterMin: b.bufferAfterMin,
  }));

  const calendarEvents = rawEvents.map((e) => ({ id: e.id, start: e.start, end: e.end }));

  // Inject travel as synthetic occupied blocks. isSlotFree recognises the
  // `travel-before:`/`travel-after:` id prefixes and applies NO extra buffer to
  // them (the rounded minutes already include the buffer), so a suggested slot
  // won't overlap the drive to or from an adjacent job. Same guards as the
  // schedule grid: a leg only exists when its rounded minutes are set, and the
  // return leg is skipped when it was suppressed (operator stayed out).
  for (const b of travelBlocks) {
    if (b.beforeEventId && b.roundedMinutes != null && b.roundedMinutes > 0) {
      calendarEvents.push({
        id: `travel-before:${b.id}`,
        start: new Date(b.eventStartAt.getTime() - b.roundedMinutes * 60_000).toISOString(),
        end: b.eventStartAt.toISOString(),
      });
    }
    if (
      b.afterEventId &&
      !b.travelBackSuppressed &&
      b.roundedBackMinutes != null &&
      b.roundedBackMinutes > 0
    ) {
      calendarEvents.push({
        id: `travel-after:${b.id}`,
        start: b.eventEndAt.toISOString(),
        end: new Date(b.eventEndAt.getTime() + b.roundedBackMinutes * 60_000).toISOString(),
      });
    }
  }

  const { days } = buildAvailableDays(existingForSlots, calendarEvents, now, config);

  // Flatten to the next `limit` slots for the chosen duration, honouring the
  // optional date range. Days come back in chronological order, windows by start
  // hour, sub-slots by minute - so first-come iteration yields the soonest times.
  // Build the candidate pool first. With an address we gather a wider pool (up to
  // GATE_CAP) so travel-gating still leaves enough survivors for `limit`.
  const rawSlots: SuggestedSlot[] = [];
  const cap = address ? Math.max(limit, GATE_CAP) : limit;
  for (const day of days) {
    if (fromDateKey && day.dateKey < fromDateKey) continue;
    if (day.dateKey > effectiveToKey) break; // ordered days: nothing later qualifies
    if (!day.hasAnySlots) continue;

    const [y, m, d] = day.dateKey.split("-").map(Number);
    const utcOffset = getPacificAucklandOffset(y, m, d);

    // One candidate per hour: the EARLIEST free start in the hour, so a clean :00
    // is preferred and :15/:30 only surface when :00 is taken - never a run of
    // "3:15, 3:30, 3:45", which is noise to read out.
    const candidates: Array<{ startHour: number; minute: number }> = [];
    for (const win of day.timeWindows) {
      const sub = win.subSlots.find((s) =>
        duration === "long" ? s.availableLong : s.availableShort,
      );
      if (sub) candidates.push({ startHour: win.startHour, minute: sub.minute });
    }

    // Cap per day + spread the picks across the day, so the list offers varied
    // times over several days rather than one day's morning.
    for (const c of spreadEvenly(candidates, PER_DAY_LIMIT)) {
      const startUtc = new Date(Date.UTC(y, m - 1, d, c.startHour - utcOffset, c.minute, 0));
      rawSlots.push({
        dateKey: day.dateKey,
        startIso: startUtc.toISOString(),
        startHour: c.startHour,
        minute: c.minute,
        dayLabel: day.dayLabel,
        timeLabel: timeLabel(c.startHour, c.minute),
      });
      if (rawSlots.length >= cap) break;
    }
    if (rawSlots.length >= cap) break;
  }

  const slots = address
    ? await gateByTravel(rawSlots, address, durationMin, existingBookings, rawEvents, limit)
    : rawSlots.slice(0, limit);

  return NextResponse.json({ slots, duration, durationMin });
}
