"use client";
// src/features/social/components/ContentCard.tsx
// One content item in the library's grid: its picture (or a way to design one), name, badges,
// tags and how often it has had postings.

import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { TagChipRow } from "@/features/social/components/TagPicker";
import type { ContentListRow } from "@/features/social/lib/content-row";
import { coverOf } from "@/features/social/lib/cover";
import { postHref } from "@/features/social/lib/links";
import { captionsOf } from "@/features/social/lib/postings-core";
import type { SocialTagRow } from "@/features/social/lib/tags";
import { cn } from "@/shared/lib/cn";
import { formatDateShort, formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";
import { FaPalette } from "react-icons/fa6";

/**
 * A content item's postings so far in a few words.
 * @param stats - Its stats.
 * @returns Plain words.
 */
export function postingsLine(stats: ContentListRow["stats"]): string {
  if (stats.count === 0) return "No postings yet";
  const n = stats.count === 1 ? "1 posting" : `${stats.count} postings`;
  return stats.lastPostedAt ? `${n}, last posted ${formatDateShort(stats.lastPostedAt)}` : n;
}

/**
 * Library card.
 * @param props - Component props.
 * @param props.row - The content item.
 * @param props.tagsById - Every tag, by id.
 * @param props.selected - Whether it's ticked for a bulk change.
 * @param props.onSelect - Ticks or unticks it.
 * @returns List item element.
 */
export function ContentCard({
  row,
  tagsById,
  selected,
  onSelect,
}: {
  row: ContentListRow;
  tagsById: ReadonlyMap<string, SocialTagRow>;
  selected: boolean;
  onSelect: (on: boolean) => void;
}): React.ReactElement {
  const { item, stats, spent } = row;
  const cover = coverOf(item);
  const captions = captionsOf(item).filter((c) => c.trim()).length;
  const name = item.name || "Untitled";

  return (
    <li
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border bg-admin-surface",
        selected ? "border-russian-violet ring-2 ring-russian-violet" : "border-admin-border",
      )}
    >
      {/* Screen-reader text, not aria-label: a typed name in an attribute trips CodeQL. */}
      <label className="absolute top-2 left-2 z-10 flex size-9 cursor-pointer items-center justify-center rounded-md bg-admin-surface/90 shadow-sm">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          className="size-5 accent-russian-violet"
        />
        <span className="sr-only">Select {name}</span>
      </label>
      {cover ? (
        <Link href={postHref(item)} tabIndex={-1} aria-hidden className="block bg-seasalt-100">
          {/* eslint-disable-next-line @next/next/no-img-element -- Blob picture of unknown size, which next/image needs up front. */}
          <img src={cover.url} alt="" className="aspect-4/3 w-full object-cover" />
        </Link>
      ) : (
        <div className="flex aspect-4/3 flex-col items-center justify-center gap-2 bg-seasalt-100 p-4 text-center">
          <p className="text-sm text-admin-text-secondary">No picture yet. Instagram needs one.</p>
          <Link
            href={`/admin/social/design?post=${item.id}`}
            className="inline-flex items-center gap-2 rounded-md border border-admin-border-strong bg-admin-surface px-3 py-1.5 text-sm font-semibold text-admin-text hover:border-russian-violet"
          >
            <FaPalette aria-hidden className="size-3.5" />
            Design a picture
          </Link>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Link
          href={postHref(item)}
          className="font-semibold text-admin-text underline-offset-2 hover:underline"
        >
          {name}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone="neutral">
            {captions === 1 ? "1 caption" : `${captions} captions`}
          </StatusPill>
          {item.recycle && <StatusPill tone="info">Recycling</StatusPill>}
          {spent && <StatusPill tone="warning">Finished</StatusPill>}
        </div>
        <TagChipRow ids={item.tagIds} tagsById={tagsById} />
        <div className="mt-auto text-sm text-admin-muted">
          <p>{postingsLine(stats)}</p>
          {stats.nextAt && <p>Next: {formatDateTimeShort(stats.nextAt)}</p>}
        </div>
      </div>
    </li>
  );
}
