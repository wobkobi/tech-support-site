"use client";
// src/features/social/components/CalendarDay.tsx
// The day view: the day's posts and open times as a list with their picture, apps and words.
// Dropping content on it schedules it that day.

import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { AppIcons } from "@/features/social/components/AppIcons";

import type { CalendarDrop } from "@/features/social/components/calendar-drag";
import {
  CALENDAR_STATUS,
  timeOfDay,
  type CalendarEntry,
  type ColourContext,
} from "@/features/social/lib/calendar";
import { postHref } from "@/features/social/lib/links";
import { POST_STATUS_PILL } from "@/features/social/lib/post-display";
import { cn } from "@/shared/lib/cn";
import { useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import type React from "react";
import { FaImage } from "react-icons/fa6";

/**
 * Day list.
 * @param props - Component props.
 * @param props.dayKey - The day.
 * @param props.today - Today's key.
 * @param props.entries - Its entries in time order.
 * @param props.ctx - Schedule names.
 * @param props.onOpenSlot - Opens Fill this time.
 * @returns The list.
 */
export function CalendarDay({
  dayKey,
  today,
  entries,
  ctx,
  onOpenSlot,
}: {
  dayKey: string;
  today: string;
  entries: CalendarEntry[];
  ctx: ColourContext;
  onOpenSlot: (entry: CalendarEntry) => void;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${dayKey}`,
    data: { kind: "day", key: dayKey } satisfies CalendarDrop,
    disabled: dayKey < today,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-40 rounded-lg border border-admin-border bg-admin-surface p-3",
        isOver && "bg-russian-violet-50 ring-2 ring-russian-violet ring-inset",
      )}
    >
      {entries.length === 0 ? (
        <p className="py-10 text-center text-base text-admin-muted">
          Nothing on this day.
          {dayKey >= today && " Drag content here from the side to schedule it."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <DayRow key={e.id} entry={e} ctx={ctx} onOpenSlot={onOpenSlot} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One post or open time in the day list.
 * @param props - Component props.
 * @param props.entry - The entry.
 * @param props.ctx - Schedule names.
 * @param props.onOpenSlot - Opens Fill this time.
 * @returns The row.
 */
function DayRow({
  entry,
  ctx,
  onOpenSlot,
}: {
  entry: CalendarEntry;
  ctx: ColourContext;
  onOpenSlot: (entry: CalendarEntry) => void;
}): React.ReactElement {
  const time = timeOfDay(entry.at);
  if (entry.status === "open") {
    return (
      <li className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-admin-border-strong p-3">
        <span className="w-16 shrink-0 font-semibold text-admin-text">{time}</span>
        <span className="min-w-0 flex-1 text-base text-admin-text-secondary">
          Open time in <span className="font-semibold">{entry.name}</span>
          {entry.later && <span className="block text-sm">It fills nearer the time.</span>}
        </span>
        <AppIcons platforms={entry.platforms} className="text-admin-muted" />
        <button
          type="button"
          onClick={() => onOpenSlot(entry)}
          className="text-sm font-semibold text-russian-violet underline-offset-2 hover:underline pointer-coarse:min-h-11"
        >
          Fill this time
        </button>
      </li>
    );
  }

  const pill = statusPill(entry);
  const queue = entry.queueId ? ctx.queues.get(entry.queueId) : undefined;
  return (
    <li className="flex gap-3 rounded-lg border border-admin-border p-3">
      <span className="w-16 shrink-0 pt-0.5 font-semibold text-admin-text">{time}</span>
      {entry.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- Blob picture of unknown size, which next/image needs up front.
        <img
          src={entry.thumb}
          alt=""
          className="size-14 shrink-0 rounded-md border border-admin-border object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-md border border-dashed border-admin-border text-admin-muted"
        >
          <FaImage className="size-4" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={postHref({ id: entry.id })}
            className="font-semibold text-russian-violet underline-offset-2 hover:underline"
          >
            {entry.name}
          </Link>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          <AppIcons platforms={entry.platforms} className="text-admin-muted" />
        </div>
        {entry.text && (
          <p className="line-clamp-2 text-sm whitespace-pre-line text-admin-text-secondary">
            {entry.text}
          </p>
        )}
        {queue && <p className="text-sm text-admin-muted">From {queue.name}</p>}
      </div>
    </li>
  );
}

/**
 * The pill for a post on the calendar, matching the posts list.
 * @param entry - The post.
 * @returns Tone and label.
 */
function statusPill(entry: CalendarEntry): {
  tone: React.ComponentProps<typeof StatusPill>["tone"];
  label: string;
} {
  if (entry.status === "removed") return POST_STATUS_PILL.removed;
  if (entry.status === "open") return { tone: "neutral", label: CALENDAR_STATUS.open.label };
  return POST_STATUS_PILL[entry.status];
}
