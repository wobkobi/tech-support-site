// src/features/calendar/lib/google-calendar.ts
// Google Calendar API integration - multi-calendar without list permission.

import { calendar as googleCalendar, type calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client } from "google-auth-library";
import { unstable_cache } from "next/cache";

import { requireEnv } from "@/shared/lib/env";
import { dateKeyParts, nzMidnightUtc } from "@/shared/lib/timezone-utils";

/**
 * Cache tag busted by booking and blocked-day mutations. Only the schedule page
 * caches; other callers of {@link fetchAllCalendarEvents} read live.
 */
export const SCHEDULE_CALENDAR_TAG = "schedule-calendar-events";

/**
 * Calendar for new booking events: BOOKING_CALENDAR_ID, else "primary".
 * @returns Booking calendar ID string.
 */
export function getBookingCalendarId(): string {
  return process.env.BOOKING_CALENDAR_ID ?? "primary";
}

/**
 * Configured calendar IDs from env. Explicit IDs stop subscribed calendars
 * (Holidays, Birthdays) from blocking booking slots.
 * @returns Array of calendar ID strings.
 */
function fetchAccessibleCalendarIds(): string[] {
  const ids = [
    process.env.BOOKING_CALENDAR_ID,
    // Work calendar; CAR_CALENDAR_ID is accepted as an alternative env name.
    process.env.WORK_CALENDAR_ID ?? process.env.CAR_CALENDAR_ID,
    process.env.PERSONAL_CALENDAR_ID,
  ].filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids : ["primary"];
}

/**
 * Gets OAuth2 client with credentials from environment variables
 * @returns Authenticated OAuth2 client
 */
export function getOAuth2Client(): OAuth2Client {
  // Per-var asserts so a blanked credential (e.g. a $ eaten by dotenv-expand)
  // fails with the offending var name.
  const clientId = requireEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_OAUTH_REDIRECT_URI");
  const refreshToken = requireEnv("GOOGLE_OAUTH_REFRESH_TOKEN");

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return oauth2Client;
}

/**
 * Gets authenticated Calendar API client
 * @returns Calendar API instance
 */
function getCalendarClient(): calendar_v3.Calendar {
  const auth = getOAuth2Client();
  return googleCalendar({ version: "v3", auth });
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
  // Parent series ID for a recurring instance; stable across the series.
  recurringEventId?: string;
  /**
   * An all-day event (a blocked day, a holiday), widened to NZ midnight > midnight so it
   * blocks booking slots. Job lists and travel skip it.
   */
  allDay: boolean;
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
 * Moves a booking event to a new time window. Patches start/end only so a
 * nudged finish time does not cancel and re-issue the invite.
 * @param params - Patch parameters.
 * @param params.eventId - Calendar event ID to move (Booking.calendarEventId).
 * @param params.startAt - New start time (UTC).
 * @param params.endAt - New end time (UTC).
 * @param params.timeZone - Display timezone for the invite.
 * @param params.notifyAttendees - Whether Google emails the attendee about the move.
 * @returns Promise that resolves when patched.
 */
export async function patchBookingEvent(params: {
  eventId: string;
  startAt: Date;
  endAt: Date;
  timeZone: string;
  notifyAttendees: boolean;
}): Promise<void> {
  const calendar = getCalendarClient();

  await calendar.events.patch({
    calendarId: getBookingCalendarId(),
    eventId: params.eventId,
    requestBody: {
      start: { dateTime: params.startAt.toISOString(), timeZone: params.timeZone },
      end: { dateTime: params.endAt.toISOString(), timeZone: params.timeZone },
    },
    sendUpdates: params.notifyAttendees ? "all" : "none",
  });
}

/**
 * Deletes a calendar event
 * @param params - Delete parameters
 * @param params.eventId - Calendar event ID to delete
 * @param params.notifyAttendees - Whether Google emails a cancellation (default true; false for a no-show).
 * @returns Promise that resolves when deleted
 */
export async function deleteBookingEvent(params: {
  eventId: string;
  notifyAttendees?: boolean;
}): Promise<void> {
  const calendar = getCalendarClient();

  await calendar.events.delete({
    calendarId: getBookingCalendarId(),
    eventId: params.eventId,
    sendUpdates: params.notifyAttendees === false ? "none" : "all",
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
  /** ISO time the event was made in Calendar; moving it later doesn't change this. */
  created: string | null;
}

/** Outcome of a single booking-event lookup. */
export type BookingEventLookup =
  /** The event is there and carries a real time window. */
  | { state: "found"; event: BookingEventDetails }
  /** Deleted or cancelled in Calendar - the job is off. */
  | { state: "gone" }
  /** All-day, or the API call failed: nothing can be concluded either way. */
  | { state: "unreadable" };

/**
 * True for a Google API 404 or 410 (the event is gone). googleapis puts the status in one of
 * three shapes depending on the transport; anything else must not read as a deletion.
 * @param err - The thrown value.
 * @returns Whether the error says the event no longer exists.
 */
export function isEventGone(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  return [e.code, e.status, e.response?.status].some((s) => s === 404 || s === 410);
}

/**
 * Reads one booking-calendar event live (bypassing the schedule cache). Keeps
 * deleted apart from unreadable: only a deletion means the job is off.
 * @param eventId - Google Calendar event id (as stored on Booking.calendarEventId).
 * @returns Which of the three states the event is in.
 */
export async function lookupBookingEvent(eventId: string): Promise<BookingEventLookup> {
  try {
    const calendar = getCalendarClient();
    const res = await calendar.events.get({
      calendarId: getBookingCalendarId(),
      eventId,
    });
    const event = res.data;
    // A deleted event reads back as status "cancelled" for a while before
    // Google drops the row entirely and starts answering 404.
    if (!event || event.status === "cancelled") return { state: "gone" };
    // All-day events carry date (not dateTime) and have no billable time window.
    if (!event.start?.dateTime || !event.end?.dateTime) return { state: "unreadable" };
    return {
      state: "found",
      event: {
        start: event.start.dateTime,
        end: event.end.dateTime,
        summary: event.summary ?? null,
        location: event.location ?? null,
        created: event.created ?? null,
      },
    };
  } catch (err) {
    if (isEventGone(err)) return { state: "gone" };
    console.warn("[calendar] lookupBookingEvent failed:", err);
    return { state: "unreadable" };
  }
}

/**
 * {@link lookupBookingEvent} collapsed to "usable times or nothing", for callers
 * that only need the window.
 * @param eventId - Google Calendar event id (as stored on Booking.calendarEventId).
 * @returns Event details, or null when missing, cancelled, all-day, or on any API failure.
 */
export async function fetchBookingEvent(eventId: string): Promise<BookingEventDetails | null> {
  const lookup = await lookupBookingEvent(eventId);
  return lookup.state === "found" ? lookup.event : null;
}

/**
 * Creates an all-day "Busy" event on the booking calendar, which
 * {@link fetchAllCalendarEvents} treats as a full-day blocker.
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
  const [y, m, d] = dateKeyParts(params.dateKey);
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
 * Reads an all-day block's date span; null when missing, cancelled or timed, so callers fall
 * back to a whole-event delete. Any other failure throws: read as null, one unblocked day
 * would delete the whole block.
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
    if (isEventGone(err)) return null;
    throw err;
  }
}

/**
 * Repoints an all-day event to a new [start, end) span, to trim a block when a
 * day is unblocked from it.
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
 * Inserts an all-day "Busy" block spanning [startDateKey, endDateKey). Backs
 * {@link createBlockedDayEvent} and unblock splits.
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
 * Lists all-day events overlapping [fromDateKey, toDateKey), so adjacent blocks
 * can merge into one span.
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
 * Maps one Google event to a {@link CalendarEvent}, or null when it shouldn't block: cancelled,
 * declined, or an all-day event on the personal calendar.
 * @param event - Raw Google Calendar event.
 * @param calendarId - Calendar the event came from.
 * @param isPersonal - Whether that is the personal calendar, whose all-day events never block.
 * @returns The mapped event, or null to skip it.
 */
export function toCalendarEvent(
  event: calendar_v3.Schema$Event,
  calendarId: string,
  isPersonal: boolean,
): CalendarEvent | null {
  if (event.status === "cancelled") return null;
  if (event.attendees?.find((a) => a.self)?.responseStatus === "declined") return null;

  const shared = {
    id: event.id!,
    summary: event.summary || undefined,
    description: event.description || undefined,
    location: event.location || undefined,
    calendarEmail: calendarId,
    htmlLink: event.htmlLink || undefined,
    recurringEventId: event.recurringEventId || undefined,
  };

  // Timed events block whatever calendar they're on.
  if (event.start?.dateTime && event.end?.dateTime) {
    return { ...shared, start: event.start.dateTime, end: event.end.dateTime, allDay: false };
  }

  // All-day: block the full NZ day(s). end.date is exclusive, and each boundary gets its own
  // offset since a block can span a DST change.
  if (event.start?.date && event.end?.date && !isPersonal) {
    const [sYear, sMonth, sDay] = dateKeyParts(event.start.date);
    const [eYear, eMonth, eDay] = dateKeyParts(event.end.date);
    return {
      ...shared,
      start: nzMidnightUtc(sYear, sMonth, sDay).toISOString(),
      end: nzMidnightUtc(eYear, eMonth, eDay).toISOString(),
      allDay: true,
    };
  }
  return null;
}

/** Events plus the calendars that failed, for callers that must tell "no events" from "no answer". */
export interface CalendarFetchResult {
  events: CalendarEvent[];
  /** Calendars whose fetch threw; their missing events are NOT deletions. */
  failedCalendarIds: string[];
}

/**
 * Fetches events from every configured calendar, reporting which failed. Use
 * over {@link fetchAllCalendarEvents} when an event's absence drives a delete.
 * @param startDate - Start of range
 * @param endDate - End of range
 * @returns Events from every calendar that answered, plus the ids of those that didn't.
 */
export async function fetchAllCalendarEventsDetailed(
  startDate: Date,
  endDate: Date,
): Promise<CalendarFetchResult> {
  const calendar = getCalendarClient();

  const calendarIds = fetchAccessibleCalendarIds();
  console.log(`[calendar] Checking ${calendarIds.length} calendars...`);

  const personalCalendarId = process.env.PERSONAL_CALENDAR_ID ?? "";

  // Calendars run concurrently; a failure is a per-calendar null so one bad
  // calendar cannot blank out the rest.
  const perCalendarResults = await Promise.all(
    calendarIds.map(async (calendarId): Promise<CalendarEvent[] | null> => {
      try {
        // events.list caps a page at 2500 (default 250); without paging, events
        // past page one would read as free time.
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
        const processedEvents = events
          .map((event) => toCalendarEvent(event, calendarId, isPersonal))
          .filter((e): e is CalendarEvent => e !== null);

        console.log(`[calendar] ${calendarId}: ${processedEvents.length} events`);
        return processedEvents;
      } catch (error) {
        console.error(`[calendar] Failed to fetch events from ${calendarId}:`, error);
        return null;
      }
    }),
  );

  const allEvents: CalendarEvent[] = [];
  const failedCalendarIds: string[] = [];
  // Index-aligned with calendarIds, so a null names the failed calendar.
  perCalendarResults.forEach((result, i) => {
    if (result === null) failedCalendarIds.push(calendarIds[i]!);
    else allEvents.push(...result);
  });

  if (failedCalendarIds.length === calendarIds.length) {
    throw new Error(
      `Failed to fetch events from all ${calendarIds.length} calendars - check API credentials`,
    );
  }

  console.log(
    `[calendar] Total: ${allEvents.length} events across ${calendarIds.length} calendars`,
  );
  return { events: allEvents, failedCalendarIds };
}

/**
 * Events from every calendar, dropping failure info. Deletes driven by absence
 * must use {@link fetchAllCalendarEventsDetailed}.
 * @param startDate - Start of range
 * @param endDate - End of range
 * @returns Array of calendar events from all specified calendars.
 */
export async function fetchAllCalendarEvents(
  startDate: Date,
  endDate: Date,
): Promise<CalendarEvent[]> {
  return (await fetchAllCalendarEventsDetailed(startDate, endDate)).events;
}

/**
 * {@link fetchAllCalendarEvents} for a booking check: throws when any calendar failed, since
 * its missing events would read as free time.
 * @param startDate - Start of range
 * @param endDate - End of range
 * @returns Events from every configured calendar.
 */
export async function fetchAllCalendarEventsStrict(
  startDate: Date,
  endDate: Date,
): Promise<CalendarEvent[]> {
  const { events, failedCalendarIds } = await fetchAllCalendarEventsDetailed(startDate, endDate);
  if (failedCalendarIds.length > 0) {
    throw new Error(`Couldn't read calendar(s) ${failedCalendarIds.join(", ")}`);
  }
  return events;
}

/**
 * Cached {@link fetchAllCalendarEvents} for the schedule page: 30s TTL, busted via
 * {@link SCHEDULE_CALENDAR_TAG}. ISO string args keep the cache key serialisable.
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
