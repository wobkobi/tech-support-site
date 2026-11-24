// src/features/booking/lib/booking-travel.server.ts
// Loads the day's located commitments (and, for slots today, the ring around home your phone is
// in) and prices the drives around a new in-person booking, for the booking grid's address check
// and the submit-time re-check. Also works out the customer notice for right now.

import {
  bookingWindowEnd,
  buildAvailableDays,
  CALENDAR_EVENT_PRESENT_FILTER,
  type AvailabilityConfig,
} from "@/features/booking/lib/booking";
import {
  buildTravelTimeline,
  legMinutes,
  locationRing,
  noticeMinutes,
  slotTravelLegs,
  travelLegKey,
  travelVerdict,
  type CurrentSpot,
  type NoticeState,
  type SlotTravelLegs,
  type TravelBlockedSlot,
  type TravelCommitment,
  type TravelLeg,
  type TravelVerdict,
} from "@/features/booking/lib/booking-travel";
import {
  fetchAllCalendarEventsDetailed,
  getBookingCalendarId,
} from "@/features/calendar/lib/google-calendar";
import { distanceM, isUsableLocation } from "@/features/calendar/lib/running-late";
import { homePoint, readPhoneLocation } from "@/features/calendar/lib/running-late.server";
import { calculateTravelMinutes } from "@/features/calendar/lib/travel-time";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import {
  dateKeyParts,
  nzDateKey,
  nzDateParts,
  nzMidnightUtc,
  nzWallClockUtc,
} from "@/shared/lib/timezone-utils";
import "server-only";

/** How long a priced drive is reused across requests (the grid check, then the submit). */
const PRICE_TTL_MS = 15 * 60_000;

/** Cap on remembered drives, so a busy instance can't grow the map without bound. */
const PRICE_CACHE_MAX = 500;

/** Priced drives by {@link travelLegKey}; failed lookups are never stored. */
const priceCache = new Map<string, { minutes: number; at: number }>();

/**
 * New addresses the public grid check prices per NZ day, per instance. Each can cost two lookups
 * per located commitment in the window, so a flood of made-up addresses is capped here; past it
 * the grid stays open and the submit re-check (two lookups at most) still applies.
 */
export const TRAVEL_CHECK_DAILY_ADDRESSES = 60;

/** Addresses the grid check has priced today, for {@link claimTravelCheck}. */
let travelChecksToday: { dayKey: string; addresses: Set<string> } = {
  dayKey: "",
  addresses: new Set(),
};

/**
 * Whether the grid check may price this address today: one already checked today always may, a
 * new one only while today's cap has room.
 * @param address - The customer's address.
 * @param now - Current instant.
 * @returns True when the check can go ahead.
 */
export function claimTravelCheck(address: string, now: Date): boolean {
  const dayKey = nzDateKey(now);
  if (travelChecksToday.dayKey !== dayKey) travelChecksToday = { dayKey, addresses: new Set() };
  const key = address.trim().toLowerCase();
  const { addresses } = travelChecksToday;
  if (addresses.has(key)) return true;
  if (addresses.size >= TRAVEL_CHECK_DAILY_ADDRESSES) return false;
  addresses.add(key);
  return true;
}

/**
 * Drive minutes for a leg: the cached price when fresh, else one Distance Matrix lookup (traffic
 * predicted for the departure). Null when the lookup failed, which callers treat as fitting.
 * @param leg - The drive to price.
 * @returns Minutes, or null when it couldn't be priced.
 */
async function priceLeg(leg: TravelLeg): Promise<number | null> {
  const key = travelLegKey(leg);
  const hit = priceCache.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.minutes;

  const minutes = await calculateTravelMinutes(
    leg.origin,
    leg.destination,
    new Date(leg.departMs),
    {
      mode: "driving",
    },
  );
  if (minutes === null) {
    console.warn(
      `[booking-travel] Couldn't price "${leg.origin}" > "${leg.destination}"; leaving the time open`,
    );
    return null;
  }
  if (priceCache.size >= PRICE_CACHE_MAX) {
    // Map keeps insertion order, so the first key is the oldest.
    const oldest = priceCache.keys().next().value;
    if (oldest !== undefined) priceCache.delete(oldest);
  }
  priceCache.set(key, { minutes, at: Date.now() });
  return minutes;
}

/**
 * Prices every distinct leg once, in parallel.
 * @param legs - Slot legs, possibly sharing drives.
 * @returns Minutes (or null) by {@link travelLegKey}.
 */
async function priceLegs(legs: SlotTravelLegs[]): Promise<Map<string, number | null>> {
  const unique = new Map<string, TravelLeg>();
  for (const l of legs) {
    // The drive from your ring is fixed, never priced.
    if (l.from && l.from.fixedMin === undefined) unique.set(travelLegKey(l.from), l.from);
    if (l.to) unique.set(travelLegKey(l.to), l.to);
  }
  const entries = await Promise.all(
    [...unique].map(async ([key, leg]) => [key, await priceLeg(leg)] as const),
  );
  return new Map(entries);
}

/**
 * The located commitments from the start of today to the end of the booking window: confirmed
 * in-person bookings and calendar events with a location. A calendar that fails to answer only
 * drops its events (the drive check fails open; the slot check itself already read every
 * calendar strictly).
 * @param now - Current instant.
 * @param windowEnd - End of the bookable window.
 * @param config - Live availability settings, for the buffers and the gap after a job.
 * @param exclude - A rescheduled booking to leave out, so it isn't its own neighbour.
 * @param exclude.bookingId - The booking's id.
 * @param exclude.eventId - The booking's calendar event id.
 * @returns Commitments ordered by start.
 */
export async function loadTravelTimeline(
  now: Date,
  windowEnd: Date,
  config: Pick<AvailabilityConfig, "bufferMin" | "bookingBufferAfterMin" | "gapAfterJobMin">,
  exclude: { bookingId?: string; eventId?: string | null } = {},
): Promise<TravelCommitment[]> {
  // From NZ midnight: a job that finished earlier today still sets where you drive from.
  const from = nzMidnightUtc(...nzDateParts(now));
  const [{ identity }, bookings, calendar, travelBlocks] = await Promise.all([
    getSettings(),
    prisma.booking.findMany({
      where: {
        ...(exclude.bookingId ? { id: { not: exclude.bookingId } } : {}),
        status: "confirmed",
        startAt: { lt: windowEnd },
        endAt: { gte: from },
        ...CALENDAR_EVENT_PRESENT_FILTER,
      },
      select: {
        startAt: true,
        endAt: true,
        address: true,
        notes: true,
        meetingType: true,
        calendarEventId: true,
      },
    }),
    fetchAllCalendarEventsDetailed(from, windowEnd).catch((error: unknown) => {
      console.error("[booking-travel] Calendar read failed; checking bookings only:", error);
      return { events: [], failedCalendarIds: [] };
    }),
    prisma.travelBlock.findMany({
      where: { eventStartAt: { lt: windowEnd }, eventEndAt: { gte: from } },
      select: {
        sourceEventId: true,
        roundedBackMinutes: true,
        afterEventId: true,
        travelBackSuppressed: true,
      },
    }),
  ]);

  const backMinByEventId = new Map<string, number>();
  for (const b of travelBlocks) {
    if (b.afterEventId && !b.travelBackSuppressed && (b.roundedBackMinutes ?? 0) > 0) {
      backMinByEventId.set(b.sourceEventId, b.roundedBackMinutes ?? 0);
    }
  }

  // A booking's own calendar event would put the job on the timeline twice.
  const skipEventIds = new Set(
    [...bookings.map((b) => b.calendarEventId), exclude.eventId].filter(Boolean),
  );
  return buildTravelTimeline({
    bookings: bookings.filter((b) => b.meetingType !== "remote"),
    events: calendar.events.filter((e) => !e.allDay && !skipEventIds.has(e.id)),
    personalCalId: process.env.PERSONAL_CALENDAR_ID ?? "",
    homeAddress: identity.baseAddress.line || process.env.HOME_ADDRESS || "",
    backMinByEventId,
    bookingBufferMin: config.bookingBufferAfterMin,
    eventBufferMin: config.bufferMin,
    currentJob: {
      nowMs: now.getTime(),
      gapAfterJobMin: config.gapAfterJobMin,
      bookingCalId: getBookingCalendarId(),
    },
  });
}

/**
 * Where you are now, as the ring around home the OwnTracks location falls in, when it's fresh
 * and precise enough under the Travel alerts limits. The point itself goes no further. Never
 * throws: at home, no usable location or no known home all mean no drive-from-here check.
 * @param now - Current instant.
 * @returns The ring spot, or null.
 */
export async function loadCurrentSpot(now: Date): Promise<CurrentSpot | null> {
  try {
    const [phone, { comms, identity }] = await Promise.all([readPhoneLocation(), getSettings()]);
    const usable = isUsableLocation(
      phone,
      now.getTime(),
      comms.phoneLocationFreshHours * 60 * 60_000,
      comms.phoneLocationMaxAccuracyM,
    );
    if (!usable) return null;
    const homeAddress = identity.baseAddress.line || process.env.HOME_ADDRESS || "";
    const home = await homePoint(homeAddress, identity.baseAddress);
    if (!home) return null;
    const ring = locationRing(distanceM(phone, home), comms.atHomeRadiusM);
    return ring === "home" ? null : { ...ring, atMs: now.getTime() };
  } catch (error) {
    console.error("[booking-travel] Phone location read failed:", error);
    return null;
  }
}

/**
 * Whether you're on a job, out or home right now, for the notice rule. A job is a confirmed
 * booking or a booking-calendar event running now; family and personal events aren't. A calendar
 * that fails to answer only drops its events.
 * @param now - Current instant.
 * @returns The state; "home" when nothing says otherwise.
 */
export async function loadNoticeState(now: Date): Promise<NoticeState> {
  const nowMs = now.getTime();
  const bookingCalId = getBookingCalendarId();
  const [bookings, calendar, here] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: "confirmed",
        startAt: { lte: now },
        endAt: { gt: now },
        ...CALENDAR_EVENT_PRESENT_FILTER,
      },
      select: { endAt: true },
    }),
    fetchAllCalendarEventsDetailed(now, new Date(nowMs + 60_000)).catch((error: unknown) => {
      console.error("[booking-travel] Calendar read failed; judging notice without it:", error);
      return { events: [], failedCalendarIds: [] };
    }),
    loadCurrentSpot(now),
  ]);
  const ends = [
    ...bookings.map((b) => b.endAt.getTime()),
    ...calendar.events
      .filter(
        (e) =>
          e.calendarEmail === bookingCalId &&
          !e.allDay &&
          new Date(e.start).getTime() <= nowMs &&
          new Date(e.end).getTime() > nowMs,
      )
      .map((e) => new Date(e.end).getTime()),
  ];
  if (ends.length > 0) return { kind: "on-job", jobEndMs: Math.max(...ends) };
  if (here) return { kind: "out", driveMin: here.driveMin };
  return { kind: "home" };
}

/**
 * The availability config with the customer notice for right now in place of the fixed minimum
 * notice, for the public booking page, its edit page and their submit routes. Admin booking
 * flows keep the plain setting. Fails safe: an error keeps the configured minimum notice.
 * @param now - Current instant.
 * @param config - Live availability settings.
 * @returns The config, `minHoursNotice` holding this moment's notice in hours.
 */
export async function withCustomerNotice(
  now: Date,
  config: AvailabilityConfig,
): Promise<AvailabilityConfig> {
  try {
    const minutes = noticeMinutes(await loadNoticeState(now), now.getTime(), config);
    return { ...config, minHoursNotice: minutes / 60 };
  } catch (error) {
    console.error("[booking-travel] Notice check failed; using the minimum notice:", error);
    return config;
  }
}

/**
 * Re-checks one chosen slot's drives, for the submit routes. Fails open: an error loading the
 * commitments or pricing a drive lets the booking through (logged), since the slot check proper
 * has already passed.
 * @param address - The customer's address.
 * @param slotStart - Slot start.
 * @param slotEnd - Slot end.
 * @param now - Current instant.
 * @param config - Live availability settings.
 * @param exclude - A rescheduled booking to leave out of its own neighbours.
 * @param exclude.bookingId - The booking's id.
 * @param exclude.eventId - The booking's calendar event id.
 * @returns "ok", or the leg that doesn't fit.
 */
export async function travelVerdictForSlot(
  address: string,
  slotStart: Date,
  slotEnd: Date,
  now: Date,
  config: AvailabilityConfig,
  exclude: { bookingId?: string; eventId?: string | null } = {},
): Promise<TravelVerdict> {
  try {
    const [timeline, here] = await Promise.all([
      loadTravelTimeline(now, bookingWindowEnd(now, config), config, exclude),
      loadCurrentSpot(now),
    ]);
    const legs = slotTravelLegs(slotStart.getTime(), slotEnd.getTime(), address, timeline, here);
    if (!legs.from && !legs.to) return "ok";
    const prices = await priceLegs([legs]);
    return travelVerdict(
      slotStart.getTime(),
      slotEnd.getTime(),
      config.bookingBufferAfterMin,
      legs,
      legMinutes(legs.from, prices),
      legMinutes(legs.to, prices),
    );
  } catch (error) {
    console.error("[booking-travel] Drive check failed; letting the time through:", error);
    return "ok";
  }
}

/**
 * Every grid start, for either job length, that the drives around it rule out. Only days with a
 * located commitment are looked at, and each commitment costs at most two lookups (in from it and
 * on to it), whatever the number of slots.
 * @param address - The customer's address.
 * @param timeline - Commitments from {@link loadTravelTimeline}.
 * @param now - Current instant.
 * @param config - Live availability settings.
 * @param here - Where you are now, from {@link loadCurrentSpot}; adds one lookup for today's slots.
 * @returns The blocked starts.
 */
export async function findTravelBlockedSlots(
  address: string,
  timeline: TravelCommitment[],
  now: Date,
  config: AvailabilityConfig,
  here: CurrentSpot | null = null,
): Promise<TravelBlockedSlot[]> {
  if (timeline.length === 0 && !here) return [];

  // The bare grid (opening hours, notice, morning guards), before bookings or events.
  const { days } = buildAvailableDays([], [], now, config);
  const candidates: Array<{
    dateKey: string;
    startHour: number;
    minute: number;
    startMs: number;
    short: { endMs: number; legs: SlotTravelLegs } | null;
    long: { endMs: number; legs: SlotTravelLegs } | null;
  }> = [];
  for (const day of days) {
    const [y, m, d] = dateKeyParts(day.dateKey);
    for (const w of day.timeWindows) {
      for (const s of w.subSlots) {
        if (!s.availableShort && !s.availableLong) continue;
        const startMs = nzWallClockUtc(y, m, d, w.startHour, s.minute).getTime();
        /**
         * The legs for one job length at this start.
         * @param available - Whether that length can start here at all.
         * @param mins - The length in minutes.
         * @returns The end and legs, or null when there's nothing to check.
         */
        const forLength = (
          available: boolean,
          mins: number,
        ): { endMs: number; legs: SlotTravelLegs } | null => {
          if (!available) return null;
          const endMs = startMs + mins * 60_000;
          const legs = slotTravelLegs(startMs, endMs, address, timeline, here);
          return legs.from || legs.to ? { endMs, legs } : null;
        };
        const short = forLength(s.availableShort, config.durations.short);
        const long = forLength(s.availableLong, config.durations.long);
        if (short || long) {
          candidates.push({
            dateKey: day.dateKey,
            startHour: w.startHour,
            minute: s.minute,
            startMs,
            short,
            long,
          });
        }
      }
    }
  }
  if (candidates.length === 0) return [];

  const prices = await priceLegs(
    candidates.flatMap((c) => [c.short?.legs, c.long?.legs].filter((l) => l !== undefined)),
  );
  /**
   * Whether one job length at a start is ruled out.
   * @param startMs - Slot start.
   * @param entry - The length's end and legs, or null when unchecked.
   * @returns True when a drive doesn't fit.
   */
  const blocks = (
    startMs: number,
    entry: { endMs: number; legs: SlotTravelLegs } | null,
  ): boolean => {
    if (!entry) return false;
    const { legs } = entry;
    return (
      travelVerdict(
        startMs,
        entry.endMs,
        config.bookingBufferAfterMin,
        legs,
        legMinutes(legs.from, prices),
        legMinutes(legs.to, prices),
      ) !== "ok"
    );
  };

  const blocked: TravelBlockedSlot[] = [];
  for (const c of candidates) {
    const short = blocks(c.startMs, c.short);
    const long = blocks(c.startMs, c.long);
    if (short || long) {
      blocked.push({ dateKey: c.dateKey, startHour: c.startHour, minute: c.minute, short, long });
    }
  }
  return blocked;
}
