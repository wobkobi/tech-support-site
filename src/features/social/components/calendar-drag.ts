// src/features/social/components/calendar-drag.ts
// What the calendar's drag and drop carries: the thing picked up, and where it can land.

import type { CalendarEntry, CalendarItem } from "@/features/social/lib/calendar";

/** Something picked up: a scheduled post, or a content item from the side panel. */
export type CalendarDrag =
  { kind: "post"; entry: CalendarEntry } | { kind: "item"; item: CalendarItem };

/**
 * A place to drop: a whole day (the post keeps its time of day), a week column (the drop height
 * sets the time), or an Instagram grid tile (the two swap times).
 */
export type CalendarDrop =
  | { kind: "day"; key: string }
  | { kind: "column"; key: string; start: number; end: number; pxPerMinute: number }
  | { kind: "tile"; entry: CalendarEntry };
