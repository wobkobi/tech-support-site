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
import { calculateTravelMinutes } from "@/features/calendar/lib/travel-time";

interface RefreshResult {
  cachedCount: number;
  deletedCount: number;
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

  // Upsert fresh events into cache
  const cacheExpiry = new Date(now.getTime() + 15 * 60 * 1000); // Cache expires in 15 minutes
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
  const existingBlocks = await prisma.travelBlock.findMany();
  const blockByKey = new Map(
    existingBlocks.map((b) => [`${b.sourceEventId}|${b.calendarEmail}`, b]),
  );
  const currentEventKeys = new Set(rawEvents.map((e) => `${e.id}|${e.calendarEmail}`));

  if (isDev) {
    console.log(`[travel] Existing TravelBlocks in DB: ${existingBlocks.length}`);
  }

  // Create blocks for new eligible events (or rebuild if times or rounding changed)
  for (const event of eligibleEvents) {
    const key = `${event.id}|${event.calendarEmail}`;
    const existing = blockByKey.get(key);
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    // Synthetic cache IDs — never written to Google Calendar
    const beforeId = `travel-before:${event.id}`;
    const afterId = `travel-after:${event.id}`;

    // Booking calendar events get a 30-min buffer before departure on the way back
    const isBookingEvent = event.calendarEmail === bookingCalId;
    const departureForBack = isBookingEvent
      ? new Date(eventEnd.getTime() + 30 * 60 * 1000)
      : eventEnd;

    // Determine whether a rebuild is needed and whether we can reuse raw minutes
    let needsRebuild = true;
    let reuseRawToMinutes: number | null = null;
    let reuseRawBackMinutes: number | null = null;

    if (existing) {
      const eventTimesMatch =
        existing.eventStartAt?.getTime() === eventStart.getTime() &&
        existing.eventEndAt?.getTime() === eventEnd.getTime();

      if (eventTimesMatch) {
        // null means the direction was never successfully calculated — treat as needing retry
        const toOk =
          existing.rawTravelMinutes !== null &&
          Math.ceil(existing.rawTravelMinutes / 15) * 15 === (existing.roundedMinutes ?? -1);
        const backOk =
          existing.rawTravelBackMinutes !== null &&
          Math.ceil(existing.rawTravelBackMinutes / 15) * 15 ===
            (existing.roundedBackMinutes ?? -1);

        if (toOk && backOk) {
          if (isDev) console.log(`[travel] Skipping "${event.summary}" - unchanged`);
          needsRebuild = false;
        } else {
          // Rounding formula changed or a direction was never calculated — reuse what we have
          reuseRawToMinutes = existing.rawTravelMinutes;
          reuseRawBackMinutes = existing.rawTravelBackMinutes;
          if (isDev)
            console.log(
              `[travel] Rebuilding "${event.summary}" - rounding changed or direction was null`,
            );
        }
      } else {
        if (isDev) console.log(`[travel] Rebuilding "${event.summary}" - event times changed`);
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
      if (
        existing.beforeEventId != null &&
        existing.eventStartAt != null &&
        existing.roundedMinutes != null
      ) {
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

      // Back-fill summary if the stored value is missing or stale
      const currentSummary = event.summary ?? null;
      if (existing.summary !== currentSummary) {
        await prisma.travelBlock.update({
          where: { id: existing.id },
          data: { summary: currentSummary },
        });
      }
      continue;
    }

    // Effective destination: dedicated location field, or fall back to event title
    const eventLocation = (event.location ?? event.summary)!;

    // Travel-to leg
    let rawTravelToMinutes: number | null = null;
    if (reuseRawToMinutes !== null) {
      rawTravelToMinutes = reuseRawToMinutes;
    } else {
      if (isDev) console.log(`[travel] Calculating travel-to: ${homeAddress} → ${eventLocation}`);
      rawTravelToMinutes = await calculateTravelMinutes(homeAddress, eventLocation, eventStart, {
        useArrivalTime: true,
      });
      if (isDev)
        console.log(`[travel] Travel-to result: ${rawTravelToMinutes ?? "null (skipping)"} min`);
    }

    // Travel-back leg
    let rawTravelBackMinutes: number | null = null;
    if (reuseRawBackMinutes !== null) {
      rawTravelBackMinutes = reuseRawBackMinutes;
    } else {
      if (isDev)
        console.log(
          `[travel] Calculating travel-back: ${eventLocation} → ${homeAddress} (depart ${departureForBack.toISOString()})`,
        );
      rawTravelBackMinutes = await calculateTravelMinutes(
        eventLocation,
        homeAddress,
        departureForBack,
      );
      if (isDev)
        console.log(
          `[travel] Travel-back result: ${rawTravelBackMinutes ?? "null (skipping)"} min`,
        );
    }

    // Skip entirely if both directions failed (try again next cron run)
    if (rawTravelToMinutes === null && rawTravelBackMinutes === null) {
      if (isDev) console.log(`[travel] Both directions null for "${event.summary}" - skipping`);
      continue;
    }

    // Write cache-only blocks
    let storedBeforeId: string | null = null;
    if (rawTravelToMinutes !== null) {
      const roundedTo = Math.ceil(rawTravelToMinutes / 15) * 15;
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
    if (rawTravelBackMinutes !== null) {
      const roundedBack = Math.ceil(rawTravelBackMinutes / 15) * 15;
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

    // Persist TravelBlock record
    try {
      await prisma.travelBlock.create({
        data: {
          sourceEventId: event.id,
          calendarEmail: event.calendarEmail,
          summary: event.summary ?? null,
          eventStartAt: eventStart,
          eventEndAt: eventEnd,
          rawTravelMinutes: rawTravelToMinutes,
          roundedMinutes:
            rawTravelToMinutes !== null ? Math.ceil(rawTravelToMinutes / 15) * 15 : null,
          rawTravelBackMinutes,
          roundedBackMinutes:
            rawTravelBackMinutes !== null ? Math.ceil(rawTravelBackMinutes / 15) * 15 : null,
          beforeEventId: storedBeforeId,
          afterEventId: storedAfterId,
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
