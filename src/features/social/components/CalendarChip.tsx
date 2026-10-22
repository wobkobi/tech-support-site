"use client";
// src/features/social/components/CalendarChip.tsx
// One post or open time on the calendar: a link that opens the post, or a dashed button that
// fills the open time. A post that can still move is draggable to another day or time. Reels,
// stories and cover photos carry an icon for their kind.

import type { CalendarDrag } from "@/features/social/components/calendar-drag";
import {
  CALENDAR_STATUS,
  colourOf,
  timeOfDay,
  type CalendarEntry,
  type ColourContext,
  type ColourMode,
} from "@/features/social/lib/calendar";
import { postHref } from "@/features/social/lib/links";
import { FORMAT_LABEL, type SocialFormatKey } from "@/features/social/lib/media";
import { TAG_COLOURS } from "@/features/social/lib/tags";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import { useDraggable, type DraggableAttributes } from "@dnd-kit/core";
import Link from "next/link";
import type React from "react";
import type { IconType } from "react-icons";
import { FaCheck, FaFilm, FaImage, FaMobileScreen, FaTriangleExclamation } from "react-icons/fa6";

/** The icon for each kind of post besides an ordinary one. */
export const FORMAT_ICON: Record<Exclude<SocialFormatKey, "feed">, IconType> = {
  reel: FaFilm,
  story: FaMobileScreen,
  cover: FaImage,
};

/** What a chip needs to show an entry. */
export interface ChipProps {
  entry: CalendarEntry;
  mode: ColourMode;
  ctx: ColourContext;
  /** Opens Fill this time for an open time. */
  onOpenSlot: (entry: CalendarEntry) => void;
  className?: string;
  style?: React.CSSProperties;
}

/** Drag wiring from {@link MovableChip}. */
interface ChipDrag {
  ref: (el: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: ReturnType<typeof useDraggable>["listeners"];
}

/**
 * The words a chip's tooltip and the CSV share: status, apps, schedule and views.
 * @param entry - The entry.
 * @param ctx - Schedule names.
 * @returns Plain words.
 */
export function entryDetail(entry: CalendarEntry, ctx: ColourContext): string {
  const parts = [
    entry.status === "open" && entry.later
      ? "Fills nearer the time"
      : CALENDAR_STATUS[entry.status].label,
    entry.platforms.map((p) => PLATFORM_LABEL[p]).join(", "),
  ];
  const queue = entry.queueId ? ctx.queues.get(entry.queueId) : undefined;
  if (queue && entry.status !== "open") parts.push(`From ${queue.name}`);
  if (entry.views !== null) parts.push(`${entry.views.toLocaleString("en-NZ")} views`);
  return parts.filter(Boolean).join(" - ");
}

/**
 * Calendar chip.
 * @param props - Component props.
 * @param props.entry - The post or open time.
 * @param props.mode - What colour stands for.
 * @param props.ctx - Schedule and tag colours.
 * @param props.onOpenSlot - Opens Fill this time for an open time.
 * @param props.className - Extra classes.
 * @param props.style - Inline position, for the week grid.
 * @param props.drag - Drag wiring, when it can move.
 * @param props.dragging - Whether it's the one being dragged, which fades it.
 * @returns The chip.
 */
export function CalendarChip({
  entry,
  mode,
  ctx,
  onOpenSlot,
  className,
  style,
  drag,
  dragging,
}: ChipProps & { drag?: ChipDrag; dragging?: boolean }): React.ReactElement {
  const time = timeOfDay(entry.at);
  const title = `${time} ${entry.name} - ${entryDetail(entry, ctx)}`;
  const base =
    "flex min-h-8 w-full min-w-0 items-center overflow-hidden gap-1 rounded-md border px-1.5 py-0.5 text-left text-sm leading-tight";

  if (entry.status === "open") {
    return (
      <button
        type="button"
        onClick={() => onOpenSlot(entry)}
        title={`${title}. Fill this time.`}
        style={style}
        className={cn(
          base,
          "border-dashed border-admin-border-strong bg-admin-surface text-admin-muted hover:border-russian-violet hover:text-russian-violet",
          className,
        )}
      >
        <span className="shrink-0 font-semibold">{time}</span>
        <span className="truncate">{entry.later ? "Fills later" : "Open"}</span>
      </button>
    );
  }

  const colour = TAG_COLOURS[colourOf(entry, mode, ctx)];
  const problem = entry.status === "failed" || entry.status === "partial";
  const KindIcon = entry.format === "feed" ? null : FORMAT_ICON[entry.format];
  return (
    <Link
      ref={drag?.ref}
      href={postHref({ id: entry.id })}
      title={title}
      style={style}
      {...drag?.attributes}
      {...drag?.listeners}
      // The link keeps its own role; the drag hook would make it a button.
      role={undefined}
      className={cn(
        base,
        colour.chip,
        drag && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        className,
      )}
    >
      {entry.status === "posted" && <FaCheck aria-hidden className="size-3 shrink-0" />}
      {problem && <FaTriangleExclamation aria-hidden className="size-3 shrink-0" />}
      <span className="sr-only">{CALENDAR_STATUS[entry.status].label}, </span>
      {KindIcon && (
        <>
          <KindIcon aria-hidden className="size-3 shrink-0" />
          <span className="sr-only">{FORMAT_LABEL[entry.format]}, </span>
        </>
      )}
      <span className="shrink-0 font-semibold">{time}</span>
      <span className={cn("truncate", entry.status === "removed" && "line-through")}>
        {entry.name}
      </span>
    </Link>
  );
}

/**
 * A chip that can be dragged to another day or time.
 * @param props - Chip props.
 * @returns The draggable chip.
 */
export function MovableChip(props: ChipProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `post:${props.entry.id}`,
    data: { kind: "post", entry: props.entry } satisfies CalendarDrag,
  });
  return (
    <CalendarChip
      {...props}
      drag={{ ref: setNodeRef, attributes, listeners }}
      dragging={isDragging}
    />
  );
}
