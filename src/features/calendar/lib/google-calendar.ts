// src/features/calendar/lib/google-calendar.ts
/**
 * @description Google Calendar API integration - multi-calendar without list permission.
 */

import { google, type calendar_v3 } from "googleapis";
import { unstable_cache } from "next/cache";

import { requireEnv } from "@/shared/lib/env";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";

/**
 * Cache tag invalidated by routes that mutate bookings or blocked days so the
 * schedule page picks up changes within one render cycle. Stays separate
 * from the underlying {@link fetchAllCalendarEvents} so non-schedule callers (the
 * booking-slot availability check, etc.) can keep doing live reads.
 */
export const SCHEDULE_CALENDAR_TAG = "schedule-calendar-events";

/**
 * The calendar where new booking events are created.
 * Set BOOKING_CALENDAR_ID in env (e.g. a dedicated "Tech Support" calendar).
 * Falls back to "primary" if not set.
 * @returns Booking calendar ID string.
 */
export function getBookingCalendarId(): string {
  return process.env.BOOKING_CALENDAR_ID ?? "primary";
}

/**
 * Returns the configured calendar IDs from environment variables.
 * Using explicit env-var calendars prevents subscribed Google calendars
 * (Holidays, Birthdays, etc.) from unexpectedly blocking booking slots.
 * @returns Array of calendar ID strings.
 */
function fetchAccessibleCalendarIds(): string[] {
  const ids = [
    process.env.BOOKING_CALENDAR_ID,
    // Car calendar (renamed from Work); fall back to the old env name during
    // the transition window.
    process.env.CAR_CALENDAR_ID ?? process.env.WORK_CALENDAR_ID,
    process.env.PERSONAL_CALENDAR_ID,
  ].filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids : ["primary"];
}

/**
 * Gets OAuth2 client with credentials from environment variables
 * @returns Authenticated OAuth2 client
 */
export function getOAuth2Client(): InstanceType<typeof google.auth.OAuth2> {
  // Per-var named asserts (non-empty) so a blanked credential - e.g. an
  // unescaped $ swallowed by dotenv-expand - fails with the offending var name
  // instead of a generic "missing credentials". Matches the env-layer convention.
  const clientId = requireEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_OAUTH_REDIRECT_URI");
  const refreshToken = requireEnv("GOOGLE_OAUTH_REFRESH_TOKEN");

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return oauth2Client;
}

/**
 * Gets authenticated Calendar API client
 * @returns Calendar API instance
 */
function getCalendarClient(): ReturnType<typeof google.calendar> {
  const auth = getOAuth2Client();
  return google.calendar({ version: "v3", auth });
}

export interface CalendarEvent {
  id: string;
  start: string;
  end: string;
  summary?: string;
  description?: string;
  location?: string;
  calendarEmail: string; // Which calendar this event is from
  /** Google Calendar "open in Calendar" URL, when the API returns one. */
  htmlLink?: string;
  // Parent series ID when this event is a recurring instance (from Google Calendar
  // singleEvents expansion). Stable across all occurrences of the same series.
  recurringEventId?: string;
}

/**
 * Creates a booking calendar event with the attendee.
 * @param params - Event parameters.
 * @param params.summary - Event title.
 * @param params.description - Event body / notes.
 * @param params.startAt - Start time (UTC).
 * @param params.endAt - End time (UTC).
 * @param params.timeZone - Display timezone for the invite.
 * @param params.attendeeEmail - Attendee email address.
 * @param params.attendeeName - Attendee display name.
 * @param params.location - Optional event location (in-person address).
 * @returns Created event with ID.
 */
export async function createBookingEvent(params: {
  summary: string;
  description: string;
  startAt: Date;
  endAt: Date;
  timeZone: string;
  attendeeEmail: string;
  attendeeName: string;
  location?: string;
}): Promise<{ eventId: string }> {
  const calendar = getCalendarClient();

  const event = {
    summary: params.summary,
    description: params.description,
    location: params.location,
    start: {
      dateTime: params.startAt.toISOString(),
      timeZone: params.timeZone,
    },
    end: {
      dateTime: params.endAt.toISOString(),
      timeZone: params.timeZone,
    },
    attendees: [
      {
        email: params.attendeeEmail,
        displayName: params.attendeeName,
      },
    ],
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 24 * 60 }, // 1 day before
        { method: "popup", minutes: 60 }, // 1 hour before
      ],
    },
  };

  const response = await calendar.events.insert({
    calendarId: getBookingCalendarId(),
    requestBody: event,
    sendUpdates: "all", // Send email notifications to attendees
  });

  if (!response.data.id) {
    throw new Error("Failed to create calendar event - no event ID returned");
  }

  return { eventId: response.data.id };
}

/**
 * Deletes a calendar event
 * @param params - Delete parameters
 * @param params.eventId - Calendar event ID to delete
 * @returns Promise that resolves when deleted
 */
export async function deleteBookingEvent(params: { eventId: string }): Promise<void> {
  const calendar = getCalendarClient();

  await calendar.events.delete({
    calendarId: getBookingCalendarId(),
    eventId: params.eventId,
    sendUpdates: "all", // Notify attendees of cancellation
  });
}

/** Timed booking-calendar event as returned by {@link fetchBookingEvent}. */
export interface BookingEventDetails {
  /** ISO start of the event (the operator corrects these to actual on-site time). */
  start: string;
  /** ISO end of the event. */
  end: string;
  summary: string | null;
  location: string | null;
}

/**
 * Fetches one timed event from the booking calendar by id - live, not via the
 * schedule cache, so just-made time corrections are certain to be current.
 * Used by the calculator's "Bill in calculator" prefill.
 * @param eventId - Google Calendar event id (as stored on Booking.calendarEventId).
 * @returns Event details, or null when missing, cancelled, all-day, or on any API failure.
 */
export async function fetchBookingEvent(eventId: string): Promise<BookingEventDetails | null> {
  try {
    const calendar = getCalendarClient();
    const res = await calendar.events.get({
      calendarId: getBookingCalendarId(),
      eventId,
    });
    const event = res.data;
    if (!event || event.status === "cancelled") return null;
    // All-day events carry date (not dateTime) and have no billable time window.
    if (!event.start?.dateTime || !event.end?.dateTime) return null;
    return {
      start: event.start.dateTime,
      end: event.end.dateTime,
      summary: event.summary ?? null,
      location: event.location ?? null,
    };
  } catch (err) {
    console.warn("[calendar] fetchBookingEvent failed:", err);
    return null;
  }
}

/**
 * Creates an all-day "Busy" event on the booking calendar to block out the day
 * for new bookings. The existing {@link fetchAllCalendarEvents} path treats non-personal
 * all-day events as full-day blockers, so this matches the shape of a manually
 * created all-day Busy event.
 * @param params - Create parameters.
 * @param params.dateKey - NZ-local YYYY-MM-DD for the day to block.
 * @param params.summary - Event title (defaults to "Busy").
 * @returns Created event id.
 */
export async function createBlockedDayEvent(params: {
  dateKey: string;
  summary?: string;
}): Promise<{ eventId: string }> {
  // All-day events use YYYY-MM-DD strings and an exclusive end date (next day).
  const [y, m, d] = params.dateKey.split("-").map(Number);
  const endDateKey = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0)).toISOString().slice(0, 10);
  return insertBlockedDayRange({
    startDateKey: params.dateKey,
    endDateKey,
    summary: params.summary,
  });
}

/** All-day blocked-day span; both YYYY-MM-DD, `endDateKey` exclusive. */
export interface BlockedDayRange {
  /** First blocked day (inclusive). */
  startDateKey: string;
  /** Day after the last blocked day (exclusive), matching Google's all-day end. */
  endDateKey: string;
  /** Event title, preserved when a split copies the block. */
  summary: string | null;
}

/**
 * Reads an all-day "Busy" block's date span. Returns null when the event is
 * missing, cancelled, or not an all-day event (a timed event has no `start.date`),
 * so callers can fall back to a whole-event delete.
 * @param eventId - Google Calendar event id.
 * @returns The block's date span, or null.
 */
export async function getBlockedDayRange(eventId: string): Promise<BlockedDayRange | null> {
  try {
    const calendar = getCalendarClient();
    const res = await calendar.events.get({ calendarId: getBookingCalendarId(), eventId });
    const event = res.data;
    if (!event || event.status === "cancelled") return null;
    // All-day events carry start.date / end.date (exclusive), not dateTime.
    if (!event.start?.date || !event.end?.date) return null;
    return {
      startDateKey: event.start.date,
      endDateKey: event.end.date,
      summary: event.summary ?? null,
    };
  } catch (err) {
    console.warn("[calendar] getBlockedDayRange failed:", err);
    return null;
  }
}

/**
 * Repoints an existing all-day event to a new [start, end) span (end exclusive).
 * Used to trim/shorten a block when a day is unblocked off its edge, or to keep
 * the before-portion when a middle day is unblocked.
 * @param params - Patch parameters.
 * @param params.eventId - Google Calendar event id.
 * @param params.startDateKey - New inclusive start (YYYY-MM-DD).
 * @param params.endDateKey - New exclusive end (YYYY-MM-DD).
 * @returns Promise that resolves when patched.
 */
export async function patchBlockedDayRange(params: {
  eventId: string;
  startDateKey: string;
  endDateKey: string;
}): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.patch({
    calendarId: getBookingCalendarId(),
    eventId: params.eventId,
    requestBody: {
      start: { date: params.startDateKey },
      end: { date: params.endDateKey },
    },
  });
}

/**
 * Inserts an all-day "Busy" block spanning [startDateKey, endDateKey) (end
 * exclusive). Backs {@link createBlockedDayEvent} and the after-portion of a
 * middle-day unblock split.
 * @param params - Insert parameters.
 * @param params.startDateKey - Inclusive start (YYYY-MM-DD).
 * @param params.endDateKey - Exclusive end (YYYY-MM-DD).
 * @param params.summary - Event title (defaults to "Busy").
 * @returns Created event id.
 */
export async function insertBlockedDayRange(params: {
  startDateKey: string;
  endDateKey: string;
  summary?: string | null;
}): Promise<{ eventId: string }> {
  const calendar = getCalendarClient();
  const response = await calendar.events.insert({
    calendarId: getBookingCalendarId(),
    requestBody: {
      summary: params.summary ?? "Busy",
      start: { date: params.startDateKey },
      end: { date: params.endDateKey },
      transparency: "opaque",
    },
  });
  if (!response.data.id) {
    throw new Error("Failed to create blocked-day event - no event ID returned");
  }
  return { eventId: response.data.id };
}

/**
 * Lists all-day events on the booking calendar overlapping [fromDateKey,
 * toDateKey). Used to find blocks adjacent to a newly blocked day so contiguous
 * blocks can be merged into one span. Timed events are excluded.
 * @param fromDateKey - Window start (inclusive, YYYY-MM-DD).
 * @param toDateKey - Window end (exclusive, YYYY-MM-DD).
 * @returns All-day blocks in the window with their date spans (end exclusive).
 */
export async function listBlockedDayRanges(
  fromDateKey: string,
  toDateKey: string,
): Promise<Array<BlockedDayRange & { eventId: string }>> {
  const calendar = getCalendarClient();
  const res = await calendar.events.list({
    calendarId: getBookingCalendarId(),
    timeMin: `${fromDateKey}T00:00:00Z`,
    timeMax: `${toDateKey}T00:00:00Z`,
    singleEvents: true,
    maxResults: 50,
  });
  return (res.data.items ?? [])
    .filter((e) => e.status !== "cancelled" && e.start?.date && e.end?.date && e.id)
    .map((e) => ({
      eventId: e.id!,
      startDateKey: e.start!.date!,
      endDateKey: e.end!.date!,
      summary: e.summary ?? null,
    }));
}

/**
 * Fetches all calendar events from specified calendars (no list permission needed)
 * @param startDate - Start of range
 * @param endDate - End of range
 * @returns Array of calendar events from all specified calendars
 */
export async function fetchAllCalendarEvents(
  startDate: Date,
  endDate: Date,
): Promise<CalendarEvent[]> {
  const calendar = getCalendarClient();

  const calendarIds = fetchAccessibleCalendarIds();
  console.log(`[calendar] Checking ${calendarIds.length} calendars...`);

  const personalCalendarId = process.env.PERSONAL_CALENDAR_ID ?? "";

  // Fetch every calendar concurrently - pagination within one calendar stays
  // sequential (nextPageToken chains). Failures stay per-calendar (null) so
  // one bad calendar cannot blank out the rest.
  const perCalendarResults = await Promise.all(
    calendarIds.map(async (calendarId): Promise<CalendarEvent[] | null> => {
      try {
        // Page through the calendar: events.list caps a page at 2500 (default 250)
        // and returns nextPageToken when truncated. Without the loop a busy
        // calendar (recurring series expanded by singleEvents over the booking
        // horizon) would silently drop events past the first page, leaving those
        // times treated as free.
        const events: calendar_v3.Schema$Event[] = [];
        let pageToken: string | undefined;
        do {
          const response = await calendar.events.list({
            calendarId,
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 2500,
            pageToken,
          });
          events.push(...(response.data.items ?? []));
          pageToken = response.data.nextPageToken ?? undefined;
        } while (pageToken);
        const isPersonal = Boolean(personalCalendarId) && calendarId === personalCalendarId;
        const processedEvents: CalendarEvent[] = [];

        for (const event of events) {
          // Skip cancelled events (organiser cancelled or event was deleted)
          if (event.status === "cancelled") continue;

          // Skip events the user has declined
          const selfAttendee = event.attendees?.find((a) => a.self);
          if (selfAttendee?.responseStatus === "declined") continue;

          if (event.start?.dateTime && event.end?.dateTime) {
            // Timed event - always block regardless of calendar
            processedEvents.push({
              id: event.id!,
              start: event.start.dateTime,
              end: event.end.dateTime,
              summary: event.summary || undefined,
              description: event.description || undefined,
              location: event.location || undefined,
              calendarEmail: calendarId,
              htmlLink: event.htmlLink || undefined,
              recurringEventId: event.recurringEventId || undefined,
            });
          } else if (event.start?.date && event.end?.date && !isPersonal) {
            // All-day event from a non-personal calendar - block the full NZ day(s).
            // All-day events use date strings ("YYYY-MM-DD"); end.date is exclusive.
            // Convert NZ calendar midnight > UTC so slot checking works correctly.
            const startDateStr = event.start.date;
            const endDateStr = event.end.date;
            const [sYear, sMonth, sDay] = startDateStr.split("-").map(Number);
            const [eYear, eMonth, eDay] = endDateStr.split("-").map(Number);
            const utcOffset = getPacificAucklandOffset(sYear, sMonth, sDay);
            // NZ midnight = UTC hour 0 minus utcOffset (JS Date handles negative hour wrap)
            const startAt = new Date(Date.UTC(sYear, sMonth - 1, sDay, -utcOffset, 0, 0));
            const endAt = new Date(Date.UTC(eYear, eMonth - 1, eDay, -utcOffset, 0, 0));
            processedEvents.push({
              id: event.id!,
              start: startAt.toISOString(),
              end: endAt.toISOString(),
              summary: event.summary || undefined,
              description: event.description || undefined,
              location: event.location || undefined,
              calendarEmail: calendarId,
              htmlLink: event.htmlLink || undefined,
              recurringEventId: event.recurringEventId || undefined,
            });
          }
          // All-day events from the personal calendar are intentionally skipped
        }

        console.log(`[calendar] ${calendarId}: ${processedEvents.length} events`);
        return processedEvents;
      } catch (error) {
        console.error(`[calendar] Failed to fetch events from ${calendarId}:`, error);
        return null;
      }
    }),
  );

  const allEvents: CalendarEvent[] = [];
  let errorCount = 0;
  for (const result of perCalendarResults) {
    if (result === null) errorCount++;
    else allEvents.push(...result);
  }

  if (errorCount === calendarIds.length) {
    throw new Error(
      `Failed to fetch events from all ${calendarIds.length} calendars - check API credentials`,
    );
  }

  console.log(
    `[calendar] Total: ${allEvents.length} events across ${calendarIds.length} calendars`,
  );
  return allEvents;
}

/**
 * Cached wrapper around {@link fetchAllCalendarEvents} for the admin schedule page.
 * 30-second TTL with revalidation on booking/blocked-day mutations via
 * {@link SCHEDULE_CALENDAR_TAG}. Paired with the schedule's client-side auto-poll
 * (the ScheduleAutoRefresh component) so externally-made calendar changes surface
 * within ~30s; the operator's own edits still bust the cache immediately. Takes
 * ISO strings (not Date objects) so the cache key is deterministically serialisable.
 * @param startIso - ISO 8601 start of range.
 * @param endIso - ISO 8601 end of range.
 * @returns Cached array of calendar events.
 */
export const getCachedScheduleEvents = unstable_cache(
  async (startIso: string, endIso: string): Promise<CalendarEvent[]> => {
    return fetchAllCalendarEvents(new Date(startIso), new Date(endIso));
  },
  ["schedule-calendar-events"],
  { tags: [SCHEDULE_CALENDAR_TAG], revalidate: 30 },
);
