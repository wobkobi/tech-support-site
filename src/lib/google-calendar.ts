// src/lib/google-calendar.ts
/**
 * @file google-calendar.ts
 * @description Google Calendar API integration - multi-calendar without list permission.
 */

import { google } from "googleapis";
import { getPacificAucklandOffset } from "@/lib/timezone-utils";

/**
 * The calendar where new booking events are created.
 * Set BOOKING_CALENDAR_ID in env (e.g. a dedicated "Tech Support" calendar).
 * Falls back to "primary" if not set.
 * @returns Booking calendar ID string.
 */
function getBookingCalendarId(): string {
  return process.env.BOOKING_CALENDAR_ID ?? "primary";
}

/**
 * All calendars checked when computing availability.
 * Reads BOOKING_CALENDAR_ID, WORK_CALENDAR_ID, and PERSONAL_CALENDAR_ID from env.
 * Duplicate/empty values are filtered out automatically.
 * @returns Array of calendar ID strings to check for availability.
 */
function getCalendarIds(): string[] {
  const ids = [
    process.env.BOOKING_CALENDAR_ID,
    process.env.WORK_CALENDAR_ID,
    process.env.PERSONAL_CALENDAR_ID,
  ].filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids : ["primary"];
}

/**
 * Gets OAuth2 client with credentials from environment variables
 * @returns Authenticated OAuth2 client
 */
function getOAuth2Client(): InstanceType<typeof google.auth.OAuth2> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !redirectUri || !refreshToken) {
    throw new Error("Missing Google OAuth credentials in environment variables");
  }

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
  calendarEmail: string; // Which calendar this event is from
}

/**
 * Creates a calendar event
 * @param params - Event parameters
 * @param params.summary - Event title
 * @param params.description - Event description
 * @param params.startUtc - Start time (UTC Date object)
 * @param params.endUtc - End time (UTC Date object)
 * @param params.timeZone - Timezone for display
 * @param params.attendeeEmail - Attendee email address
 * @param params.attendeeName - Attendee name
 * @param params.location - Event location (for in-person)
 * @returns Created event with ID
 */
export async function createBookingEvent(params: {
  summary: string;
  description: string;
  startUtc: Date;
  endUtc: Date;
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
      dateTime: params.startUtc.toISOString(),
      timeZone: params.timeZone,
    },
    end: {
      dateTime: params.endUtc.toISOString(),
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

  const calendarIds = getCalendarIds();
  console.log(`[calendar] Checking ${calendarIds.length} calendars...`);

  const allEvents: CalendarEvent[] = [];

  const personalCalendarId = process.env.PERSONAL_CALENDAR_ID ?? "";

  // Fetch events from each calendar ID
  for (const calendarId of calendarIds) {
    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = response.data.items || [];
      const isPersonal = Boolean(personalCalendarId) && calendarId === personalCalendarId;
      const processedEvents: CalendarEvent[] = [];

      for (const event of events) {
        if (event.start?.dateTime && event.end?.dateTime) {
          // Timed event — always block regardless of calendar
          processedEvents.push({
            id: event.id!,
            start: event.start.dateTime,
            end: event.end.dateTime,
            summary: event.summary || undefined,
            description: event.description || undefined,
            calendarEmail: calendarId,
          });
        } else if (event.start?.date && event.end?.date && !isPersonal) {
          // All-day event from a non-personal calendar — block the full NZ day(s).
          // All-day events use date strings ("YYYY-MM-DD"); end.date is exclusive.
          // Convert NZ calendar midnight → UTC so slot checking works correctly.
          const startDateStr = event.start.date;
          const endDateStr = event.end.date;
          const [sYear, sMonth, sDay] = startDateStr.split("-").map(Number);
          const [eYear, eMonth, eDay] = endDateStr.split("-").map(Number);
          const utcOffset = getPacificAucklandOffset(sYear, sMonth, sDay);
          // NZ midnight = UTC hour 0 minus utcOffset (JS Date handles negative hour wrap)
          const startUtc = new Date(Date.UTC(sYear, sMonth - 1, sDay, -utcOffset, 0, 0));
          const endUtc = new Date(Date.UTC(eYear, eMonth - 1, eDay, -utcOffset, 0, 0));
          processedEvents.push({
            id: event.id!,
            start: startUtc.toISOString(),
            end: endUtc.toISOString(),
            summary: event.summary || undefined,
            description: event.description || undefined,
            calendarEmail: calendarId,
          });
        }
        // All-day events from the personal calendar are intentionally skipped
      }

      console.log(`[calendar] ${calendarId}: ${processedEvents.length} events`);
      allEvents.push(...processedEvents);
    } catch (error) {
      console.error(`[calendar] Failed to fetch events from ${calendarId}:`, error);
      // Continue with other calendars
    }
  }

  console.log(
    `[calendar] Total: ${allEvents.length} events across ${calendarIds.length} calendars`,
  );
  return allEvents;
}
