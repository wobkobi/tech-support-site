"use client";
// src/features/social/components/CalendarWeek.tsx
// The week view: seven day columns on a time scale (6am to 10pm unless something falls outside),
// with posts placed at their time. Dropping on a column picks the time from the drop height,
// snapped to 15 minutes; a line shows where it will land.

import { CalendarChip, MovableChip } from "@/features/social/components/CalendarChip";
import type { CalendarDrop } from "@/features/social/components/calendar-drag";
import {
  canMove,
  weekKeys,
  type CalendarEntry,
  type ColourContext,
  type ColourMode,
} from "@/features/social/lib/calendar";
import { minuteLabel } from "@/features/social/lib/queue-slots";
import { cn } from "@/shared/lib/cn";
import { dateKeyParts, nzMinuteOfDay } from "@/shared/lib/timezone-utils";
import { useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import type React from "react";

/** The grid's scale: an hour is 60px tall. */
export const PX_PER_MINUTE = 1;
/** A chip's height, which is also how close two posts can be before they sit side by side. */
const CHIP_PX = 36;
const HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Where a drag would land, for the guide line. */
export interface DropHint {
  key: string;
  minute: number;
}

/** What every column shares. */
interface ColumnShared {
  today: string;
  hours: { start: number; end: number };
  mode: ColourMode;
  ctx: ColourContext;
  now: Date;
  hint: DropHint | null;
  onOpenSlot: (entry: CalendarEntry) => void;
}

/**
 * Side-by-side lanes for a day's chips, so posts close together don't cover each other.
 * @param entries - The day's entries in time order.
 * @param start - First hour shown.
 * @returns Each entry's top in px and lane, and how many lanes the day needs.
 */
function layOut(
  entries: readonly CalendarEntry[],
  start: number,
): { placed: { entry: CalendarEntry; top: number; lane: number }[]; lanes: number } {
  const ends: number[] = [];
  const placed = entries.map((entry) => {
    const top = (nzMinuteOfDay(new Date(entry.at)) - start * 60) * PX_PER_MINUTE;
    let lane = ends.findIndex((end) => end <= top);
    if (lane === -1) lane = ends.push(0) - 1;
    ends[lane] = top + CHIP_PX;
    return { entry, top, lane };
  });
  return { placed, lanes: Math.max(1, ends.length) };
}

/**
 * Week grid.
 * @param props - Component props.
 * @param props.dayKey - Any day of the week.
 * @param props.byDay - Entries by NZ day, in time order.
 * @param props.dayHref - The day view's address for a day.
 * @param props.today - Today's key.
 * @param props.hours - The hours shown.
 * @param props.mode - What colour stands for.
 * @param props.ctx - Schedule and tag colours.
 * @param props.now - Now.
 * @param props.hint - Where a drag would land.
 * @param props.onOpenSlot - Opens Fill this time.
 * @returns The grid.
 */
export function CalendarWeek({
  dayKey,
  byDay,
  dayHref,
  ...shared
}: ColumnShared & {
  dayKey: string;
  byDay: ReadonlyMap<string, CalendarEntry[]>;
  dayHref: (key: string) => string;
}): React.ReactElement {
  const days = weekKeys(dayKey);
  const { start, end } = shared.hours;
  const height = (end - start) * 60 * PX_PER_MINUTE;
  const hourMarks = Array.from({ length: end - start }, (_, i) => start + i);

  return (
    <div className="overflow-x-auto rounded-lg border border-admin-border bg-admin-surface">
      <div className="grid min-w-3xl grid-cols-[4.5rem_repeat(7,minmax(0,1fr))]">
        <div className="border-b border-admin-border bg-admin-bg" />
        {days.map((k, i) => {
          const [, , d] = dateKeyParts(k);
          return (
            <Link
              key={k}
              href={dayHref(k)}
              className={cn(
                "border-b border-l border-admin-border bg-admin-bg px-1 py-1.5 text-center text-sm font-semibold hover:text-russian-violet",
                k === shared.today ? "text-russian-violet" : "text-admin-text-secondary",
              )}
            >
              {HEADINGS[i]}{" "}
              <span
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-full",
                  k === shared.today && "bg-russian-violet text-white",
                )}
              >
                {d}
              </span>
            </Link>
          );
        })}
        <div className="relative" style={{ height }} aria-hidden>
          {hourMarks.map((h) => (
            <span
              key={h}
              className="absolute right-2 -translate-y-1/2 text-sm text-admin-muted first:translate-y-0"
              style={{ top: (h - start) * 60 * PX_PER_MINUTE }}
            >
              {minuteLabel(h * 60)}
            </span>
          ))}
        </div>
        {days.map((k) => (
          <WeekColumn
            key={k}
            dayKey={k}
            entries={byDay.get(k) ?? []}
            height={height}
            hourMarks={hourMarks}
            {...shared}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One day's column.
 * @param props - Component props.
 * @param props.dayKey - The day.
 * @param props.entries - Its entries in time order.
 * @param props.height - Column height in px.
 * @param props.hourMarks - The hours shown, for the lines.
 * @param props.today - Today's key.
 * @param props.hours - The hours shown.
 * @param props.mode - What colour stands for.
 * @param props.ctx - Schedule and tag colours.
 * @param props.now - Now.
 * @param props.hint - Where a drag would land.
 * @param props.onOpenSlot - Opens Fill this time.
 * @returns The column.
 */
function WeekColumn({
  dayKey,
  entries,
  height,
  hourMarks,
  today,
  hours,
  mode,
  ctx,
  now,
  hint,
  onOpenSlot,
}: ColumnShared & {
  dayKey: string;
  entries: CalendarEntry[];
  height: number;
  hourMarks: number[];
}): React.ReactElement {
  const past = dayKey < today;
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${dayKey}`,
    data: {
      kind: "column",
      key: dayKey,
      start: hours.start,
      end: hours.end,
      pxPerMinute: PX_PER_MINUTE,
    } satisfies CalendarDrop,
    disabled: past,
  });
  const { placed, lanes } = layOut(entries, hours.start);
  const guide = isOver && hint?.key === dayKey ? hint.minute : null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative border-l border-admin-border",
        past && "bg-admin-bg",
        isOver && "bg-russian-violet-50",
      )}
      style={{ height }}
    >
      {hourMarks.map((h) => (
        <div
          key={h}
          aria-hidden
          className="absolute inset-x-0 border-t border-admin-border"
          style={{ top: (h - hours.start) * 60 * PX_PER_MINUTE }}
        />
      ))}
      {guide !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-russian-violet"
          style={{ top: (guide - hours.start * 60) * PX_PER_MINUTE }}
        >
          <span className="absolute -top-3 left-1 rounded bg-russian-violet px-1 text-sm font-semibold text-white">
            {minuteLabel(guide)}
          </span>
        </div>
      )}
      {placed.map(({ entry, top, lane }) => {
        const style: React.CSSProperties = {
          position: "absolute",
          top,
          height: CHIP_PX - 2,
          left: `calc(${(lane / lanes) * 100}% + 2px)`,
          width: `calc(${100 / lanes}% - 4px)`,
        };
        const props = { entry, mode, ctx, onOpenSlot, style, className: "items-start" };
        return canMove(entry, now) ? (
          <MovableChip key={entry.id} {...props} />
        ) : (
          <CalendarChip key={entry.id} {...props} />
        );
      })}
    </div>
  );
}
