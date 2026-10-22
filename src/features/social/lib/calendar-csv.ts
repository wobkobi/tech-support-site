// src/features/social/lib/calendar-csv.ts
// The calendar's Download CSV: one line per post or open time on screen, for a spreadsheet.
// Pure and client-safe.

import {
  byTime,
  CALENDAR_STATUS,
  mondayKey,
  timeOfDay,
  type CalendarEntry,
  type CalendarView,
  type ColourContext,
} from "@/features/social/lib/calendar";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import { CSV_BOM, CSV_EOL, csvText } from "@/shared/lib/csv";
import { nzDateKey } from "@/shared/lib/timezone-utils";

const HEADERS = ["Date", "Time", "Status", "Post", "Apps", "Schedule", "Tags", "Words"] as const;

/**
 * The CSV for the entries on screen, in time order. An open time has its schedule but no post.
 * @param entries - Entries on screen.
 * @param ctx - Schedule and tag names.
 * @returns The CSV text, BOM first, CRLF line endings.
 */
export function calendarCsv(entries: readonly CalendarEntry[], ctx: ColourContext): string {
  const lines = [HEADERS.map(csvText).join(",")];
  for (const e of [...entries].sort(byTime)) {
    const [y, m, d] = nzDateKey(new Date(e.at)).split("-");
    const open = e.status === "open";
    lines.push(
      [
        `${d}/${m}/${y}`,
        timeOfDay(e.at),
        open && e.later ? "Fills nearer the time" : CALENDAR_STATUS[e.status].label,
        open ? "" : e.name,
        e.platforms.map((p) => PLATFORM_LABEL[p]).join(", "),
        (e.queueId && ctx.queues.get(e.queueId)?.name) || "",
        e.tagIds
          .map((id) => ctx.tags.get(id)?.name)
          .filter(Boolean)
          .join(", "),
        e.text,
      ]
        .map(csvText)
        .join(","),
    );
  }
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

/**
 * The download's file name for a view.
 * @param view - The view.
 * @param key - The day it's on.
 * @returns Like "social-calendar-2026-10.csv".
 */
export function calendarCsvName(view: CalendarView, key: string): string {
  if (view === "month") return `social-calendar-${key.slice(0, 7)}.csv`;
  if (view === "week") return `social-calendar-week-of-${mondayKey(key)}.csv`;
  return `social-calendar-${key}.csv`;
}
