// src/lib/ics.ts
/**
 * @file ics.ts
 * @description ICS (iCalendar) file generation for booking confirmations.
 */

/**
 * Parameters for generating an ICS calendar event.
 */
export interface IcsEventParams {
  /** Unique identifier for the event. */
  uid: string;
  /** Event title/summary. */
  summary: string;
  /** Event description. */
  description: string;
  /** Event start time in UTC. */
  startUtc: Date;
  /** Event end time in UTC. */
  endUtc: Date;
  /** Location (optional). */
  location?: string;
  /** Organizer email. */
  organizerEmail: string;
  /** Organizer name. */
  organizerName: string;
  /** Attendee email. */
  attendeeEmail: string;
  /** Attendee name. */
  attendeeName: string;
  /** Reminder minutes before (default: 60). */
  reminderMinutes?: number;
}

/**
 * Escape special characters in ICS text.
 * @param text - Text to escape.
 * @returns Escaped text.
 */
function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Format a Date as ICS datetime (UTC).
 * @param date - Date to format.
 * @returns ICS datetime string.
 */
function formatIcsDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

/**
 * Fold long lines per ICS spec (max 75 chars).
 * @param line - Line to fold.
 * @returns Folded line.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

/**
 * Generate ICS content for a booking.
 * @param params - Event parameters.
 * @returns ICS file content.
 */
export function generateIcsContent(params: IcsEventParams): string {
  const {
    uid,
    summary,
    description,
    startUtc,
    endUtc,
    location,
    organizerEmail,
    organizerName,
    attendeeEmail,
    attendeeName,
    reminderMinutes = 60,
  } = params;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//To The Point Tech//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(startUtc)}`,
    `DTEND:${formatIcsDate(endUtc)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `ORGANIZER;CN=${escapeIcs(organizerName)}:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${escapeIcs(attendeeName)};RSVP=TRUE:mailto:${attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
  ];

  if (location) lines.push(`LOCATION:${escapeIcs(location)}`);

  if (reminderMinutes > 0) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:Reminder: ${escapeIcs(summary)}`,
      `TRIGGER:-PT${reminderMinutes}M`,
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/**
 * Generate ICS for a cancellation.
 * @param params - Event parameters.
 * @returns ICS cancellation content.
 */
export function generateCancellationIcs(params: IcsEventParams): string {
  const { uid, summary, startUtc, endUtc, organizerEmail, organizerName, attendeeEmail, attendeeName } =
    params;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//To The Point Tech//Booking//EN",
    "METHOD:CANCEL",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(startUtc)}`,
    `DTEND:${formatIcsDate(endUtc)}`,
    `SUMMARY:CANCELLED: ${escapeIcs(summary)}`,
    `ORGANIZER;CN=${escapeIcs(organizerName)}:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${escapeIcs(attendeeName)}:mailto:${attendeeEmail}`,
    "STATUS:CANCELLED",
    "SEQUENCE:1",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
