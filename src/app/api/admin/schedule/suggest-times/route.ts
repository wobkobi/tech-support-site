// src/app/api/admin/schedule/suggest-times/route.ts
// Admin "find open times": the next bookable slots via the public availability engine, with
// TravelBlocks as occupied padding.

import { spreadEvenly } from "@/features/admin/lib/spread-evenly";
import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import { buildAvailableDays, type ExistingBooking } from "@/features/booking/lib/booking";
import { fetchAllCalendarEventsStrict } from "@/features/calendar/lib/google-calendar";
import { calculateTravelMinutes } from "@/features/calendar/lib/travel-time";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import {
  addDaysToDateKey,
  dateKeyParts,
  nzMidnightUtc,
  nzWallClockUtc,
} from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

// Default window when no range is given, bounding the Google fetch.
const HORIZON_DAYS = 28;
// Furthest a requested range is searched: a year, the most the settings let bookings open.
const MAX_RANGE_DAYS = 365;
// Days with openings returned: a week's worth.
const MAX_DAYS = 7;
// Times offered per day, spread across it.
const PER_DAY_LIMIT = 5;
// A slot finishing past the end-by hour still counts as preferred this soon after a booking
// ends that day (you're already out); 2h covers the booking's buffer plus its travel back.
const FOLLOW_ON_GAP_MS = 120 * 60_000;
// Without an address, the drive out to a job after getting home from a personal event: a
// typical trip, since the job's own drive can't be priced.
const HOME_TO_JOB_ALLOWANCE_MIN = 20;

interface SuggestPayload {
  /** Job length to fit; maps to config.durations.short/long. */
  duration?: "short" | "long";
  /**
   * Inclusive NZ date range (YYYY-MM-DD), e.g. the week on screen; searched in full even past
   * the public booking window. Without one: today to the booking window, at most 28 days.
   */
  fromDateKey?: string;
  toDateKey?: string;
  /**
   * New customer's address; when set, only slots that fit the real drive are returned.
   */
  address?: string;
}

interface SuggestedSlot {
  /** UTC ISO of the slot start, ready to hand to ManualBookingModal. */
  startIso: string;
  /** "9:00am". */
  timeLabel: string;
  /** Drive from the preceding job, set only when gated by address (e.g. "18 min drive"). */
  driveNote?: string;
}

interface SuggestedDay {
  dateKey: string;
  /** "Wed 16 Jul". */
  dayLabel: string;
  slots: SuggestedSlot[];
}

interface LocatedCommitment {
  startMs: number;
  /** When you can set off for the next job: once home, after a personal event. */
  endMs: number;
  /** Where it is, for the drive on to it. */
  location: string;
  /** Where the drive to the next job starts: home, after a personal event. */
  leaveFrom: string;
}

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
 * Whole days from one NZ date key to another; negative when `to` is earlier.
 * @param from - Start date key (YYYY-MM-DD).
 * @param to - End date key (YYYY-MM-DD).
 * @returns Day difference.
 */
function daysBetweenKeys(from: string, to: string): number {
  const [fy, fm, fd] = dateKeyParts(from);
  const [ty, tm, td] = dateKeyParts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * A booking's job address: the dedicated field, else the notes' "Address:" line.
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
 * Located commitments for the drive check: bookings and events with an address. A personal
 * event is left for home first, so the drive to a job after it starts from home once you're
 * back (its travel-home block).
 * @param bookings - Upcoming bookings, for their job addresses.
 * @param events - Calendar events, for their locations and calendars.
 * @param personalCalId - The personal calendar's id ("" when not configured).
 * @param homeAddress - Home, where the drive after a personal event starts.
 * @param backMinByEventId - Travel-home minutes per event, from its TravelBlock.
 * @returns Commitments ordered by start.
 */
function buildTimeline(
  bookings: Array<{ startAt: Date; endAt: Date; address: string | null; notes: string | null }>,
  events: Array<{
    id: string;
    start: string;
    end: string;
    location?: string;
    calendarEmail: string;
  }>,
  personalCalId: string,
  homeAddress: string,
  backMinByEventId: Map<string, number>,
): LocatedCommitment[] {
  const timeline: LocatedCommitment[] = [];
  for (const b of bookings) {
    const loc = bookingLocation(b);
    if (loc) {
      timeline.push({
        startMs: b.startAt.getTime(),
        endMs: b.endAt.getTime(),
        location: loc,
        leaveFrom: loc,
      });
    }
  }
  for (const e of events) {
    if (!e.location) continue;
    const endMs = new Date(e.end).getTime();
    const homeFirst = Boolean(personalCalId && homeAddress) && e.calendarEmail === personalCalId;
    timeline.push({
      startMs: new Date(e.start).getTime(),
      endMs: homeFirst ? endMs + (backMinByEventId.get(e.id) ?? 0) * 60_000 : endMs,
      location: e.location,
      leaveFrom: homeFirst ? homeAddress : e.location,
    });
  }
  return timeline.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Keeps slots that fit the real drive from the previous commitment and on to the next,
 * annotating survivors with the incoming drive. Only commitments within `windowMs` of the
 * slot count (further off, you'd be setting out from home), which also bounds the
 * Distance Matrix calls; `memo` shares identical lookups across a request.
 * @param slots - Candidate slots.
 * @param address - The new job's address.
 * @param durationMin - Job length in minutes, for the slot's end time.
 * @param timeline - Located commitments from {@link buildTimeline}.
 * @param windowMs - How far either side of the slot a commitment still counts.
 * @param memo - Lookups already in flight or done this request, by route and departure.
 * @returns Slots that fit the drive, annotated.
 */
async function gateByTravel(
  slots: SuggestedSlot[],
  address: string,
  durationMin: number,
  timeline: LocatedCommitment[],
  windowMs: number,
  memo: Map<string, Promise<number | null>>,
): Promise<SuggestedSlot[]> {
  /**
   * Driving minutes for one leg, shared with any identical lookup this request.
   * @param from - Origin address.
   * @param to - Destination address.
   * @param departMs - Departure time (ms).
   * @returns Minutes, or null when the lookup failed.
   */
  const drive = (from: string, to: string, departMs: number): Promise<number | null> => {
    const key = `${from}|${to}|${departMs}`;
    let p = memo.get(key);
    if (!p) {
      p = calculateTravelMinutes(from, to, new Date(departMs), { mode: "driving" });
      memo.set(key, p);
    }
    return p;
  };

  const gated = await Promise.all(
    slots.map(async (slot): Promise<SuggestedSlot | null> => {
      const startMs = new Date(slot.startIso).getTime();
      const endMs = startMs + durationMin * 60_000;
      // Latest commitment finished before the slot, and the first starting after it.
      let prev: LocatedCommitment | undefined;
      let next: LocatedCommitment | undefined;
      for (const c of timeline) {
        if (c.endMs <= startMs && startMs - c.endMs <= windowMs) {
          if (!prev || c.endMs > prev.endMs) prev = c;
        } else if (c.startMs >= endMs && c.startMs - endMs <= windowMs && !next) next = c;
      }
      const [driveIn, driveOut] = await Promise.all([
        prev ? drive(prev.leaveFrom, address, prev.endMs) : Promise.resolve(null),
        next ? drive(address, next.location, endMs) : Promise.resolve(null),
      ]);
      // A null result = API misconfig/failure; don't drop the slot on that alone.
      if (prev && driveIn != null && prev.endMs + driveIn * 60_000 > startMs) return null;
      if (next && driveOut != null && endMs + driveOut * 60_000 > next.startMs) return null;
      if (prev && driveIn != null) return { ...slot, driveNote: `${driveIn} min drive` };
      return slot;
    }),
  );
  return gated.filter((s): s is SuggestedSlot => s !== null);
}

/**
 * POST /api/admin/schedule/suggest-times
 * Body: { duration, fromDateKey?, toDateKey?, address? }. Requires admin auth.
 * @param request - Incoming request (admin-authenticated).
 * @returns JSON `{ days, duration, durationMin }` or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json().catch(() => null)) as SuggestPayload | null;
  const duration = body?.duration === "long" ? "long" : "short";
  const fromDateKey =
    body?.fromDateKey && DATE_KEY_RE.test(body.fromDateKey) ? body.fromDateKey : null;
  const toDateKey = body?.toDateKey && DATE_KEY_RE.test(body.toDateKey) ? body.toDateKey : null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";

  const now = new Date();
  // Ignore the public accepting-bookings switch; the operator books even while paused.
  const [{ config }, { scheduling, identity }] = await Promise.all([
    getAvailabilityConfig(),
    getSettings(),
  ]);
  const durationMin = duration === "long" ? config.durations.long : config.durations.short;

  const todayNzKey = now.toLocaleDateString("en-CA", { timeZone: config.timeZone });
  const searchDays = toDateKey
    ? Math.min(Math.max(daysBetweenKeys(todayNzKey, toDateKey), 0), MAX_RANGE_DAYS)
    : Math.min(config.maxAdvanceDays, HORIZON_DAYS);
  const maxDate = new Date(now.getTime() + (searchDays + 1) * 24 * 60 * 60 * 1000);
  // Calendars are read from the range's first day; days before it are skipped below anyway.
  const fetchFrom =
    fromDateKey && fromDateKey > todayNzKey ? nzMidnightUtc(...dateKeyParts(fromDateKey)) : now;
  const horizonKey = addDaysToDateKey(todayNzKey, searchDays);
  // Never suggest past the fetched window, where days would look falsely free.
  const effectiveToKey = toDateKey && toDateKey < horizonKey ? toDateKey : horizonKey;

  // Existing commitments: upcoming bookings, calendar events and travel padding.
  const [existingBookings, rawEvents, travelBlocks] = await Promise.all([
    prisma.booking.findMany({
      where: { status: "confirmed", endAt: { gte: now } },
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
    // A calendar that did not answer would read as free time, so suggest nothing instead.
    fetchAllCalendarEventsStrict(fetchFrom, maxDate).catch((err: unknown) => {
      console.error("[suggest-times] Calendar read failed:", err);
      return null;
    }),
    prisma.travelBlock.findMany({
      where: { eventStartAt: { lt: maxDate }, eventEndAt: { gte: now } },
      select: {
        id: true,
        sourceEventId: true,
        roundedMinutes: true,
        roundedBackMinutes: true,
        beforeEventId: true,
        afterEventId: true,
        travelBackSuppressed: true,
      },
    }),
  ]);

  if (!rawEvents) {
    return errorResponse(
      "Couldn't read your calendars, so there are no times to suggest right now. Try again in a minute.",
      503,
    );
  }

  const existingForSlots: ExistingBooking[] = existingBookings.map((b) => ({
    id: b.id,
    startAt: b.startAt,
    endAt: b.endAt,
    bufferBeforeMin: b.bufferBeforeMin,
    bufferAfterMin: b.bufferAfterMin,
  }));

  const calendarEvents = rawEvents.map((e) => ({ id: e.id, start: e.start, end: e.end }));

  // Travel as synthetic occupied blocks; isSlotFree adds no buffer to `travel-*:` ids. Same
  // guards as the schedule grid: a block whose event is gone is skipped, and each leg hangs off
  // the event's current times, since a stored block keeps the times from its last sync.
  const rawEventById = new Map(rawEvents.map((e) => [e.id, e]));
  const backMinByEventId = new Map<string, number>();
  const personalCalId = process.env.PERSONAL_CALENDAR_ID ?? "";
  for (const b of travelBlocks) {
    const src = rawEventById.get(b.sourceEventId);
    if (!src) continue;
    // You go home before a job after a personal event. With an address the drive check prices
    // that trip out; without one, its trip home also holds a typical drive out.
    const outMin =
      !address && personalCalId && src.calendarEmail === personalCalId
        ? HOME_TO_JOB_ALLOWANCE_MIN
        : 0;
    const evStartMs = new Date(src.start).getTime();
    const evEndMs = new Date(src.end).getTime();
    if (b.beforeEventId && b.roundedMinutes != null && b.roundedMinutes > 0) {
      calendarEvents.push({
        id: `travel-before:${b.id}`,
        start: new Date(evStartMs - b.roundedMinutes * 60_000).toISOString(),
        end: new Date(evStartMs).toISOString(),
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
        start: new Date(evEndMs).toISOString(),
        end: new Date(evEndMs + (b.roundedBackMinutes + outMin) * 60_000).toISOString(),
      });
      backMinByEventId.set(b.sourceEventId, b.roundedBackMinutes);
    }
  }

  // Build every day up to the horizon, past the public booking window when a range asks for it.
  const { days } = buildAvailableDays(existingForSlots, calendarEvents, now, {
    ...config,
    maxAdvanceDays: searchDays + 1,
  });

  // Two pools per day, up to MAX_DAYS days: times finishing by the end-by hour (or following
  // on from a booking) are picked first; later ones only fill a day that has too few.
  const candidateDays: Array<{
    dateKey: string;
    dayLabel: string;
    preferred: SuggestedSlot[];
    late: SuggestedSlot[];
  }> = [];
  for (const day of days) {
    if (fromDateKey && day.dateKey < fromDateKey) continue;
    if (day.dateKey > effectiveToKey) break; // ordered days: nothing later qualifies
    if (!day.hasAnySlots) continue;
    if (candidateDays.length >= MAX_DAYS) break;

    const [y, m, d] = dateKeyParts(day.dateKey);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const endByMins =
      (dow === 0 || dow === 6 ? scheduling.suggestWeekendEndHour : scheduling.suggestEndHour) * 60;
    const bookingEndsMs = existingBookings
      .filter(
        (b) => b.startAt.toLocaleDateString("en-CA", { timeZone: config.timeZone }) === day.dateKey,
      )
      .map((b) => b.endAt.getTime());
    /**
     * Builds the response slot for a start on this day.
     * @param c - Start hour and minute.
     * @param c.startHour - NZ hour of the start.
     * @param c.minute - Minute past the hour.
     * @returns The suggested slot.
     */
    const toSlot = (c: { startHour: number; minute: number }): SuggestedSlot => ({
      startIso: nzWallClockUtc(y, m, d, c.startHour, c.minute).toISOString(),
      timeLabel: timeLabel(c.startHour, c.minute),
    });

    // One candidate per hour, the earliest free start, so :00 is preferred.
    const preferred: SuggestedSlot[] = [];
    const late: SuggestedSlot[] = [];
    for (const win of day.timeWindows) {
      const sub = win.subSlots.find((s) =>
        duration === "long" ? s.availableLong : s.availableShort,
      );
      if (!sub) continue;
      const c = { startHour: win.startHour, minute: sub.minute };
      const startMs = nzWallClockUtc(y, m, d, c.startHour, c.minute).getTime();
      const followsOn = bookingEndsMs.some(
        (end) => end <= startMs && startMs - end <= FOLLOW_ON_GAP_MS,
      );
      if (c.startHour * 60 + c.minute + durationMin <= endByMins || followsOn) {
        preferred.push(toSlot(c));
      } else late.push(toSlot(c));
    }
    candidateDays.push({ dateKey: day.dateKey, dayLabel: day.dayLabel, preferred, late });
  }

  const timeline = address
    ? buildTimeline(
        existingBookings,
        rawEvents,
        personalCalId,
        identity.baseAddress.line || process.env.HOME_ADDRESS || "",
        backMinByEventId,
      )
    : [];
  const windowMs = scheduling.smartOriginLookaheadHours * 60 * 60 * 1000;
  const memo = new Map<string, Promise<number | null>>();

  // Gate every candidate first, so a time lost to the drive is replaced from the rest. Then up
  // to PER_DAY_LIMIT per day, spread across it, in time order.
  const suggestedDays = await Promise.all(
    candidateDays.map(async (day): Promise<SuggestedDay | null> => {
      const [preferred, late] = address
        ? await Promise.all([
            gateByTravel(day.preferred, address, durationMin, timeline, windowMs, memo),
            gateByTravel(day.late, address, durationMin, timeline, windowMs, memo),
          ])
        : [day.preferred, day.late];
      const slots = [...spreadEvenly(preferred, PER_DAY_LIMIT), ...late]
        .slice(0, PER_DAY_LIMIT)
        .toSorted((a, b) => a.startIso.localeCompare(b.startIso));
      return slots.length > 0 ? { dateKey: day.dateKey, dayLabel: day.dayLabel, slots } : null;
    }),
  );

  return NextResponse.json({
    days: suggestedDays.filter((d): d is SuggestedDay => d !== null),
    duration,
    durationMin,
  });
}
