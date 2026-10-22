"use client";
// src/features/social/components/CalendarSidePanel.tsx
// The calendar's side column: content to drag onto a day (or schedule with a button), and the
// figures for the days on screen.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card } from "@/features/admin/components/ui/Card";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { StickyRail } from "@/features/admin/components/ui/StickyRail";
import type { CalendarDrag } from "@/features/social/components/calendar-drag";
import type { CalendarItem, RangeStats } from "@/features/social/lib/calendar";
import { foldText } from "@/features/social/lib/library";
import { SOCIAL_CONTENT_PATH } from "@/features/social/lib/links";
import { PLATFORM_LABEL, SOCIAL_PLATFORMS } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import { useDraggable } from "@dnd-kit/core";
import Link from "next/link";
import type React from "react";
import { useId, useState } from "react";
import { FaGripVertical, FaImage } from "react-icons/fa6";

type PanelTab = "content" | "stats";

/**
 * Side panel.
 * @param props - Component props.
 * @param props.items - Content items, A to Z.
 * @param props.stats - Figures for the days on screen.
 * @param props.range - The heading the figures are for, such as "October 2026".
 * @param props.onSchedule - Opens the posting dialog for an item.
 * @returns The panel.
 */
export function CalendarSidePanel({
  items,
  stats,
  range,
  onSchedule,
}: {
  items: CalendarItem[];
  stats: RangeStats;
  range: string;
  onSchedule: (item: CalendarItem) => void;
}): React.ReactElement {
  const id = useId();
  const [tab, setTab] = useState<PanelTab>("content");
  return (
    <StickyRail>
      <Card padding="sm" className="flex flex-col gap-3">
        <div
          role="tablist"
          aria-label="Side panel"
          className={cn(SEGMENTED_GROUP_CLS, "self-start")}
        >
          {(
            [
              ["content", "Content"],
              ["stats", "Figures"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${id}-${key}`}
              aria-selected={tab === key}
              aria-controls={`${id}-panel`}
              onClick={() => setTab(key)}
              className={segmentedButtonClass(tab === key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
          {tab === "content" ? (
            <ContentList items={items} onSchedule={onSchedule} />
          ) : (
            <Figures stats={stats} range={range} />
          )}
        </div>
      </Card>
    </StickyRail>
  );
}

/**
 * Searchable content list.
 * @param props - Component props.
 * @param props.items - Content items, A to Z.
 * @param props.onSchedule - Opens the posting dialog for an item.
 * @returns The list.
 */
function ContentList({
  items,
  onSchedule,
}: {
  items: CalendarItem[];
  onSchedule: (item: CalendarItem) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const shown = items.filter((item) => {
    const hay = foldText(`${item.name} ${item.captions.join(" ")}`);
    return words.every((w) => hay.includes(w));
  });

  if (items.length === 0) {
    return (
      <p className="text-sm text-admin-text-secondary">
        No content yet. Save posts you&apos;ll use again in{" "}
        <Link href={SOCIAL_CONTENT_PATH} className="font-semibold text-russian-violet underline">
          Content
        </Link>
        , then drag them onto a day here.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <AdminInput
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search content"
        aria-label="Search content"
      />
      <p className="text-sm text-admin-muted">
        Drag an item onto a day to schedule it there, or press Schedule.
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-admin-muted">Nothing matches.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <ItemRow key={item.id} item={item} onSchedule={onSchedule} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One draggable content item.
 * @param props - Component props.
 * @param props.item - The item.
 * @param props.onSchedule - Opens the posting dialog for it.
 * @returns The row.
 */
function ItemRow({
  item,
  onSchedule,
}: {
  item: CalendarItem;
  onSchedule: (item: CalendarItem) => void;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item:${item.id}`,
    data: { kind: "item", item } satisfies CalendarDrag,
    disabled: item.spent,
  });
  const captions = item.captions.filter((c) => c.trim()).length;
  return (
    <li
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 rounded-md border border-admin-border bg-admin-surface p-2",
        isDragging && "opacity-40",
      )}
    >
      <div
        {...(item.spent ? {} : { ...attributes, ...listeners })}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2",
          !item.spent && "cursor-grab active:cursor-grabbing",
        )}
      >
        {!item.spent && (
          <FaGripVertical aria-hidden className="size-3.5 shrink-0 text-admin-muted" />
        )}
        {item.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- Blob picture of unknown size, which next/image needs up front.
          <img src={item.thumb} alt="" className="size-10 shrink-0 rounded object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded border border-dashed border-admin-border text-admin-muted"
          >
            <FaImage className="size-3.5" />
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-admin-text">{item.name}</span>
          <span className="block text-sm text-admin-muted">
            {item.spent ? "Finished" : captions === 1 ? "1 caption" : `${captions} captions`}
          </span>
        </span>
      </div>
      {!item.spent && (
        <AdminButton variant="ghost" size="xs" onClick={() => onSchedule(item)}>
          Schedule
        </AdminButton>
      )}
    </li>
  );
}

/**
 * Figures for the days on screen.
 * @param props - Component props.
 * @param props.stats - The figures.
 * @param props.range - What they're for.
 * @returns The list.
 */
function Figures({ stats, range }: { stats: RangeStats; range: string }): React.ReactElement {
  const rows: [string, number, string?][] = [
    ["Scheduled", stats.scheduled],
    ["Posted", stats.posted],
    ["Failed or partly posted", stats.problems],
    ["Taken down", stats.removed],
    [
      "Open times",
      stats.open,
      stats.later > 0
        ? `${stats.later === 1 ? "1 more fills" : `${stats.later} more fill`} nearer the time`
        : undefined,
    ],
    [
      "Views",
      stats.views,
      stats.viewed > 0
        ? `From ${stats.viewed} post${stats.viewed === 1 ? "" : "s"} with figures`
        : "None read yet",
    ],
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-admin-text-secondary">{range}</p>
      <dl className="flex flex-col gap-2">
        {rows.map(([label, value, sub]) => (
          <div key={label} className="flex flex-col">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-sm text-admin-text-secondary">{label}</dt>
              <dd className="text-base font-bold text-admin-text">
                {value.toLocaleString("en-NZ")}
              </dd>
            </div>
            {sub && <p className="text-sm text-admin-muted">{sub}</p>}
          </div>
        ))}
      </dl>
      <p className="border-t border-admin-border pt-3 text-sm font-semibold text-admin-text-secondary">
        Posts per app
      </p>
      <dl className="flex flex-col gap-2">
        {SOCIAL_PLATFORMS.map((p) => (
          <div key={p} className="flex items-baseline justify-between gap-2">
            <dt className="text-sm text-admin-text-secondary">{PLATFORM_LABEL[p]}</dt>
            <dd className="text-base font-bold text-admin-text">{stats.byApp[p]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
