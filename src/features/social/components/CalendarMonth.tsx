"use client";
// src/features/social/components/CalendarMonth.tsx
// The month view: Monday-first weeks, up to three posts a day with the rest behind "+N more",
// and coloured dots in place of names on phones. Today and later days take drops.

import { CalendarChip, MovableChip } from "@/features/social/components/CalendarChip";
import type { CalendarDrop } from "@/features/social/components/calendar-drag";
import {
  canMove,
  colourOf,
  monthGrid,
  viewTitle,
  type CalendarEntry,
  type ColourContext,
  type ColourMode,
} from "@/features/social/lib/calendar";
import { TAG_COLOURS } from "@/features/social/lib/tags";
import { cn } from "@/shared/lib/cn";
import { dateKeyParts } from "@/shared/lib/timezone-utils";
import { useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import type React from "react";

/** Chips a day shows before "+N more". */
const SHOWN = 3;
/** Dots a day shows on phones. */
const DOTS = 6;
const HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** What every day cell shares. */
interface DayShared {
  today: string;
  mode: ColourMode;
  ctx: ColourContext;
  now: Date;
  dayHref: (key: string) => string;
  onOpenSlot: (entry: CalendarEntry) => void;
}

/**
 * Month grid.
 * @param props - Component props.
 * @param props.dayKey - Any day of the month.
 * @param props.byDay - Entries by NZ day, in time order.
 * @param props.today - Today's key.
 * @param props.mode - What colour stands for.
 * @param props.ctx - Schedule and tag colours.
 * @param props.now - Now, for which posts can still move.
 * @param props.dayHref - The day view's address for a day.
 * @param props.onOpenSlot - Opens Fill this time for an open time.
 * @returns The grid.
 */
export function CalendarMonth({
  dayKey,
  byDay,
  ...shared
}: DayShared & {
  dayKey: string;
  byDay: ReadonlyMap<string, CalendarEntry[]>;
}): React.ReactElement {
  const month = dayKey.slice(0, 7);
  return (
    <div className="overflow-hidden rounded-lg border-r border-b border-admin-border bg-admin-surface">
      <div className="grid grid-cols-7" aria-hidden>
        {HEADINGS.map((h) => (
          <div
            key={h}
            className="border-t border-l border-admin-border bg-admin-bg px-1 py-1.5 text-center text-sm font-semibold text-admin-text-secondary"
          >
            {h}
          </div>
        ))}
      </div>
      {monthGrid(dayKey).map((week) => (
        <div key={week[0]} className="grid grid-cols-7">
          {week.map((k) => (
            <MonthDay
              key={k}
              dayKey={k}
              inMonth={k.startsWith(month)}
              entries={byDay.get(k) ?? []}
              {...shared}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One day of the month.
 * @param props - Component props.
 * @param props.dayKey - The day.
 * @param props.inMonth - Whether it's in the month shown, not the weeks either side.
 * @param props.entries - Its entries in time order.
 * @param props.today - Today's key.
 * @param props.mode - What colour stands for.
 * @param props.ctx - Schedule and tag colours.
 * @param props.now - Now.
 * @param props.dayHref - The day view's address for a day.
 * @param props.onOpenSlot - Opens Fill this time.
 * @returns The cell.
 */
function MonthDay({
  dayKey,
  inMonth,
  entries,
  today,
  mode,
  ctx,
  now,
  dayHref,
  onOpenSlot,
}: DayShared & {
  dayKey: string;
  inMonth: boolean;
  entries: CalendarEntry[];
}): React.ReactElement {
  const past = dayKey < today;
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${dayKey}`,
    data: { kind: "day", key: dayKey } satisfies CalendarDrop,
    disabled: past,
  });
  const [, , d] = dateKeyParts(dayKey);
  const posts = entries.filter((e) => e.status !== "open").length;
  const shown = entries.slice(0, SHOWN);
  const more = entries.length - shown.length;
  const label = `${viewTitle("day", dayKey)}${
    posts > 0 ? `, ${posts === 1 ? "1 post" : `${posts} posts`}` : ""
  }`;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-16 min-w-0 flex-col gap-1 border-t border-l border-admin-border p-1 sm:min-h-28",
        (!inMonth || past) && "bg-admin-bg",
        isOver && "bg-russian-violet-50 ring-2 ring-russian-violet ring-inset",
      )}
    >
      <Link
        href={dayHref(dayKey)}
        aria-label={label}
        className="flex flex-col gap-1 rounded-md max-sm:flex-1 max-sm:items-center"
      >
        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold",
            dayKey === today
              ? "bg-russian-violet text-white"
              : inMonth
                ? "text-admin-text hover:bg-admin-bg"
                : "text-admin-muted",
          )}
        >
          {d}
        </span>
        {entries.length > 0 && (
          <span aria-hidden className="flex flex-wrap justify-center gap-1 sm:hidden">
            {entries.slice(0, DOTS).map((e) => (
              <span
                key={e.id}
                className={cn(
                  "size-2 rounded-full",
                  e.status === "open"
                    ? "border border-dashed border-admin-muted"
                    : TAG_COLOURS[colourOf(e, mode, ctx)].dot,
                )}
              />
            ))}
          </span>
        )}
      </Link>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-1 max-sm:hidden">
          {shown.map((e) => (
            <li key={e.id}>
              {canMove(e, now) ? (
                <MovableChip entry={e} mode={mode} ctx={ctx} onOpenSlot={onOpenSlot} />
              ) : (
                <CalendarChip entry={e} mode={mode} ctx={ctx} onOpenSlot={onOpenSlot} />
              )}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <Link
          href={dayHref(dayKey)}
          className="px-1 text-sm font-semibold text-russian-violet underline-offset-2 hover:underline max-sm:hidden"
        >
          +{more} more
        </Link>
      )}
    </div>
  );
}
