"use client";
// src/features/social/components/InstagramGrid.tsx
// The Instagram grid: three columns, newest top-left, scheduled posts above the ones that went
// out, as the profile will show them. Drag one scheduled tile onto another to swap their times.

import type { CalendarDrag, CalendarDrop } from "@/features/social/components/calendar-drag";
import { canMove, type CalendarEntry } from "@/features/social/lib/calendar";
import { postHref } from "@/features/social/lib/links";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import type React from "react";
import { FaClock, FaFilm } from "react-icons/fa6";

/** Tile shape: Instagram's profile grid shows 3:4, older profiles square. */
export type TileShape = "tall" | "square";

/**
 * Instagram grid.
 * @param props - Component props.
 * @param props.tiles - Scheduled posts (furthest ahead first), then posted ones (newest first).
 * @param props.shape - Tile shape.
 * @param props.now - Now, for which posts can still move.
 * @returns The grid.
 */
export function InstagramGrid({
  tiles,
  shape,
  now,
}: {
  tiles: CalendarEntry[];
  shape: TileShape;
  now: Date;
}): React.ReactElement {
  if (tiles.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-admin-border-strong p-10 text-center text-base text-admin-muted">
        Nothing for Instagram yet. Posts switched on for Instagram show here once they&apos;re
        scheduled or posted.
      </p>
    );
  }
  return (
    <ul className="mx-auto grid max-w-3xl grid-cols-3 gap-0.5 sm:gap-1">
      {tiles.map((t) => (
        <Tile key={t.id} entry={t} shape={shape} movable={canMove(t, now)} />
      ))}
    </ul>
  );
}

/**
 * One tile; a scheduled one is both picked up and dropped on.
 * @param props - Component props.
 * @param props.entry - The post.
 * @param props.shape - Tile shape.
 * @param props.movable - Whether it can still swap.
 * @returns The tile.
 */
function Tile({
  entry,
  shape,
  movable,
}: {
  entry: CalendarEntry;
  shape: TileShape;
  movable: boolean;
}): React.ReactElement {
  // Destructured, since the React Compiler treats a whole hook result holding a ref as a ref.
  const { setNodeRef, attributes, listeners, isDragging, active } = useDraggable({
    id: `tile:${entry.id}`,
    data: { kind: "post", entry } satisfies CalendarDrag,
    disabled: !movable,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `tile:${entry.id}`,
    data: { kind: "tile", entry } satisfies CalendarDrop,
    disabled: !movable,
  });
  const ahead = entry.status === "scheduled" || entry.status === "posting";
  const over = isOver && active?.id !== `tile:${entry.id}`;

  return (
    <li
      ref={setDropRef}
      className={cn(
        "relative overflow-hidden bg-admin-bg",
        shape === "tall" ? "aspect-3/4" : "aspect-square",
        over && "ring-4 ring-russian-violet ring-inset",
      )}
    >
      <Link
        ref={setNodeRef}
        href={postHref({ id: entry.id })}
        title={`${entry.name}${ahead ? ` - goes out ${formatDateTimeShort(entry.at)}` : ""}`}
        {...(movable ? { ...attributes, ...listeners } : {})}
        role={undefined}
        className={cn(
          "block size-full",
          movable && "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-40",
        )}
      >
        {entry.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- Blob picture of unknown size, which next/image needs up front.
          <img src={entry.thumb} alt={entry.name} className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center p-2 text-center text-sm text-admin-muted">
            {entry.name}
          </span>
        )}
        {entry.format === "reel" && (
          <span className="absolute top-1.5 right-1.5 rounded-full bg-rich-black/60 p-1.5 text-white">
            <FaFilm aria-hidden className="size-3.5" />
            <span className="sr-only">Reel</span>
          </span>
        )}
        {ahead && (
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-rich-black/75 px-1.5 py-1 text-sm font-semibold text-white">
            <FaClock aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{formatDateTimeShort(entry.at)}</span>
          </span>
        )}
      </Link>
    </li>
  );
}
