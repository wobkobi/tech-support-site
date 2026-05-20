// src/features/calendar/lib/calendar-cache.ts
/**
 * @file calendar-cache.ts
 * @description Background task to fetch and cache Google Calendar events.
 */

import { prisma } from "@/shared/lib/prisma";
import {
  fetchAllCalendarEvents,
  getBookingCalendarId,
  type CalendarEvent,
} from "@/features/calendar/lib/google-calendar";
import { BOOKING_CONFIG } from "@/features/booking/lib/booking";
import { calculateTravelMinutes, type TransportMode } from "@/features/calendar/lib/travel-time";

interface RefreshResult {
  cachedCount: number;
  deletedCount: number;
}

// Travel block padding for job overrun + traffic. +10 then ceil to next 5-min
// gives ~10 min margin always (e.g. 14 > 25, 30 > 40, 60 > 70).
const TRAVEL_ROUND_INCREMENT_MIN = 5;
const TRAVEL_ROUND_BUFFER_MIN = 10;

// Suppress travel-back when the next event is close enough that dwell at home
// (gap minus current>home minus home>next) falls below MIN_HOME_DWELL_MIN.
const RETURN_CHAINING_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;
const MIN_HOME_DWELL_MIN = 60;

/**
 * Rounds raw Distance Matrix minutes up with a fixed buffer absorbing job
 * overrun and traffic uncertainty.
 * @param raw - Raw travel time in minutes from the Distance Matrix API.
 * @returns Blocked minutes to write into TravelBlock.roundedMinutes.
 */
function roundTravelMinutes(raw: number): number {
  return (
    Math.ceil((raw + TRAVEL_ROUND_BUFFER_MIN) / TRAVEL_ROUND_INCREMENT_MIN) *
    TRAVEL_ROUND_INCREMENT_MIN
  );
}

/**
 * Finds the best origin address for the travel-to leg of a given event.
 * Looks for a preceding event that ends within 4 hours of the target event's
 * start time and has a resolvable location. Falls back to homeAddress.
 * @param allEvents - All calendar events in the current window.
 * @param targetEvent - The event being travelled to.
 * @param homeAddress - Fallback home address.
 * @returns The best origin address to use.
 */
export function findSmartOrigin(
  allEvents: CalendarEvent[],
  targetEvent: CalendarEvent,
  homeAddress: string,
): string {
  const targetStart = new Date(targetEvent.start).getTime();
  const fourHoursMs = 4 * 60 * 60 * 1000;

  let bestOrigin: string | null = null;
  let bestGap = Infinity;

  for (const e of allEvents) {
    if (e.id === targetEvent.id) continue;
    const loc = e.location ?? e.summary;
    if (!loc) continue;
    const endMs = new Date(e.end).getTime();
    const gap = targetStart - endMs;
    if (gap >= 0 && gap < fourHoursMs && gap < bestGap) {
      bestOrigin = loc;
      bestGap = gap;
    }
  }

  return bestOrigin ?? homeAddress;
}

/**
 * Forward-looking counterpart to {@link findSmartOrigin}. Returns the soonest
 * upcoming event with a resolvable location starting within
 * {@link RETURN_CHAINING_LOOKAHEAD_MS} of the given departure, or null.
 * @param allEvents - All calendar events in the current window.
 * @param currentEvent - The event being left.
 * @param effectiveDeparture - Earliest time the traveller can leave.
 * @returns The candidate next event with its location and start, or null.
 */
export function findNextChainedEvent(
  allEvents: CalendarEvent[],
  currentEvent: CalendarEvent,
  effectiveDeparture: Date,
): { event: CalendarEvent; location: string; startAt: Date } | null {
  const departMs = effectiveDeparture.getTime();

  let best: CalendarEvent | null = null;
  let bestLoc: string | null = null;
  let bestStart: Date | null = null;
  let bestGap = Infinity;

  for (const e of allEvents) {
    if (e.id === currentEvent.id) continue;
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
 * Fetches calendar events and stores them in the database cache.
 * This runs periodically in the background to avoid slow API calls during page loads.
 * @returns Object with counts of cached and deleted events
 */
export async function refreshCalendarCache(): Promise<RefreshResult> {
  const now = new Date();
  const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

  // Fetch fresh calendar events
  let rawEvents: CalendarEvent[] = [];
  try {
    rawEvents = await fetchAllCalendarEvents(now, maxDate);
    console.log(`[refreshCalendarCache] Fetched ${rawEvents.length} calendar events`);
  } catch (error) {
    console.error("[refreshCalendarCache] Failed to fetch calendar events:", error);
    // Don't throw - we'll just use stale cache if API fails
    return { cachedCount: 0, deletedCount: 0 };
  }

  // Delete expired cache entries (older than now)
  const deleteResult = await prisma.calendarEventCache.deleteMany({
    where: {
      expiresAt: { lt: now },
    },
  });

  // 30-min TTL gives a 15-min cushion over the 15-min cron cadence - one missed
  // run won't push the booking page onto its slow live-API fallback. Freshness
  // is unaffected since every cron rewrites each entry.
  const cacheExpiry = new Date(now.getTime() + 30 * 60 * 1000);
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
    `[refreshCalendarCache] Cached ${rawEvents.length} events, deleted ${deleteResult.count} expired entries`,
  );

  // Travel Block Management
  const homeAddress = process.env.HOME_ADDRESS;
  if (!homeAddress) {
    console.warn("[refreshCalendarCache] HOME_ADDRESS not set - skipping travel blocks");
    return { cachedCount: rawEvents.length, deletedCount: deleteResult.count };
  }

  const bookingCalId = getBookingCalendarId();
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

  // All future timed events that have a resolvable destination (including booking calendar events).
  // Falls back to event.summary when no dedicated location field is set, so events with a
  // business name as the title (e.g. "Hoyts Ormiston") are still eligible.
  const eligibleEvents = rawEvents.filter(
    (e) => (e.location ?? e.summary) && new Date(e.start) > now,
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

  // Series-level transport mode preferences (one per recurring event series).
  // Survives stale-cleanup of TravelBlock rows, so a freshly-fetched recurring
  // instance inherits the mode an admin previously chose for the series.
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

    // Booking calendar events get a 30-min buffer before departure on the way back
    const isBookingEvent = event.calendarEmail === bookingCalId;
    const departureForBack = isBookingEvent
      ? new Date(eventEnd.getTime() + 30 * 60 * 1000)
      : eventEnd;

    // Detect the best origin: preceding event location within 4 hours, or home
    const detectedOrigin = findSmartOrigin(rawEvents, event, homeAddress);
    // customOrigin (user override) takes precedence over auto-detection
    const effectiveOrigin = existing?.customOrigin ?? detectedOrigin;

    // Travel-back destination: admin override if set, otherwise home.
    const effectiveBackDestination = existing?.customTravelBackDestination ?? homeAddress;
    const hasCustomBackDestination = existing?.customTravelBackDestination != null;

    // Candidate next-event for chaining. Identity + start are stored on the
    // block so a subsequent run can detect if the candidate moved or vanished.
    // Skipped when admin set a custom back destination - the explicit choice wins.
    const chained = hasCustomBackDestination
      ? null
      : findNextChainedEvent(rawEvents, event, departureForBack);
    const currentChainedId = chained?.event.id ?? null;
    const currentChainedStart = chained?.startAt ?? null;

    // Determine whether a rebuild is needed and whether we can reuse raw minutes
    let needsRebuild = true;
    let reuseRawToMinutes: number | null = null;
    let reuseRawBackMinutes: number | null = null;

    if (existing) {
      const eventTimesMatch =
        existing.eventStartAt.getTime() === eventStart.getTime() &&
        existing.eventEndAt.getTime() === eventEnd.getTime();

      // Origin changes trigger a rebuild (only when no custom override, since custom overrides
      // are stable until explicitly changed via the admin API)
      const existingEffectiveOrigin =
        existing.customOrigin ?? existing.detectedOrigin ?? homeAddress;
      const originChanged = effectiveOrigin !== existingEffectiveOrigin;

      // A shift in the chaining candidate invalidates the cached suppression decision.
      const chainedIdChanged = existing.chainedNextEventId !== currentChainedId;
      const chainedStartChanged =
        (existing.chainedNextEventStartAt?.getTime() ?? null) !==
        (currentChainedStart?.getTime() ?? null);
      const chainingChanged = chainedIdChanged || chainedStartChanged;

      // customTravelBackDestination changes propagate via the admin route nulling
      // back-leg minutes; the !backOk path below will then trigger a rebuild.

      if (eventTimesMatch && !originChanged && !chainingChanged) {
        // null means the direction was never successfully calculated - treat as needing retry
        const toOk =
          existing.rawTravelMinutes !== null &&
          roundTravelMinutes(existing.rawTravelMinutes) === (existing.roundedMinutes ?? -1);
        // Suppressed travel-back is a steady state - no block exists by design.
        const backOk =
          existing.travelBackSuppressed ||
          (existing.rawTravelBackMinutes !== null &&
            roundTravelMinutes(existing.rawTravelBackMinutes) ===
              (existing.roundedBackMinutes ?? -1));

        if (toOk && backOk) {
          if (isDev) console.log(`[travel] Skipping "${event.summary}" - unchanged`);
          needsRebuild = false;
        } else {
          // Rounding formula changed or a direction was never calculated - reuse what we have
          reuseRawToMinutes = existing.rawTravelMinutes;
          reuseRawBackMinutes = existing.rawTravelBackMinutes;
          if (isDev)
            console.log(
              `[travel] Rebuilding "${event.summary}" - rounding changed or direction was null`,
            );
        }
      } else {
        if (isDev) {
          const reason = originChanged
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
        try {
          await prisma.travelBlock.delete({ where: { id: existing.id } });
        } catch (err) {
          console.error("[refreshCalendarCache] Failed to delete stale TravelBlock:", err);
        }
      }
    }

    if (!needsRebuild && existing != null) {
      // Upsert cache entries so they are recreated if they expired and were deleted
      if (existing.beforeEventId != null && existing.roundedMinutes != null) {
        const travelToStart = new Date(
          existing.eventStartAt.getTime() - existing.roundedMinutes * 60_000,
        );
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
      }

      if (existing.afterEventId != null && existing.roundedBackMinutes != null) {
        const travelBackEnd = new Date(
          departureForBack.getTime() + existing.roundedBackMinutes * 60_000,
        );
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
      }

      // Backfill display fields and recurringEventId for rows that predate this column.
      const currentSummary = event.summary ?? null;
      const currentDestination = event.location ?? event.summary ?? null;
      const currentRecurringId = event.recurringEventId ?? null;
      const updates: {
        summary?: string | null;
        detectedOrigin?: string | null;
        destination?: string | null;
        recurringEventId?: string | null;
      } = {};
      if (existing.summary !== currentSummary) updates.summary = currentSummary;
      if (existing.detectedOrigin !== detectedOrigin) updates.detectedOrigin = detectedOrigin;
      if (existing.destination !== currentDestination) updates.destination = currentDestination;
      if (existing.recurringEventId !== currentRecurringId)
        updates.recurringEventId = currentRecurringId;
      if (Object.keys(updates).length > 0) {
        await prisma.travelBlock.update({
          where: { id: existing.id },
          data: updates,
        });
      }
      continue;
    }

    // Effective destination: dedicated location field, or fall back to event title
    const eventLocation = (event.location ?? event.summary)!;

    // Mode precedence: per-instance override > series preference > default "transit".
    const seriesKey = event.recurringEventId
      ? `${event.recurringEventId}|${event.calendarEmail}`
      : null;
    const seriesMode = seriesKey ? (seriesModeByKey.get(seriesKey) ?? null) : null;
    const travelMode = (existing?.transportMode ?? seriesMode ?? "transit") as TransportMode;

    // Three Distance Matrix calls in parallel - the third (home>next) only
    // fires when a chaining candidate exists, and feeds the dwell calculation.
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
        console.log(`[travel] Home->next result: ${rawHomeToNextMinutes ?? "null (skipping)"} min`);
      }
    }

    // Suppress travel-back when dwell at home would be under MIN_HOME_DWELL_MIN.
    // The next event's travel-to leg (via findSmartOrigin) reserves the gap instead.
    let travelBackSuppressed = false;
    if (
      chained &&
      currentChainedStart &&
      rawTravelBackMinutes !== null &&
      rawHomeToNextMinutes !== null
    ) {
      const gapMin = (currentChainedStart.getTime() - departureForBack.getTime()) / 60_000;
      const dwellMin = gapMin - rawTravelBackMinutes - rawHomeToNextMinutes;
      if (dwellMin < MIN_HOME_DWELL_MIN) {
        travelBackSuppressed = true;
        if (isDev) {
          console.log(
            `[travel] Suppressing travel-back for "${event.summary}" - dwell ${Math.round(dwellMin)} min < ${MIN_HOME_DWELL_MIN} min minimum`,
          );
        }
      } else if (isDev) {
        console.log(
          `[travel] Keeping travel-back to home for "${event.summary}" - dwell ${Math.round(dwellMin)} min`,
        );
      }
    }

    // Skip entirely if both directions failed (try again next cron run)
    if (rawTravelToMinutes === null && rawTravelBackMinutes === null) {
      if (isDev) console.log(`[travel] Both directions null for "${event.summary}" - skipping`);
      continue;
    }

    // Write cache-only blocks
    let storedBeforeId: string | null = null;
    if (rawTravelToMinutes !== null) {
      const roundedTo = roundTravelMinutes(rawTravelToMinutes);
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
      const roundedBack = roundTravelMinutes(rawTravelBackMinutes);
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

    // Persist the resolved mode (so the admin UI matches reality) and the raw
    // travel-back minutes even when suppressed, so an un-suppression can reuse them.
    const persistedMode = existing?.transportMode ?? seriesMode ?? null;
    try {
      await prisma.travelBlock.create({
        data: {
          sourceEventId: event.id,
          calendarEmail: event.calendarEmail,
          recurringEventId: event.recurringEventId ?? null,
          summary: event.summary ?? null,
          eventStartAt: eventStart,
          eventEndAt: eventEnd,
          rawTravelMinutes: rawTravelToMinutes,
          roundedMinutes:
            rawTravelToMinutes !== null ? roundTravelMinutes(rawTravelToMinutes) : null,
          rawTravelBackMinutes,
          roundedBackMinutes:
            rawTravelBackMinutes !== null ? roundTravelMinutes(rawTravelBackMinutes) : null,
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
  for (const block of existingBlocks) {
    const key = `${block.sourceEventId}|${block.calendarEmail}`;
    if (currentEventKeys.has(key)) continue;

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

  return {
    cachedCount: rawEvents.length,
    deletedCount: deleteResult.count,
  };
}
