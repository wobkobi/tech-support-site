// src/features/admin/lib/schedule-token.ts
// Schedule freshness token, shared by the schedule page and /api/admin/schedule/version.

import type { CalendarEvent } from "@/features/calendar/lib/google-calendar";
import { createHash } from "node:crypto";

/**
 * Hashes the grid-visible fields of an event list into a short token. Sorted because
 * events arrive in no fixed order; unrendered fields are ignored.
 * @param events - Calendar events covering the page's buffered window.
 * @returns Hex token, stable across renders for identical schedule content.
 */
export function scheduleEventsToken(events: CalendarEvent[]): string {
  const lines = events
    .map((e) => `${e.id}|${e.start}|${e.end}|${e.summary ?? ""}|${e.location ?? ""}`)
    .sort();
  return createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 16);
}
