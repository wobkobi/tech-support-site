// src/features/calendar/lib/calendar-cache.ts
/**
 * @description Background task to fetch and cache Google Calendar events.
 */

import {
  fetchAllCalendarEvents,
  getBookingCalendarId,
  type CalendarEvent,
} from "@/features/calendar/lib/google-calendar";
import { calculateTravelMinutes, type TransportMode } from "@/features/calendar/lib/travel-time";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";

interface RefreshResult {
  cachedCount: number;
  deletedCount: number;
}

// Travel block padding rounds up to the next 5-min step after adding the
// settings travel-round buffer (e.g. with +10: 14 > 25, 30 > 40, 60 > 70).
const TRAVEL_ROUND_INCREMENT_MIN = 5;

// Forward window for chaining a travel-back leg into the next event's travel-to.
const RETURN_CHAINING_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;

/**
 * Rounds raw Distance Matrix minutes up with a buffer absorbing job overrun
 * and traffic uncertainty.
 * @param raw - Raw travel time in minutes from the Distance Matrix API.
 * @param bufferMin - Padding added before rounding (scheduling.travelRoundBufferMin).
 * @returns Blocked minutes to write into TravelBlock.roundedMinutes.
 */
function roundTravelMinutes(raw: number, bufferMin: number): number {
  return Math.ceil((raw + bufferMin) / TRAVEL_ROUND_INCREMENT_MIN) * TRAVEL_ROUND_INCREMENT_MIN;
}

/**
 * Finds the best origin address for the travel-to leg of a given event.
 * Looks for a preceding event that ends within the lookahead window of the
 * target event's start time and has a resolvable location. Falls back to
 * homeAddress.
 * @param allEvents - All calendar events in the current window.
 * @param targetEvent - The event being travelled to.
 * @param homeAddress - Fallback home address.
 * @param lookaheadHours - How far back to look for a preceding event (scheduling.smartOriginLookaheadHours).
 * @returns The best origin address to use.
 */
export function findSmartOrigin(
  allEvents: CalendarEvent[],
  targetEvent: CalendarEvent,
  homeAddress: string,
  lookaheadHours: number,
): string {
  const targetStart = new Date(targetEvent.start).getTime();
  const lookaheadMs = lookaheadHours * 60 * 60 * 1000;

  let bestOrigin: string | null = null;
  let bestGap = Infinity;

  for (const e of allEvents) {
    if (e.id === targetEvent.id) continue;
    const loc = e.location ?? e.summary;
    if (!loc) continue;
    const endMs = new Date(e.end).getTime();
    const gap = targetStart - endMs;
    if (gap >= 0 && gap < lookaheadMs && gap < bestGap) {
      bestOrigin = loc;
      bestGap = gap;
    }
  }

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
export function findNextChainedEvent(
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
 * Fetches calendar events and stores them in the database cache.
 * This runs periodically in the background to avoid slow API calls during page loads.
 * @returns Object with counts of cached and deleted events
 */
export async function refreshCalendarCache(): Promise<RefreshResult> {
  const now = new Date();

  // Live settings: the booking horizon + advanced travel-engine buffers.
  const settings = await getSettings();
  const maxDate = new Date(
    now.getTime() + settings.availability.maxAdvanceDays * 24 * 60 * 60 * 1000,
  );
  const scheduling = settings.scheduling;
  /**
   * Rounds raw travel minutes using the live travel-round buffer.
   * @param raw - Raw travel minutes.
   * @returns Buffered + rounded minutes.
   */
  const roundTravel = (raw: number): number =>
    roundTravelMinutes(raw, scheduling.travelRoundBufferMin);

  // Fetch fresh calendar events
  let rawEvents: CalendarEvent[] = [];
  try {
    rawEvents = await fetchAllCalendarEvents(now, maxDate);
    console.log(`[refreshCalendarCache] Fetched ${rawEvents.length} calendar events`);
  } catch (error) {
    console.error("[refreshCalendarCache] Failed to fetch calendar events:", error);
    // Don't throw - the stale cache covers the gap when the API fails
    return { cachedCount: 0, deletedCount: 0 };
  }

  // Delete expired cache entries (older than now)
  const deleteResult = await prisma.calendarEventCache.deleteMany({
    where: {
      expiresAt: { lt: now },
    },
  });

  // Load admin-marked "ignored" TravelBlocks to know which Car events to
  // skip when populating the calendar cache + travel blocks. An ignored event
  // means "I have access to the car that day" - the booking page should not
  // treat it as a no-car window and no travel-to-home block should fire.
  const ignoredRows = await prisma.travelBlock.findMany({
    where: { ignored: true },
    select: { sourceEventId: true, calendarEmail: true },
  });
  const ignoredKeys = new Set(ignoredRows.map((r) => `${r.sourceEventId}|${r.calendarEmail}`));

  // Delete any lingering cache entries for events the admin has since flagged
  // ignored. This is what makes the toggle take effect immediately (next cron
  // pass) without waiting for the 30-min TTL.
  if (ignoredKeys.size > 0) {
    try {
      await prisma.calendarEventCache.deleteMany({
        where: {
          OR: ignoredRows.map((r) => ({
            eventId: r.sourceEventId,
            calendarEmail: r.calendarEmail,
          })),
        },
      });
    } catch (err) {
      console.error("[refreshCalendarCache] Failed to purge ignored cache entries:", err);
    }
  }

  // 30-min TTL gives a 15-min cushion over the 15-min cron cadence - one missed
  // run won't push the booking page onto its slow live-API fallback. Freshness
  // is unaffected since every cron rewrites each entry.
  const cacheExpiry = new Date(now.getTime() + 30 * 60 * 1000);
  const upsertPromises = rawEvents
    .filter((event) => !ignoredKeys.has(`${event.id}|${event.calendarEmail}`))
    .map((event) =>
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
    `[refreshCalendarCache] Cached ${upsertPromises.length} events (${ignoredKeys.size} ignored), deleted ${deleteResult.count} expired entries`,
  );

  // Travel Block Management. Origin is the unified base address (settings),
  // falling back to the HOME_ADDRESS env until that var is retired.
  const homeAddress = settings.identity.baseAddress.line || process.env.HOME_ADDRESS;
  if (!homeAddress) {
    console.warn("[refreshCalendarCache] No base address set - skipping travel blocks");
    return { cachedCount: rawEvents.length, deletedCount: deleteResult.count };
  }

  const bookingCalId = getBookingCalendarId();
  // CAR_CALENDAR_ID is the canonical name (renamed from WORK_CALENDAR_ID).
  // Fall back to the old name so prod stays alive until the env var is updated.
  const carCalId = process.env.CAR_CALENDAR_ID ?? process.env.WORK_CALENDAR_ID ?? "";
  const isDev = process.env.NODE_ENV === "development";

  // Car-calendar entries are the dumb case: always home > event location >
  // home, no smart-origin lookup, no chaining. Car events are also kept out
  // of OTHER events' smart-origin and chaining candidates so they don't
  // pollute those decisions, but still appear in calendarEventCache so
  // booking is blocked during the event itself.
  const travelRelevantEvents = carCalId
    ? rawEvents.filter((e) => e.calendarEmail !== carCalId)
    : rawEvents;

  if (isDev) {
    console.log(`[travel] HOME_ADDRESS: ${homeAddress}`);
    console.log(`[travel] BOOKING_CALENDAR_ID: ${bookingCalId}`);
    console.log(`[travel] Total raw events: ${rawEvents.length}`);
    console.log(
      `[travel] Events available as smart-origin / chaining candidates: ${travelRelevantEvents.length}`,
    );
    for (const e of rawEvents) {
      console.log(
        `[travel]   event id=${e.id} cal=${e.calendarEmail} start=${e.start} location=${e.location ?? "(none)"}`,
      );
    }
  }

  // Eligible-for-TravelBlock: every future event from any calendar that has a
  // resolvable destination. Falls back to event.summary when no dedicated
  // location field is set (e.g. business name as the title).
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
  // Stale-cleanup operates on the full event set - Work events have their own
  // TravelBlocks (travel-to-home before the event), so they are kept when
  // present and cleaned up only when the source event disappears.
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

    // Admin-flagged "I have the car that day" override: leave the TravelBlock
    // as-is (the admin's flag is the source of truth) and skip every Distance
    // Matrix / cache write below. The cache entry for the event itself was
    // already purged above, so the booking page is unblocked.
    if (ignoredKeys.has(key)) {
      if (isDev) console.log(`[travel] Skipping ignored event "${event.summary}"`);
      continue;
    }

    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    // Car-cal events are dumb: always home > venue > home. No smart-origin,
    // no chaining, no overrides.
    const isCarEvent = carCalId !== "" && event.calendarEmail === carCalId;

    // Synthetic cache IDs - never written to Google Calendar
    const beforeId = `travel-before:${event.id}`;
    const afterId = `travel-after:${event.id}`;

    // Booking events get a wind-down buffer before departure on the way back.
    const isBookingEvent = event.calendarEmail === bookingCalId;
    const departureForBack = isBookingEvent
      ? new Date(eventEnd.getTime() + scheduling.travelBackDepartureBufferMin * 60 * 1000)
      : eventEnd;

    // Detect the best origin: preceding event location within 4 hours, or home.
    // For Car events the origin is forced to home - no smart-origin lookup.
    // Car events are also filtered out of travelRelevantEvents so they don't
    // pollute other events' smart-origin or chain candidate searches.
    const detectedOrigin = isCarEvent
      ? homeAddress
      : findSmartOrigin(
          travelRelevantEvents,
          event,
          homeAddress,
          scheduling.smartOriginLookaheadHours,
        );
    // customOrigin (user override) takes precedence over auto-detection
    const effectiveOrigin = existing?.customOrigin ?? detectedOrigin;

    // Travel-back destination: admin override if set, otherwise home.
    const effectiveBackDestination = existing?.customTravelBackDestination ?? homeAddress;
    const hasCustomBackDestination = existing?.customTravelBackDestination != null;

    // Candidate next-event for chaining. Identity + start are stored on the
    // block so a subsequent run can detect if the candidate moved or vanished.
    // Skipped when admin set a custom back destination - the explicit choice
    // wins - or when the current event is a Work event (Work blocks don't have
    // a return trip to chain anywhere from).
    const chained =
      hasCustomBackDestination || isCarEvent
        ? null
        : findNextChainedEvent(travelRelevantEvents, event, departureForBack, new Set<string>());
    const currentChainedId = chained?.event.id ?? null;
    const currentChainedStart = chained?.startAt ?? null;

    // Determine whether a rebuild is needed and whether raw minutes can be reused
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
      // Upsert cache entries so they are recreated if they expired (30-min TTL)
      // OR if an earlier run failed to write them and left beforeEventId/
      // afterEventId null on the TravelBlock row. The gate is on roundedMinutes
      // (whether a travel time actually exists) rather than on the stored cache
      // id, so a one-time upsert failure self-heals on the next refresh.
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

      // Backfill display fields, recurringEventId, and the cache ids any
      // earlier failure left null on the row.
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

    // Event destination: dedicated location field, or fall back to the title.
    // Always the actual venue - even for Car events, since the dumb model is
    // home > venue > home.
    const eventLocation = (event.location ?? event.summary)!;

    // Mode precedence: per-instance override > series preference > default "driving".
    const seriesKey = event.recurringEventId
      ? `${event.recurringEventId}|${event.calendarEmail}`
      : null;
    const seriesMode = seriesKey ? (seriesModeByKey.get(seriesKey) ?? null) : null;
    const travelMode = (existing?.transportMode ?? seriesMode ?? "driving") as TransportMode;

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
        console.log(
          `[travel] Home → next result: ${rawHomeToNextMinutes ?? "null (skipping)"} min`,
        );
      }
    }

    // Suppress travel-back when dwell at home would be under the minimum.
    // The next event's travel-to leg (via findSmartOrigin) reserves the gap
    // instead. Car events don't participate in chaining (chained is forced to
    // null upstream), so they always fall through to a real travel-back home.
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

    // Skip entirely if both directions failed (try again next cron run)
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
  for (const block of existingBlocks) {
    const key = `${block.sourceEventId}|${block.calendarEmail}`;
    if (currentEventKeys.has(key)) continue;

    // Freeze finished events' blocks: the fetch window starts at `now`, so a
    // naturally-finished event vanishes from currentEventKeys the moment it
    // ends. Its block is the historical record of the reserved travel - the
    // schedule's past days still render it, and the operator's end-of-event
    // time corrections must not churn it. Only blocks whose event vanished
    // while still upcoming (cancelled or deleted) are cleaned up.
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

  return {
    cachedCount: rawEvents.length,
    deletedCount: deleteResult.count,
  };
}
