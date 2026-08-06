// src/features/admin/lib/schedule-token.ts
// Shared by the admin schedule page and /api/admin/schedule/version: both derive
// the token from the same event list, so the two only agree while the rendered
// grid is still current.

import type { CalendarEvent } from "@/features/calendar/lib/google-calendar";
import { createHash } from "node:crypto";

/**
 * Hashes the grid-visible fields of a calendar event list into a short token.
 * Lines are sorted first because events arrive interleaved per calendar in no
 * guaranteed order - hashing the raw order would flip the token on most polls
 * and refresh forever. Only rendered fields count, so an unrelated Google
 * metadata edit (attendees, description) doesn't force a needless reload.
 * @param events - Calendar events covering the page's buffered window.
 * @returns Hex token, stable across renders for identical schedule content.
 */
export function scheduleEventsToken(events: CalendarEvent[]): string {
  const lines = events
    .map((e) => `${e.id}|${e.start}|${e.end}|${e.summary ?? ""}|${e.location ?? ""}`)
    .sort();
  return createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 16);
}
