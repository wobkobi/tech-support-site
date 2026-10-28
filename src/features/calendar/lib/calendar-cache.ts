// src/features/calendar/lib/calendar-cache.ts
// Background task to fetch and cache Google Calendar events.

import { bookingWindowEnd } from "@/features/booking/lib/booking";
import {
  fetchAllCalendarEventsDetailed,
  getBookingCalendarId,
  type CalendarEvent,
} from "@/features/calendar/lib/google-calendar";
import { calculateTravelMinutes } from "@/features/calendar/lib/travel-time";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NZ_TZ } from "@/shared/lib/timezone-utils";

interface RefreshResult {
  cachedCount: number;
  deletedCount: number;
  /** The calendar read failed outright, so nothing was refreshed. */
  fetchFailed: boolean;
  /** Calendars that failed to read; their travel blocks were left as they were. */
  failedCalendars: number;
}

// Travel block padding rounds up to the next 5-min step after adding the
// settings travel-round buffer (e.g. with +10: 14 > 25, 30 > 40, 60 > 70).
const TRAVEL_ROUND_INCREMENT_MIN = 5;

// Forward window for chaining a travel-back leg into the next event's travel-to.
const RETURN_CHAINING_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;

// A cache row's TTL: twice the 30-minute cron, so one late or missed run doesn't expire the
// table and push booking onto the live API.
export const CALENDAR_CACHE_TTL_MS = 60 * 60 * 1000;

// How long after its fetch a row stays servable once expired; covers missed cron runs.
export const CALENDAR_CACHE_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Rounds raw Distance Matrix minutes up with a buffer for overrun and traffic.
 * @param raw - Raw travel time in minutes from the Distance Matrix API.
 * @param bufferMin - Padding added before rounding (scheduling.travelRoundBufferMin).
 * @returns Blocked minutes to write into TravelBlock.roundedMinutes.
 */
function roundTravelMinutes(raw: number, bufferMin: number): number {
  return Math.ceil((raw + bufferMin) / TRAVEL_ROUND_INCREMENT_MIN) * TRAVEL_ROUND_INCREMENT_MIN;
}

/** Raw + rounded minutes for both legs, as written back onto a TravelBlock. */
export interface RecomputedTravel {
  rawTravelMinutes: number | null;
  roundedMinutes: number | null;
  rawTravelBackMinutes: number | null;
  roundedBackMinutes: number | null;
}

/**
 * Recomputes one TravelBlock's minutes now from its stored endpoints and window, since
 * {@link refreshCalendarCache} never revisits a finished job. Chaining and back suppression
 * are not re-derived.
 * @param blockId - TravelBlock id to recompute.
 * @returns The recomputed raw/rounded minutes, or null when the block is gone.
 */
export async function recomputeTravelBlock(blockId: string): Promise<RecomputedTravel | null> {
  const block = await prisma.travelBlock.findUnique({ where: { id: blockId } });
  if (!block) return null;

  const settings = await getSettings();
  const homeAddress = settings.identity.baseAddress.line || process.env.HOME_ADDRESS || "";
  const bufferMin = settings.scheduling.travelRoundBufferMin;

  const origin = block.customOrigin ?? block.detectedOrigin ?? homeAddress;
  const destination = block.destination;
  const backDestination = block.customTravelBackDestination ?? homeAddress;
  // Match the cron's read-time default (null mode > driving).
  const mode = block.transportMode ?? "driving";

  const empty: RecomputedTravel = {
    rawTravelMinutes: null,
    roundedMinutes: null,
    rawTravelBackMinutes: null,
    roundedBackMinutes: null,
  };

  // No endpoints to price against - store blanks rather than guess.
  if (!origin || !destination) {
    await prisma.travelBlock.update({ where: { id: blockId }, data: empty });
    return empty;
  }

  // Booking events get a wind-down buffer before the return, as in refreshCalendarCache.
  const backBufferMin = settings.scheduling.travelBackDepartureBufferMin;
  const isBookingEvent = block.calendarEmail === getBookingCalendarId();
  const departureForBack = isBookingEvent
    ? new Date(block.eventEndAt.getTime() + backBufferMin * 60_000)
    : block.eventEndAt;

  const [rawThere, rawBack] = await Promise.all([
    calculateTravelMinutes(origin, destination, block.eventStartAt, {
      useArrivalTime: true,
      mode,
    }),
    block.travelBackSuppressed
      ? Promise.resolve(null)
      : calculateTravelMinutes(destination, backDestination, departureForBack, { mode }),
  ]);

  const data: RecomputedTravel = {
    rawTravelMinutes: rawThere,
    roundedMinutes: rawThere !== null ? roundTravelMinutes(rawThere, bufferMin) : null,
    rawTravelBackMinutes: rawBack,
    roundedBackMinutes: rawBack !== null ? roundTravelMinutes(rawBack, bufferMin) : null,
  };
  await prisma.travelBlock.update({ where: { id: blockId }, data });
  return data;
}

/**
 * Origin for an event's travel-to leg: the nearest located event ending within the
 * lookahead before it, else homeAddress. Home too when that nearest event is on
 * `homeFirstCalendarId` (a job after a personal event starts from home).
 * @param allEvents - All calendar events in the current window.
 * @param targetEvent - The event being travelled to.
 * @param homeAddress - Fallback home address.
 * @param lookaheadHours - How far back to look for a preceding event (scheduling.smartOriginLookaheadHours).
 * @param homeFirstCalendarId - Calendar whose events are always left for home first, if any.
 * @returns The best origin address to use.
 */
function findSmartOrigin(
  allEvents: CalendarEvent[],
  targetEvent: CalendarEvent,
  homeAddress: string,
  lookaheadHours: number,
  homeFirstCalendarId?: string,
): string {
  const targetStart = new Date(targetEvent.start).getTime();
  const lookaheadMs = lookaheadHours * 60 * 60 * 1000;

  let best: CalendarEvent | null = null;
  let bestOrigin: string | null = null;
  let bestGap = Infinity;

  for (const e of allEvents) {
    if (e.id === targetEvent.id) continue;
    const loc = e.location ?? e.summary;
    if (!loc) continue;
    const endMs = new Date(e.end).getTime();
    const gap = targetStart - endMs;
    if (gap >= 0 && gap < lookaheadMs && gap < bestGap) {
      best = e;
      bestOrigin = loc;
      bestGap = gap;
    }
  }

  if (homeFirstCalendarId && best?.calendarEmail === homeFirstCalendarId) return homeAddress;
  return bestOrigin ?? homeAddress;
}

/**
 * Forward-looking counterpart to {@link findSmartOrigin}. Returns the soonest
 * upcoming located event within {@link RETURN_CHAINING_LOOKAHEAD_MS} of
 * departure, skipping any calendar in `excludeCalendarEmails`.
 * @param allEvents - All calendar events in the current window.
 * @param currentEvent - The event being left.
 * @param effectiveDeparture - Earliest time the traveller can leave.
 * @param excludeCalendarEmails - Calendars that must never be chained into.
 * @returns The candidate next event with its location and start, or null.
 */
function findNextChainedEvent(
  allEvents: CalendarEvent[],
  currentEvent: CalendarEvent,
  effectiveDeparture: Date,
  excludeCalendarEmails?: Set<string>,
): { event: CalendarEvent; location: string; startAt: Date } | null {
  const departMs = effectiveDeparture.getTime();

  let best: CalendarEvent | null = null;
  let bestLoc: string | null = null;
  let bestStart: Date | null = null;
  let bestGap = Infinity;

  for (const e of allEvents) {
    if (e.id === currentEvent.id) continue;
    if (excludeCalendarEmails?.has(e.calendarEmail)) continue;
    const loc = e.location ?? e.summary;
    if (!loc) continue;
    const startAt = new Date(e.start);
    const gap = startAt.getTime() - departMs;
    if (gap > 0 && gap <= RETURN_CHAINING_LOOKAHEAD_MS && gap < bestGap) {
      best = e;
      bestLoc = loc;
      bestStart = startAt;
      bestGap = gap;
    }
  }

  return best && bestLoc && bestStart
    ? { event: best, location: bestLoc, startAt: bestStart }
    : null;
}

/**
 * Fetches calendar events into the database cache, off the page-load path.
 * @param options - Optional flags.
 * @param options.forceTravel - Recompute travel for every event still to finish, even
 * unchanged ones (the admin Recalculate button). Finished jobs keep their travel.
 * @returns Counts of cached and deleted events, and whether the calendar read failed.
 */
export async function refreshCalendarCache(options?: {
  forceTravel?: boolean;
}): Promise<RefreshResult> {
  const now = new Date();

  // Live settings: the booking horizon + advanced travel-engine buffers.
  const settings = await getSettings();
  // The booking grid runs to the end of its last NZ day, so the cache must too, or late slots
  // that day read as free here and get refused at submit.
  const maxDate = bookingWindowEnd(now, {
    maxAdvanceDays: settings.availability.maxAdvanceDays,
    timeZone: NZ_TZ,
  });
  // Keep recent past jobs so their travel bars stay; also the TravelBlock retention cutoff,
  // since nothing refreshes a block once its event leaves this window.
  const TRAVEL_RETENTION_DAYS = 7;
  const travelWindowStart = new Date(now.getTime() - TRAVEL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const scheduling = settings.scheduling;
  /**
   * Rounds raw travel minutes using the live travel-round buffer.
   * @param raw - Raw travel minutes.
   * @returns Buffered + rounded minutes.
   */
  const roundTravel = (raw: number): number =>
    roundTravelMinutes(raw, scheduling.travelRoundBufferMin);

  // A failed calendar returns nothing, which looks like "all cancelled" unless the stale
  // sweep is told to skip it.
  let rawEvents: CalendarEvent[] = [];
  let failedCalendarIds: string[] = [];
  try {
    ({ events: rawEvents, failedCalendarIds } = await fetchAllCalendarEventsDetailed(
      travelWindowStart,
      maxDate,
    ));
    console.log(`[refreshCalendarCache] Fetched ${rawEvents.length} calendar events`);
    if (failedCalendarIds.length > 0) {
      console.warn(
        `[refreshCalendarCache] ${failedCalendarIds.length} calendar(s) failed to fetch (${failedCalendarIds.join(", ")}); their travel blocks are preserved this run`,
      );
    }
  } catch (error) {
    console.error("[refreshCalendarCache] Failed to fetch calendar events:", error);
    // Don't throw - the stale cache covers the gap when the API fails
    return { cachedCount: 0, deletedCount: 0, fetchFailed: true, failedCalendars: 0 };
  }

  // Delete expired cache entries (older than now)
  const deleteResult = await prisma.calendarEventCache.deleteMany({
    where: {
      expiresAt: { lt: now },
    },
  });

  const cacheExpiry = new Date(now.getTime() + CALENDAR_CACHE_TTL_MS);
  const upsertPromises = rawEvents.map((event) =>
    prisma.calendarEventCache.upsert({
      where: {
        eventId_calendarEmail: {
          eventId: event.id,
          calendarEmail: event.calendarEmail,
        },
      },
      create: {
        eventId: event.id,
        calendarEmail: event.calendarEmail,
        startAt: new Date(event.start),
        endAt: new Date(event.end),
        fetchedAt: now,
        expiresAt: cacheExpiry,
      },
      update: {
        startAt: new Date(event.start),
        endAt: new Date(event.end),
        fetchedAt: now,
        expiresAt: cacheExpiry,
      },
    }),
  );

  await Promise.all(upsertPromises);

  console.log(
    `[refreshCalendarCache] Cached ${upsertPromises.length} events, deleted ${deleteResult.count} expired entries`,
  );

  // Travel blocks. Origin is the base address setting, else the HOME_ADDRESS env.
  const homeAddress = settings.identity.baseAddress.line || process.env.HOME_ADDRESS;
  if (!homeAddress) {
    console.warn("[refreshCalendarCache] No base address set - skipping travel blocks");
    return {
      cachedCount: rawEvents.length,
      deletedCount: deleteResult.count,
      fetchFailed: false,
      failedCalendars: failedCalendarIds.length,
    };
  }

  const bookingCalId = getBookingCalendarId();
  const personalCalId = process.env.PERSONAL_CALENDAR_ID ?? "";
  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    console.log(`[travel] HOME_ADDRESS: ${homeAddress}`);
    console.log(`[travel] BOOKING_CALENDAR_ID: ${bookingCalId}`);
    console.log(`[travel] Total raw events: ${rawEvents.length}`);
    for (const e of rawEvents) {
      console.log(
        `[travel]   event id=${e.id} cal=${e.calendarEmail} start=${e.start} location=${e.location ?? "(none)"}`,
      );
    }
  }

  // All-day blocks aren't trips: "Busy" would read as an address, and as an origin or next stop.
  const timedEvents = rawEvents.filter((e) => !e.allDay);

  // TravelBlock-eligible: any event in the travel window with a location, or a summary
  // (a business name title still resolves).
  const eligibleEvents = timedEvents.filter(
    (e) => (e.location ?? e.summary) && new Date(e.start) > travelWindowStart,
  );

  if (isDev) {
    console.log(
      `[travel] Eligible events (has location/summary, future): ${eligibleEvents.length}`,
    );
    for (const e of eligibleEvents) {
      console.log(
        `[travel]   eligible: "${e.summary}" @ "${e.location ?? e.summary}" (${e.start})`,
      );
    }
  }

  // Load existing TravelBlock records
  const existingBlocks = await prisma.travelBlock.findMany({
    select: {
      id: true,
      sourceEventId: true,
      calendarEmail: true,
      recurringEventId: true,
      summary: true,
      eventStartAt: true,
      eventEndAt: true,
      rawTravelMinutes: true,
      roundedMinutes: true,
      rawTravelBackMinutes: true,
      roundedBackMinutes: true,
      beforeEventId: true,
      afterEventId: true,
      transportMode: true,
      customOrigin: true,
      detectedOrigin: true,
      destination: true,
      customTravelBackDestination: true,
      travelBackSuppressed: true,
      chainedNextEventId: true,
      chainedNextEventStartAt: true,
    },
  });
  const blockByKey = new Map(
    existingBlocks.map((b) => [`${b.sourceEventId}|${b.calendarEmail}`, b]),
  );
  const currentEventKeys = new Set(rawEvents.map((e) => `${e.id}|${e.calendarEmail}`));

  // Per-series transport mode, outliving TravelBlock cleanup so new instances inherit it.
  const seriesPrefs = await prisma.recurringTravelPreference.findMany({
    select: { recurringEventId: true, calendarEmail: true, transportMode: true },
  });
  const seriesModeByKey = new Map(
    seriesPrefs.map((p) => [`${p.recurringEventId}|${p.calendarEmail}`, p.transportMode]),
  );

  if (isDev) {
    console.log(`[travel] Existing TravelBlocks in DB: ${existingBlocks.length}`);
  }

  // Create blocks for new eligible events (or rebuild if times, rounding, or origin changed)
  for (const event of eligibleEvents) {
    const key = `${event.id}|${event.calendarEmail}`;
    const existing = blockByKey.get(key);

    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    // Synthetic cache IDs - never written to Google Calendar
    const beforeId = `travel-before:${event.id}`;
    const afterId = `travel-after:${event.id}`;

    // Booking events get a wind-down buffer before departure on the way back.
    const isBookingEvent = event.calendarEmail === bookingCalId;
    const isPersonalEvent = Boolean(personalCalId) && event.calendarEmail === personalCalId;
    const departureForBack = isBookingEvent
      ? new Date(eventEnd.getTime() + scheduling.travelBackDepartureBufferMin * 60 * 1000)
      : eventEnd;

    // Origin: the preceding event's location within the lookahead, else home. After a
    // personal event you go home before a job, so a job's origin is home then.
    const detectedOrigin = findSmartOrigin(
      timedEvents,
      event,
      homeAddress,
      scheduling.smartOriginLookaheadHours,
      isBookingEvent ? personalCalId : undefined,
    );
    // customOrigin (user override) takes precedence over auto-detection
    const effectiveOrigin = existing?.customOrigin ?? detectedOrigin;

    // Travel-back destination: admin override if set, otherwise home.
    const effectiveBackDestination = existing?.customTravelBackDestination ?? homeAddress;
    const hasCustomBackDestination = existing?.customTravelBackDestination != null;

    // Chaining candidate, stored on the block so later runs see it move. Skipped with a
    // custom back destination.
    const nextEvent = hasCustomBackDestination
      ? null
      : findNextChainedEvent(timedEvents, event, departureForBack, new Set<string>());
    // A personal event never chains into a job: the trip home always stands.
    const chained =
      isPersonalEvent && nextEvent?.event.calendarEmail === bookingCalId ? null : nextEvent;
    const currentChainedId = chained?.event.id ?? null;
    const currentChainedStart = chained?.startAt ?? null;

    // Determine whether a rebuild is needed and whether raw minutes can be reused
    let needsRebuild = true;
    let reuseRawToMinutes: number | null = null;
    let reuseRawBackMinutes: number | null = null;
    // Row to drop once a replacement is ready (deferred delete below).
    let staleBlockId: string | null = null;

    // A forced recalculation skips the "unchanged" shortcut and the stored raw minutes.
    const forced = options?.forceTravel === true && eventEnd.getTime() > now.getTime();

    if (existing) {
      const eventTimesMatch =
        existing.eventStartAt.getTime() === eventStart.getTime() &&
        existing.eventEndAt.getTime() === eventEnd.getTime();

      // Origin changes rebuild; a custom override is stable until the admin changes it.
      const existingEffectiveOrigin =
        existing.customOrigin ?? existing.detectedOrigin ?? homeAddress;
      const originChanged = effectiveOrigin !== existingEffectiveOrigin;

      // A shift in the chaining candidate invalidates the cached suppression decision.
      const chainedIdChanged = existing.chainedNextEventId !== currentChainedId;
      const chainedStartChanged =
        (existing.chainedNextEventStartAt?.getTime() ?? null) !==
        (currentChainedStart?.getTime() ?? null);
      const chainingChanged = chainedIdChanged || chainedStartChanged;

      // A back-destination change nulls back minutes in the admin route, so !backOk rebuilds.

      if (eventTimesMatch && !originChanged && !chainingChanged && !forced) {
        // null means the direction was never successfully calculated - treat as needing retry
        const toOk =
          existing.rawTravelMinutes !== null &&
          roundTravel(existing.rawTravelMinutes) === (existing.roundedMinutes ?? -1);
        // Suppressed travel-back is a steady state - no block exists by design.
        const backOk =
          existing.travelBackSuppressed ||
          (existing.rawTravelBackMinutes !== null &&
            roundTravel(existing.rawTravelBackMinutes) === (existing.roundedBackMinutes ?? -1));

        if (toOk && backOk) {
          if (isDev) console.log(`[travel] Skipping "${event.summary}" - unchanged`);
          needsRebuild = false;
        } else {
          // Rounding formula changed or a direction was never calculated - reuse the stored raw minutes
          reuseRawToMinutes = existing.rawTravelMinutes;
          reuseRawBackMinutes = existing.rawTravelBackMinutes;
          if (isDev)
            console.log(
              `[travel] Rebuilding "${event.summary}" - rounding changed or direction was null`,
            );
        }
      } else {
        if (isDev) {
          const reason = forced
            ? "recalculation requested"
            : originChanged
              ? "origin changed"
              : chainingChanged
                ? "chained next event changed"
                : "event times changed";
          console.log(`[travel] Rebuilding "${event.summary}" - ${reason}`);
        }
      }

      if (needsRebuild) {
        // Remove stale cache entries and TravelBlock record
        const staleIds = [existing.beforeEventId, existing.afterEventId].filter(
          (id): id is string => id !== null,
        );
        if (staleIds.length > 0) {
          try {
            await prisma.calendarEventCache.deleteMany({
              where: { eventId: { in: staleIds } },
            });
          } catch (err) {
            console.error("[refreshCalendarCache] Failed to delete stale cache entries:", err);
          }
        }
        // Deferred: the rebuild bails if both legs are null, and deleting now would lose
        // the operator's overrides.
        staleBlockId = existing.id;
      }
    }

    if (!needsRebuild && existing != null) {
      // Upsert to restore entries after the TTL or a failed run; gated on roundedMinutes,
      // not the stored cache id, so a failed upsert self-heals.
      let backfilledBeforeId: string | null = null;
      let backfilledAfterId: string | null = null;

      if (existing.roundedMinutes != null) {
        const travelToStart = new Date(
          existing.eventStartAt.getTime() - existing.roundedMinutes * 60_000,
        );
        try {
          await prisma.calendarEventCache.upsert({
            where: { eventId_calendarEmail: { eventId: beforeId, calendarEmail: bookingCalId } },
            create: {
              eventId: beforeId,
              calendarEmail: bookingCalId,
              startAt: travelToStart,
              endAt: existing.eventStartAt,
              fetchedAt: now,
              expiresAt: cacheExpiry,
            },
            update: { fetchedAt: now, expiresAt: cacheExpiry },
          });
          if (existing.beforeEventId == null) {
            backfilledBeforeId = beforeId;
            console.log(
              `[refreshCalendarCache] Backfilled missing beforeEventId cache for event ${event.id}`,
            );
          }
        } catch (err) {
          console.error(
            "[refreshCalendarCache] Failed to upsert travel-to cache entry on refresh:",
            err,
          );
        }
      }

      if (existing.roundedBackMinutes != null && !existing.travelBackSuppressed) {
        const travelBackEnd = new Date(
          departureForBack.getTime() + existing.roundedBackMinutes * 60_000,
        );
        try {
          await prisma.calendarEventCache.upsert({
            where: { eventId_calendarEmail: { eventId: afterId, calendarEmail: bookingCalId } },
            create: {
              eventId: afterId,
              calendarEmail: bookingCalId,
              startAt: departureForBack,
              endAt: travelBackEnd,
              fetchedAt: now,
              expiresAt: cacheExpiry,
            },
            update: { fetchedAt: now, expiresAt: cacheExpiry },
          });
          if (existing.afterEventId == null) {
            backfilledAfterId = afterId;
            console.log(
              `[refreshCalendarCache] Backfilled missing afterEventId cache for event ${event.id}`,
            );
          }
        } catch (err) {
          console.error(
            "[refreshCalendarCache] Failed to upsert travel-back cache entry on refresh:",
            err,
          );
        }
      }

      // Backfill display fields, recurringEventId and any null cache ids.
      const currentSummary = event.summary ?? null;
      const currentDestination = event.location ?? event.summary ?? null;
      const currentRecurringId = event.recurringEventId ?? null;
      const updates: {
        summary?: string | null;
        detectedOrigin?: string | null;
        destination?: string | null;
        recurringEventId?: string | null;
        beforeEventId?: string | null;
        afterEventId?: string | null;
      } = {};
      if (existing.summary !== currentSummary) updates.summary = currentSummary;
      if (existing.detectedOrigin !== detectedOrigin) updates.detectedOrigin = detectedOrigin;
      if (existing.destination !== currentDestination) updates.destination = currentDestination;
      if (existing.recurringEventId !== currentRecurringId)
        updates.recurringEventId = currentRecurringId;
      if (backfilledBeforeId !== null) updates.beforeEventId = backfilledBeforeId;
      if (backfilledAfterId !== null) updates.afterEventId = backfilledAfterId;
      if (Object.keys(updates).length > 0) {
        await prisma.travelBlock.update({
          where: { id: existing.id },
          data: updates,
        });
      }
      continue;
    }

    // Destination: the location field, else the title.
    const eventLocation = (event.location ?? event.summary)!;

    // Mode precedence: per-instance override > series preference > default "driving".
    const seriesKey = event.recurringEventId
      ? `${event.recurringEventId}|${event.calendarEmail}`
      : null;
    const seriesMode = seriesKey ? (seriesModeByKey.get(seriesKey) ?? null) : null;
    const travelMode = existing?.transportMode ?? seriesMode ?? "driving";

    // Up to three parallel lookups; home > next only with a chaining candidate, for dwell.
    if (isDev && reuseRawToMinutes === null) {
      console.log(
        `[travel] Calculating travel-to: ${effectiveOrigin} → ${eventLocation} (${travelMode})`,
      );
    }
    if (isDev && reuseRawBackMinutes === null) {
      console.log(
        `[travel] Calculating travel-back: ${eventLocation} → ${effectiveBackDestination} (depart ${departureForBack.toISOString()}, ${travelMode})`,
      );
    }
    if (isDev && chained) {
      console.log(
        `[travel] Evaluating chain to "${chained.event.summary}" @ ${chained.location} (gap ${Math.round((chained.startAt.getTime() - departureForBack.getTime()) / 60_000)} min)`,
      );
    }

    const [rawTravelToMinutes, rawTravelBackMinutes, rawHomeToNextMinutes] = await Promise.all([
      reuseRawToMinutes !== null
        ? Promise.resolve(reuseRawToMinutes)
        : calculateTravelMinutes(effectiveOrigin, eventLocation, eventStart, {
            useArrivalTime: true,
            mode: travelMode,
          }),
      reuseRawBackMinutes !== null
        ? Promise.resolve(reuseRawBackMinutes)
        : calculateTravelMinutes(eventLocation, effectiveBackDestination, departureForBack, {
            mode: travelMode,
          }),
      chained
        ? calculateTravelMinutes(homeAddress, chained.location, chained.startAt, {
            useArrivalTime: true,
            mode: travelMode,
          })
        : Promise.resolve(null),
    ]);

    if (isDev) {
      console.log(`[travel] Travel-to result: ${rawTravelToMinutes ?? "null (skipping)"} min`);
      console.log(`[travel] Travel-back result: ${rawTravelBackMinutes ?? "null (skipping)"} min`);
      if (chained) {
        console.log(
          `[travel] Home → next result: ${rawHomeToNextMinutes ?? "null (skipping)"} min`,
        );
      }
    }

    // Suppress travel-back when home dwell would be under the minimum; the next event's
    // travel-to reserves the gap instead.
    let travelBackSuppressed = false;
    if (
      chained &&
      currentChainedStart &&
      rawTravelBackMinutes !== null &&
      rawHomeToNextMinutes !== null
    ) {
      const gapMin = (currentChainedStart.getTime() - departureForBack.getTime()) / 60_000;
      const dwellMin = gapMin - rawTravelBackMinutes - rawHomeToNextMinutes;
      if (dwellMin < scheduling.minHomeDwellMin) {
        travelBackSuppressed = true;
        if (isDev) {
          console.log(
            `[travel] Suppressing travel-back for "${event.summary}" - dwell ${Math.round(dwellMin)} min < ${scheduling.minHomeDwellMin} min minimum`,
          );
        }
      } else if (isDev) {
        console.log(
          `[travel] Keeping travel-back to home for "${event.summary}" - dwell ${Math.round(dwellMin)} min`,
        );
      }
    }

    // Both legs failed: retry next run; the superseded block (and its overrides) survives.
    if (rawTravelToMinutes === null && rawTravelBackMinutes === null) {
      if (isDev) console.log(`[travel] Both directions null for "${event.summary}" - skipping`);
      continue;
    }

    // Write cache-only blocks
    let storedBeforeId: string | null = null;
    if (rawTravelToMinutes !== null) {
      const roundedTo = roundTravel(rawTravelToMinutes);
      const travelToStart = new Date(eventStart.getTime() - roundedTo * 60 * 1000);
      if (isDev) {
        console.log(
          `[travel] Blocking travel-to (${travelToStart.toISOString()} → ${eventStart.toISOString()}) [${roundedTo} min]`,
        );
      }
      try {
        await prisma.calendarEventCache.upsert({
          where: { eventId_calendarEmail: { eventId: beforeId, calendarEmail: bookingCalId } },
          create: {
            eventId: beforeId,
            calendarEmail: bookingCalId,
            startAt: travelToStart,
            endAt: eventStart,
            fetchedAt: now,
            expiresAt: cacheExpiry,
          },
          update: {
            startAt: travelToStart,
            endAt: eventStart,
            fetchedAt: now,
            expiresAt: cacheExpiry,
          },
        });
        storedBeforeId = beforeId;
      } catch (err) {
        console.error("[refreshCalendarCache] Failed to upsert travel-to cache entry:", err);
      }
    }

    let storedAfterId: string | null = null;
    if (rawTravelBackMinutes !== null && !travelBackSuppressed) {
      const roundedBack = roundTravel(rawTravelBackMinutes);
      const travelBackEnd = new Date(departureForBack.getTime() + roundedBack * 60 * 1000);
      if (isDev) {
        console.log(
          `[travel] Blocking travel-back (${departureForBack.toISOString()} → ${travelBackEnd.toISOString()}) [${roundedBack} min]`,
        );
      }
      try {
        await prisma.calendarEventCache.upsert({
          where: { eventId_calendarEmail: { eventId: afterId, calendarEmail: bookingCalId } },
          create: {
            eventId: afterId,
            calendarEmail: bookingCalId,
            startAt: departureForBack,
            endAt: travelBackEnd,
            fetchedAt: now,
            expiresAt: cacheExpiry,
          },
          update: {
            startAt: departureForBack,
            endAt: travelBackEnd,
            fetchedAt: now,
            expiresAt: cacheExpiry,
          },
        });
        storedAfterId = afterId;
      } catch (err) {
        console.error("[refreshCalendarCache] Failed to upsert travel-back cache entry:", err);
      }
    }

    // Persist the mode, and raw back minutes even when suppressed so un-suppression reuses them.
    const persistedMode = existing?.transportMode ?? seriesMode ?? null;
    try {
      // Retire the superseded row; overrides are read from the in-memory `existing`.
      if (staleBlockId) {
        await prisma.travelBlock.delete({ where: { id: staleBlockId } });
      }
      await prisma.travelBlock.create({
        data: {
          sourceEventId: event.id,
          calendarEmail: event.calendarEmail,
          recurringEventId: event.recurringEventId ?? null,
          summary: event.summary ?? null,
          eventStartAt: eventStart,
          eventEndAt: eventEnd,
          rawTravelMinutes: rawTravelToMinutes,
          roundedMinutes: rawTravelToMinutes !== null ? roundTravel(rawTravelToMinutes) : null,
          rawTravelBackMinutes,
          roundedBackMinutes:
            rawTravelBackMinutes !== null ? roundTravel(rawTravelBackMinutes) : null,
          beforeEventId: storedBeforeId,
          afterEventId: storedAfterId,
          transportMode: persistedMode,
          customOrigin: existing?.customOrigin ?? null,
          detectedOrigin,
          destination: eventLocation,
          customTravelBackDestination: existing?.customTravelBackDestination ?? null,
          travelBackSuppressed,
          chainedNextEventId: currentChainedId,
          chainedNextEventStartAt: currentChainedStart,
        },
      });
      console.log(`[refreshCalendarCache] Created travel blocks for event: ${event.id}`);
    } catch (err) {
      console.error("[refreshCalendarCache] Failed to save TravelBlock:", err);
    }
  }

  // Delete stale blocks whose source event no longer exists
  const failedCalendars = new Set(failedCalendarIds);
  for (const block of existingBlocks) {
    const key = `${block.sourceEventId}|${block.calendarEmail}`;
    if (currentEventKeys.has(key)) continue;

    // A failed calendar's blocks all look stale; skip so a transient 429 can't wipe overrides.
    if (failedCalendars.has(block.calendarEmail)) continue;

    // Finished events' blocks are the schedule's history: keep them (they age out below).
    // Only vanished upcoming events (cancelled or deleted) are cleaned up here.
    if (block.eventEndAt < now) continue;

    const staleIds = [block.beforeEventId, block.afterEventId].filter(
      (id): id is string => id !== null,
    );
    if (staleIds.length > 0) {
      try {
        await prisma.calendarEventCache.deleteMany({
          where: { eventId: { in: staleIds } },
        });
      } catch (err) {
        console.error("[refreshCalendarCache] Failed to delete stale travel cache entries:", err);
      }
    }

    try {
      await prisma.travelBlock.delete({ where: { id: block.id } });
      console.log(`[refreshCalendarCache] Removed stale travel block for: ${block.sourceEventId}`);
    } catch (err) {
      console.error("[refreshCalendarCache] Failed to delete TravelBlock record:", err);
    }
  }

  // Retention sweep: drop blocks past the travel window, plus their cache entries by id so
  // none are orphaned.
  const agedOutBlocks = await prisma.travelBlock.findMany({
    where: { eventEndAt: { lt: travelWindowStart } },
    select: { id: true, beforeEventId: true, afterEventId: true },
  });

  if (agedOutBlocks.length > 0) {
    const agedOutCacheIds = agedOutBlocks
      .flatMap((b) => [b.beforeEventId, b.afterEventId])
      .filter((id): id is string => id !== null);

    if (agedOutCacheIds.length > 0) {
      try {
        await prisma.calendarEventCache.deleteMany({
          where: { eventId: { in: agedOutCacheIds } },
        });
      } catch (err) {
        console.error(
          "[refreshCalendarCache] Failed to delete aged-out travel cache entries:",
          err,
        );
      }
    }

    try {
      const purged = await prisma.travelBlock.deleteMany({
        where: { id: { in: agedOutBlocks.map((b) => b.id) } },
      });
      console.log(
        `[refreshCalendarCache] Purged ${purged.count} travel blocks older than ${TRAVEL_RETENTION_DAYS} days`,
      );
    } catch (err) {
      console.error("[refreshCalendarCache] Failed to purge aged-out TravelBlocks:", err);
    }
  }

  return {
    cachedCount: rawEvents.length,
    deletedCount: deleteResult.count,
    fetchFailed: false,
    failedCalendars: failedCalendarIds.length,
  };
}
