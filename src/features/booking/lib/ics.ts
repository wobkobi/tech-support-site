// src/features/booking/lib/ics.ts - minimal dependency-free RFC 5545 builder
// (TEXT escaping, CRLF folding, UTC stamps, stable UID).

/** A single calendar event to serialise. */
export interface IcsEvent {
  /** Stable id (the booking id) - reuse makes clients UPDATE, not duplicate. */
  uid: string;
  /** Appointment start (UTC). */
  start: Date;
  /** Appointment end (UTC). */
  end: Date;
  /** Event title. */
  summary: string;
  /** Optional long description. */
  description?: string;
  /** Optional location (the appointment address for in-person jobs). */
  location?: string;
  /** Revision counter (rescheduleCount) - without a rise, clients ignore updates. */
  sequence?: number;
  /** Organiser email, surfaced as ORGANIZER. */
  organiserEmail?: string;
  /** Link shown by calendar clients, e.g. the manage-booking page. */
  url?: string;
  /** Generation time (DTSTAMP). Defaults to now; injectable for deterministic output. */
  stamp?: Date;
}

/**
 * Escapes a value for an iCalendar TEXT field. Backslash first, otherwise the
 * escapes added below would be escaped again.
 * @param value - Raw text.
 * @returns Escaped text safe to place after a property name.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Formats a date as an iCalendar UTC timestamp ("20260715T110000Z").
 * @param date - The date to format.
 * @returns UTC timestamp string.
 */
function formatUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Folds a content line to the 75-octet limit, continuing with CRLF + a single
 * space. Measured in UTF-8 bytes, not characters, so a multi-byte character is
 * never split across a fold boundary.
 * @param line - One unfolded content line.
 * @returns The folded line.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // First line allows 75 octets; continuation lines lose one to the leading space.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);

  return out.join("\r\n ");
}

/**
 * Serialises one event as a complete `.ics` document. METHOD:PUBLISH (not
 * REQUEST) because this is an add-to-my-calendar file, not an invitation that
 * expects an RSVP - Google Calendar already invites the attendee separately.
 * @param event - The event to serialise.
 * @returns The `.ics` file contents, CRLF-delimited.
 */
export function buildIcs(event: IcsEvent): string {
  const stamp = event.stamp ?? new Date();

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//To the Point Tech//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${formatUtc(stamp)}`,
    `DTSTART:${formatUtc(event.start)}`,
    `DTEND:${formatUtc(event.end)}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];

  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.organiserEmail) lines.push(`ORGANIZER:mailto:${event.organiserEmail}`);
  // URI value, not TEXT - escaping it would corrupt the query string.
  if (event.url) lines.push(`URL:${event.url}`);

  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  // Trailing CRLF: the spec expects every content line, including the last, to
  // be terminated.
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/**
 * Builds a Google Calendar "add event" URL - the no-download path for people
 * who live in Google Calendar and would be confused by an `.ics` file.
 * @param event - The timing and text fields; identity fields are not used.
 * @returns An absolute google.com/calendar render URL.
 */
export function googleCalendarUrl(
  event: Pick<IcsEvent, "start" | "end" | "summary" | "description" | "location">,
): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.summary,
    // Google wants the compact UTC form, start/end separated by a slash.
    dates: `${formatUtc(event.start)}/${formatUtc(event.end)}`,
  });
  if (event.description) params.set("details", event.description);
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
