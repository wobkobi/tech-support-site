// src/features/social/lib/calendar.ts
// The Social calendar's date maths, statuses, colours and figures. Pure and client-safe. Days
// are NZ YYYY-MM-DD keys, so a grid never slips a day across daylight saving.

import type { SocialPostStatus } from "@/features/social/lib/post-row";
import { minuteLabel } from "@/features/social/lib/queue-slots";
import type { TagColour } from "@/features/social/lib/tags";
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import {
  addDaysToDateKey,
  dateKeyParts,
  DAY_NAMES,
  nzDateKey,
  nzMinuteOfDay,
  nzWallClockUtc,
  weekdayOf,
} from "@/shared/lib/timezone-utils";

export const CALENDAR_VIEWS = ["month", "week", "day", "grid"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const CALENDAR_VIEW_LABEL: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
  grid: "Instagram grid",
};

export const COLOUR_MODES = ["status", "schedule", "app", "tag"] as const;
export type ColourMode = (typeof COLOUR_MODES)[number];

export const COLOUR_MODE_LABEL: Record<ColourMode, string> = {
  status: "Status",
  schedule: "Schedule",
  app: "App",
  tag: "Tag",
};

/** How a post shows on the calendar, or "open" for a schedule's time with nothing in it yet. */
export type CalendarStatus =
  "scheduled" | "posting" | "posted" | "partial" | "failed" | "removed" | "open";

export const CALENDAR_STATUS: Record<CalendarStatus, { label: string; colour: TagColour }> = {
  scheduled: { label: "Scheduled", colour: "blue" },
  posting: { label: "Posting", colour: "violet" },
  posted: { label: "Posted", colour: "teal" },
  partial: { label: "Partly posted", colour: "yellow" },
  failed: { label: "Failed", colour: "orange" },
  removed: { label: "Taken down", colour: "grey" },
  open: { label: "Open time", colour: "grey" },
};

const APP_COLOUR: Record<SocialPlatformKey, TagColour> = {
  facebook: "blue",
  instagram: "violet",
  google: "yellow",
};

/** A post on more than one app, when colouring by app. */
const SEVERAL_APPS: TagColour = "teal";

/** The week grid's hours when nothing falls outside them: 6am to 10pm. */
export const WEEK_HOURS = { start: 6, end: 22 } as const;

/** How soon a post can be moved to: the schedule route's own minimum. */
export const MIN_LEAD_MS = 60_000;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** One thing on the calendar: a post, or an open time a schedule hasn't filled. */
export interface CalendarEntry {
  /** The post's id, or `open:<scheduleId>:<ms>` for an open time. */
  id: string;
  /** When it goes or went out, as an ISO time. */
  at: string;
  status: CalendarStatus;
  /** The post's name, or the schedule's for an open time. */
  name: string;
  /** The words it goes out with; empty for an open time. */
  text: string;
  /** Apps it's switched on for, or the schedule's apps. */
  platforms: SocialPlatformKey[];
  /** The schedule it came from or belongs to. */
  queueId: string | null;
  /** A posting's content item. */
  sourceId: string | null;
  tagIds: string[];
  /** Its picture, if it has one. */
  thumb: string | null;
  /** An open time further ahead than schedules line up, so it fills nearer the time. */
  later: boolean;
}

/** A content item in the calendar's side panel, ready to drag onto a day. */
export interface CalendarItem {
  id: string;
  name: string;
  captions: string[];
  /** The caption next in turn. */
  next: number;
  thumb: string | null;
  /** Past its last day or at its limit, so nothing more goes out from it. */
  spent: boolean;
  /** The schedules it's in. */
  queueIds: string[];
}

/** A schedule as the calendar needs it: its key colour, and its items for Fill this time. */
export interface CalendarSchedule {
  id: string;
  name: string;
  colour: TagColour;
  itemIds: string[];
}

/** Names and colours of schedules and tags, for colouring entries and the key. */
export interface ColourContext {
  queues: ReadonlyMap<string, { name: string; colour: TagColour }>;
  tags: ReadonlyMap<string, { name: string; colour: TagColour }>;
}

/** One line of the colour key. */
export interface LegendItem {
  colour: TagColour;
  label: string;
}

/** What the calendar's Stats tab shows for the days on screen. */
export interface RangeStats {
  scheduled: number;
  posted: number;
  /** Failed or partly posted. */
  problems: number;
  removed: number;
  /** Open times that should have a post by now. */
  open: number;
  /** Open times that fill nearer the time. */
  later: number;
  /** Posts per app, open times left out. */
  byApp: Record<SocialPlatformKey, number>;
}

/**
 * Where a post's status puts it on the calendar.
 * @param status - Post status.
 * @returns Calendar status, or null for a draft, which isn't on the calendar.
 */
export function calendarStatus(status: SocialPostStatus): CalendarStatus | null {
  switch (status) {
    case "draft":
      return null;
    case "removing":
    case "removed":
      return "removed";
    default:
      return status;
  }
}

/**
 * Whether an entry can be dragged to another time: still scheduled, and not about to go.
 * @param entry - The entry.
 * @param entry.status - Its calendar status.
 * @param entry.at - When it goes out.
 * @param now - Now.
 * @returns True when it can move.
 */
export function canMove(entry: { status: CalendarStatus; at: string }, now: Date): boolean {
  return entry.status === "scheduled" && Date.parse(entry.at) >= now.getTime() + MIN_LEAD_MS;
}

/**
 * The weekday of a date key.
 * @param key - YYYY-MM-DD.
 * @returns 0 for Sunday to 6 for Saturday.
 */
function weekdayOfKey(key: string): number {
  const [y, m, d] = dateKeyParts(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The Monday on or before a date.
 * @param key - YYYY-MM-DD.
 * @returns The Monday's key.
 */
export function mondayKey(key: string): string {
  return addDaysToDateKey(key, -((weekdayOfKey(key) + 6) % 7));
}

/**
 * The seven days of a date's week, Monday first.
 * @param key - Any day of the week.
 * @returns Seven keys.
 */
export function weekKeys(key: string): string[] {
  const monday = mondayKey(key);
  return Array.from({ length: 7 }, (_, i) => addDaysToDateKey(monday, i));
}

/**
 * The weeks a month view shows: Monday-first rows from the week holding the 1st to the week
 * holding the last day, so a month takes four to six rows.
 * @param key - Any day of the month.
 * @returns Rows of seven keys.
 */
export function monthGrid(key: string): string[][] {
  const month = key.slice(0, 7);
  const weeks: string[][] = [];
  let monday = mondayKey(`${month}-01`);
  // The first row's Monday can fall in the month before, so the first push doesn't check it.
  while (weeks.length === 0 || monday.startsWith(month)) {
    weeks.push(weekKeys(monday));
    monday = addDaysToDateKey(monday, 7);
  }
  return weeks;
}

/**
 * The first and last days a view covers.
 * @param view - The view.
 * @param key - The day it's on.
 * @returns Inclusive keys; the grid and day views cover the one day.
 */
export function viewDays(view: CalendarView, key: string): { from: string; to: string } {
  if (view === "month") {
    const grid = monthGrid(key);
    return { from: grid[0]![0]!, to: grid[grid.length - 1]![6]! };
  }
  if (view === "week") {
    const week = weekKeys(key);
    return { from: week[0]!, to: week[6]! };
  }
  return { from: key, to: key };
}

/**
 * The day one step back or on: a month (to its 1st), a week or a day.
 * @param view - The view.
 * @param key - The day it's on.
 * @param step - 1 for on, -1 for back.
 * @returns The new day's key; the grid doesn't step.
 */
export function stepKey(view: CalendarView, key: string, step: 1 | -1): string {
  if (view === "month") {
    const [y, m] = dateKeyParts(key);
    return new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 10);
  }
  if (view === "grid") return key;
  return addDaysToDateKey(key, (view === "week" ? 7 : 1) * step);
}

/**
 * A view's heading: "October 2026", "19-25 Oct 2026" or "Thursday 22 October 2026".
 * @param view - The view.
 * @param key - The day it's on.
 * @returns The heading.
 */
export function viewTitle(view: CalendarView, key: string): string {
  const [y, m, d] = dateKeyParts(key);
  if (view === "month") return `${MONTHS[m - 1]} ${y}`;
  if (view === "day") {
    return `${DAY_NAMES[weekdayOf(new Date(Date.UTC(y, m - 1, d)))]} ${d} ${MONTHS[m - 1]} ${y}`;
  }
  if (view === "grid") return CALENDAR_VIEW_LABEL.grid;
  const week = weekKeys(key);
  const [y1, m1, d1] = dateKeyParts(week[0]!);
  const [y2, m2, d2] = dateKeyParts(week[6]!);
  /**
   * A month's short name.
   * @param month - 1-12.
   * @returns Like "Oct".
   */
  const short = (month: number): string => MONTHS[month - 1]!.slice(0, 3);
  if (y1 !== y2) return `${d1} ${short(m1)} ${y1} - ${d2} ${short(m2)} ${y2}`;
  if (m1 !== m2) return `${d1} ${short(m1)} - ${d2} ${short(m2)} ${y2}`;
  return `${d1}-${d2} ${short(m2)} ${y2}`;
}

/**
 * A day's short heading.
 * @param key - YYYY-MM-DD.
 * @returns Like "Thu 22".
 */
export function shortDay(key: string): string {
  const [y, m, d] = dateKeyParts(key);
  return `${DAY_NAMES[weekdayOf(new Date(Date.UTC(y, m - 1, d)))].slice(0, 3)} ${d}`;
}

/**
 * Orders entries by time, then name.
 * @param a - One entry.
 * @param b - The other.
 * @returns Sort order.
 */
export function byTime(a: CalendarEntry, b: CalendarEntry): number {
  return Date.parse(a.at) - Date.parse(b.at) || a.name.localeCompare(b.name);
}

/**
 * Entries grouped by their NZ day, each day in time order.
 * @param entries - Entries in any order.
 * @returns Day key > entries.
 */
export function entriesByDay(entries: readonly CalendarEntry[]): Map<string, CalendarEntry[]> {
  const out = new Map<string, CalendarEntry[]>();
  for (const e of [...entries].sort(byTime)) {
    const key = nzDateKey(new Date(e.at));
    const list = out.get(key);
    if (list) list.push(e);
    else out.set(key, [e]);
  }
  return out;
}

/**
 * An instant's NZ time of day in words.
 * @param at - ISO time.
 * @returns Like "9:00am".
 */
export function timeOfDay(at: string): string {
  return minuteLabel(nzMinuteOfDay(new Date(at)));
}

/**
 * A time on an NZ date, as an instant, with that date's own daylight saving offset.
 * @param key - YYYY-MM-DD.
 * @param minute - Minutes after NZ midnight.
 * @returns The instant.
 */
export function atMinute(key: string, minute: number): Date {
  const [y, m, d] = dateKeyParts(key);
  return nzWallClockUtc(y, m, d, Math.floor(minute / 60), minute % 60);
}

/**
 * The same NZ time of day on another date, for a post dragged to another day.
 * @param at - Its time now.
 * @param key - The day it's dropped on.
 * @returns The new instant.
 */
export function onDay(at: Date, key: string): Date {
  return atMinute(key, nzMinuteOfDay(at));
}

/**
 * The hours the week grid shows: 6am to 10pm, widened to whole hours that take in every entry.
 * @param entries - The week's entries.
 * @returns Start hour and end hour (exclusive).
 */
export function weekHours(entries: readonly CalendarEntry[]): { start: number; end: number } {
  let start: number = WEEK_HOURS.start;
  let end: number = WEEK_HOURS.end;
  for (const e of entries) {
    const hour = Math.floor(nzMinuteOfDay(new Date(e.at)) / 60);
    start = Math.min(start, hour);
    end = Math.max(end, hour + 1);
  }
  return { start, end };
}

/**
 * The time a drop lands on in the week grid, snapped to 15 minutes and kept inside the hours shown.
 * @param offsetPx - How far down the day column the dropped chip's top edge is.
 * @param pxPerMinute - The grid's scale.
 * @param hours - The hours shown.
 * @param hours.start - First hour.
 * @param hours.end - Hour after the last.
 * @returns Minutes after NZ midnight.
 */
export function dropMinute(
  offsetPx: number,
  pxPerMinute: number,
  hours: { start: number; end: number },
): number {
  const snapped = Math.round((hours.start * 60 + offsetPx / pxPerMinute) / 15) * 15;
  return Math.min(Math.max(snapped, hours.start * 60), hours.end * 60 - 15);
}

/**
 * The swatch an entry takes under a colour mode.
 * @param entry - The entry.
 * @param mode - What colour stands for.
 * @param ctx - Schedule and tag colours.
 * @returns Swatch key; grey when the entry has no schedule or tag.
 */
export function colourOf(entry: CalendarEntry, mode: ColourMode, ctx: ColourContext): TagColour {
  switch (mode) {
    case "status":
      return CALENDAR_STATUS[entry.status].colour;
    case "schedule":
      return (entry.queueId && ctx.queues.get(entry.queueId)?.colour) || "grey";
    case "app":
      return entry.platforms.length === 1 ? APP_COLOUR[entry.platforms[0]!] : SEVERAL_APPS;
    case "tag":
      return entry.tagIds.map((id) => ctx.tags.get(id)?.colour).find(Boolean) ?? "grey";
  }
}

/**
 * The colour key for what's on screen: one line per value the entries use, in a steady order.
 * Open times have their own dashed key, so they're left out here.
 * @param entries - Entries on screen.
 * @param mode - What colour stands for.
 * @param ctx - Schedule and tag names and colours.
 * @returns Key lines.
 */
export function legendOf(
  entries: readonly CalendarEntry[],
  mode: ColourMode,
  ctx: ColourContext,
): LegendItem[] {
  const posts = entries.filter((e) => e.status !== "open");
  switch (mode) {
    case "status": {
      const used = new Set(posts.map((e) => e.status));
      return (Object.keys(CALENDAR_STATUS) as CalendarStatus[])
        .filter((s) => used.has(s))
        .map((s) => CALENDAR_STATUS[s]);
    }
    case "schedule": {
      const ids = new Set(posts.map((e) => e.queueId));
      const out = [...ctx.queues]
        .filter(([id]) => ids.has(id))
        .map(([, q]) => ({ colour: q.colour, label: q.name }));
      // A schedule deleted since counts as none.
      if (posts.some((e) => !e.queueId || !ctx.queues.has(e.queueId))) {
        out.push({ colour: "grey", label: "Not from a schedule" });
      }
      return out;
    }
    case "app": {
      const out: LegendItem[] = SOCIAL_PLATFORMS.filter((p) =>
        posts.some((e) => e.platforms.length === 1 && e.platforms[0] === p),
      ).map((p) => ({ colour: APP_COLOUR[p], label: PLATFORM_LABEL[p] }));
      if (posts.some((e) => e.platforms.length !== 1)) {
        out.push({ colour: SEVERAL_APPS, label: "More than one app" });
      }
      return out;
    }
    case "tag": {
      const firsts = new Set(posts.map((e) => e.tagIds.find((id) => ctx.tags.has(id)) ?? null));
      const out = [...ctx.tags]
        .filter(([id]) => firsts.has(id))
        .map(([, t]) => ({ colour: t.colour, label: t.name }));
      if (firsts.has(null)) out.push({ colour: "grey", label: "No tag" });
      return out;
    }
  }
}

/**
 * Figures for the days on screen.
 * @param entries - Entries on screen.
 * @returns The figures.
 */
export function rangeStats(entries: readonly CalendarEntry[]): RangeStats {
  const out: RangeStats = {
    scheduled: 0,
    posted: 0,
    problems: 0,
    removed: 0,
    open: 0,
    later: 0,
    byApp: { facebook: 0, instagram: 0, google: 0 },
  };
  for (const e of entries) {
    if (e.status === "open") {
      if (e.later) out.later++;
      else out.open++;
      continue;
    }
    if (e.status === "scheduled" || e.status === "posting") out.scheduled++;
    else if (e.status === "posted") out.posted++;
    else if (e.status === "partial" || e.status === "failed") out.problems++;
    else out.removed++;
    for (const p of e.platforms) out.byApp[p]++;
  }
  return out;
}

/**
 * Reads the view from the address.
 * @param value - The `view` param.
 * @returns The view; month when missing or unknown.
 */
export function readView(value: unknown): CalendarView {
  return (CALENDAR_VIEWS as readonly unknown[]).includes(value) ? (value as CalendarView) : "month";
}

/**
 * Reads the colour mode from the address.
 * @param value - The `colour` param.
 * @returns The mode; status when missing or unknown.
 */
export function readColourMode(value: unknown): ColourMode {
  return (COLOUR_MODES as readonly unknown[]).includes(value) ? (value as ColourMode) : "status";
}

/**
 * Reads the day from the address.
 * @param value - The `date` param.
 * @param today - Today's key, used when it's missing or not a real date.
 * @returns A YYYY-MM-DD key.
 */
export function readDayKey(value: unknown, today: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  // Round-trips through a date so 2026-02-30 doesn't pass.
  const [y, m, d] = dateKeyParts(value);
  const real = new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  return real === value ? value : today;
}
