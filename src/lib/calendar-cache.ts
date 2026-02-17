// src/lib/calendar-cache.ts
/**
 * @file calendar-cache.ts
 * @description Background task to fetch and cache Google Calendar events.
 */

import { prisma } from "@/lib/prisma";
import { fetchAllCalendarEvents } from "@/lib/google-calendar";
import { BOOKING_CONFIG } from "@/lib/booking";

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
  let rawEvents: Array<{ id: string; start: string; end: string; calendarEmail: string }> = [];
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
        startUtc: new Date(event.start),
        endUtc: new Date(event.end),
        fetchedAt: now,
        expiresAt: cacheExpiry,
      },
      update: {
        startUtc: new Date(event.start),
        endUtc: new Date(event.end),
        fetchedAt: now,
        expiresAt: cacheExpiry,
      },
    }),
  );

  await Promise.all(upsertPromises);

  console.log(
    `[refreshCalendarCache] Cached ${rawEvents.length} events, deleted ${deleteResult.count} expired entries`,
  );

  return {
    cachedCount: rawEvents.length,
    deletedCount: deleteResult.count,
  };
}
