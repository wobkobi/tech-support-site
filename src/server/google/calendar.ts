// src/server/google/calendar.ts
/**
 * @file calendar.ts
 * @description Google Calendar integration with support for multiple calendars.
 * Checks both work and personal calendars for conflicts.
 */

import { google } from "googleapis";
import type { ExistingEvent } from "@/lib/booking";

/**
 * Parameters needed to create a booking event in Google Calendar.
 */
export interface CreateBookingEventParams {
  /** Calendar event title. */
  summary: string;
  /** Calendar event description. */
  description: string;
  /** Appointment start time in UTC. */
  startUtc: Date;
  /** Appointment end time in UTC. */
  endUtc: Date;
  /** IANA time zone identifier for the event. */
  timeZone: string;
  /** Client email address (receives invite). */
  attendeeEmail: string;
  /** Client name. */
  attendeeName: string;
}

/**
 * Result of creating a booking event.
 */
export interface CreateBookingEventResult {
  /** Google Calendar event id. */
  eventId: string;
}

/**
 * Parameters needed to delete a booking event.
 */
export interface DeleteBookingEventParams {
  /** Google Calendar event id. */
  eventId: string;
}

/**
 * Create an OAuth2 client for the primary (work) account.
 * @returns OAuth2 client authorised for Calendar API calls.
 */
function getWorkOAuthClient(): InstanceType<typeof google.auth.OAuth2> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !redirectUri || !refreshToken) {
    throw new Error("Missing GOOGLE_OAUTH_* env vars for work account.");
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

/**
 * Create an OAuth2 client for the personal account (optional).
 * @returns OAuth2 client or null if not configured.
 */
function getPersonalOAuthClient(): InstanceType<typeof google.auth.OAuth2> | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const refreshToken = process.env.GOOGLE_PERSONAL_OAUTH_REFRESH_TOKEN;

  if (!refreshToken) {
    return null; // Personal calendar not configured
  }

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

/**
 * Get the booking calendar id from env.
 * @returns Calendar id string.
 */
function getWorkCalendarId(): string {
  return process.env.BOOKING_CALENDAR_ID ?? "primary";
}

/**
 * Get the personal calendar id from env.
 * @returns Calendar id string or null if not configured.
 */
function getPersonalCalendarId(): string | null {
  return process.env.PERSONAL_CALENDAR_ID ?? null;
}

/**
 * Fetch events from a calendar within a time range.
 * @param auth - OAuth2 client.
 * @param calendarId - Calendar to fetch from.
 * @param timeMin - Start of range (UTC).
 * @param timeMax - End of range (UTC).
 * @returns Array of existing events.
 */
async function fetchCalendarEvents(
  auth: InstanceType<typeof google.auth.OAuth2>,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<ExistingEvent[]> {
  const calendar = google.calendar({ version: "v3", auth });

  try {
    const response = await calendar.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events: ExistingEvent[] = [];

    for (const item of response.data.items ?? []) {
      // Skip all-day events (no dateTime)
      if (!item.start?.dateTime || !item.end?.dateTime) {
        continue;
      }

      // Skip cancelled events
      if (item.status === "cancelled") {
        continue;
      }

      events.push({
        startUtc: new Date(item.start.dateTime),
        endUtc: new Date(item.end.dateTime),
        calendarId,
      });
    }

    return events;
  } catch (error) {
    console.error(`[calendar] Failed to fetch events from ${calendarId}:`, error);
    return [];
  }
}

/**
 * Fetch events from all configured calendars (work + personal).
 * @param timeMin - Start of range (UTC).
 * @param timeMax - End of range (UTC).
 * @returns Combined array of events from all calendars.
 */
export async function fetchAllCalendarEvents(
  timeMin: Date,
  timeMax: Date,
): Promise<ExistingEvent[]> {
  const allEvents: ExistingEvent[] = [];

  // Fetch from work calendar
  const workAuth = getWorkOAuthClient();
  const workCalendarId = getWorkCalendarId();
  const workEvents = await fetchCalendarEvents(workAuth, workCalendarId, timeMin, timeMax);
  allEvents.push(...workEvents);

  // Fetch from personal calendar if configured
  const personalAuth = getPersonalOAuthClient();
  const personalCalendarId = getPersonalCalendarId();

  if (personalAuth && personalCalendarId) {
    const personalEvents = await fetchCalendarEvents(
      personalAuth,
      personalCalendarId,
      timeMin,
      timeMax,
    );
    allEvents.push(...personalEvents);
  }

  return allEvents;
}

/**
 * Create a booking event in Google Calendar and send invites.
 * @param params - Event parameters.
 * @returns Event id created in Google Calendar.
 */
export async function createBookingEvent(
  params: CreateBookingEventParams,
): Promise<CreateBookingEventResult> {
  const auth = getWorkOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = getWorkCalendarId();

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: {
        dateTime: params.startUtc.toISOString(),
        timeZone: params.timeZone,
      },
      end: {
        dateTime: params.endUtc.toISOString(),
        timeZone: params.timeZone,
      },
      attendees: [{ email: params.attendeeEmail, displayName: params.attendeeName }],
    },
    sendUpdates: "all",
  });

  const eventId = response.data.id;
  if (!eventId) {
    throw new Error("Google Calendar did not return an event id.");
  }

  return { eventId };
}

/**
 * Delete a booking event from Google Calendar and send updates.
 * @param params - Deletion parameters.
 * @returns Promise that resolves when deletion completes.
 */
export async function deleteBookingEvent(params: DeleteBookingEventParams): Promise<void> {
  const auth = getWorkOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = getWorkCalendarId();

  await calendar.events.delete({
    calendarId,
    eventId: params.eventId,
    sendUpdates: "all",
  });
}
