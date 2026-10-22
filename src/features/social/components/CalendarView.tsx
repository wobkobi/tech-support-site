"use client";
// src/features/social/components/CalendarView.tsx
// The Social calendar: month, week and day views of posts and schedules' open times, and the
// Instagram grid. Colour by status, schedule, app or tag, with a key; download what's on screen
// as a CSV. Drag a scheduled post to another day or time, content from the side onto a day, or
// one Instagram tile onto another to swap their times. A move shows straight away and goes back
// if the server says no.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import type { CalendarDrag, CalendarDrop } from "@/features/social/components/calendar-drag";
import { CalendarChip } from "@/features/social/components/CalendarChip";
import { CalendarDay } from "@/features/social/components/CalendarDay";
import { CalendarMonth } from "@/features/social/components/CalendarMonth";
import { CalendarSidePanel } from "@/features/social/components/CalendarSidePanel";
import { CalendarWeek, type DropHint } from "@/features/social/components/CalendarWeek";
import { FillSlotDialog } from "@/features/social/components/FillSlotDialog";
import { InstagramGrid, type TileShape } from "@/features/social/components/InstagramGrid";
import { PostingDialog } from "@/features/social/components/PostingDialog";
import {
  atMinute,
  CALENDAR_VIEW_LABEL,
  CALENDAR_VIEWS,
  COLOUR_MODE_LABEL,
  COLOUR_MODES,
  dropMinute,
  entriesByDay,
  legendOf,
  MIN_LEAD_MS,
  onDay,
  rangeStats,
  readColourMode,
  stepKey,
  viewTitle,
  weekHours,
  type CalendarEntry,
  type CalendarItem,
  type CalendarSchedule,
  type ColourContext,
  type ColourMode,
  type CalendarView as View,
} from "@/features/social/lib/calendar";
import { calendarCsv, calendarCsvName } from "@/features/social/lib/calendar-csv";
import { calendarHref } from "@/features/social/lib/links";
import { TAG_COLOURS, type SocialTagRow } from "@/features/social/lib/tags";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { nzDateKey } from "@/shared/lib/timezone-utils";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type Over,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { FaChevronLeft, FaChevronRight, FaDownload } from "react-icons/fa6";

/** A move shown before the server has said yes: entry id > its new time. */
type Pending = Record<string, string>;

/**
 * An entry with any move still waiting on the server.
 * @param e - The entry.
 * @param pending - Moves not yet confirmed.
 * @returns The entry as it shows.
 */
function withPending(e: CalendarEntry, pending: Pending): CalendarEntry {
  const at = pending[e.id];
  return at ? { ...e, at } : e;
}

/**
 * The pointer's drop target when there is one, else whatever the dragged box overlaps.
 * @param args - dnd-kit's collision inputs.
 * @returns The targets hit.
 */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/**
 * What's being dragged, in words.
 * @param active - The dragged thing.
 * @returns Its name.
 */
function dragName(active: Active): string {
  const data = active.data.current as CalendarDrag | undefined;
  if (!data) return "the post";
  return data.kind === "post" ? data.entry.name : data.item.name;
}

/**
 * Where it's over, in words.
 * @param over - The drop target.
 * @returns Its name.
 */
function dropName(over: Over): string {
  const data = over.data.current as CalendarDrop | undefined;
  if (!data) return "the calendar";
  return data.kind === "tile" ? data.entry.name : viewTitle("day", data.key);
}

const ANNOUNCEMENTS: Announcements = {
  /**
   * Read out when a drag starts.
   * @param event - The drag.
   * @param event.active - What's picked up.
   * @returns The words.
   */
  onDragStart: ({ active }) => `Picked up ${dragName(active)}.`,
  /**
   * Read out as it moves over a target.
   * @param event - The drag.
   * @param event.active - What's picked up.
   * @param event.over - What it's over, if anything.
   * @returns The words.
   */
  onDragOver: ({ active, over }) =>
    over
      ? `${dragName(active)} is over ${dropName(over)}.`
      : `${dragName(active)} is not over a day.`,
  /**
   * Read out when it's dropped.
   * @param event - The drag.
   * @param event.active - What's dropped.
   * @param event.over - Where, if anywhere.
   * @returns The words.
   */
  onDragEnd: ({ active, over }) =>
    over
      ? `${dragName(active)} was dropped on ${dropName(over)}.`
      : `${dragName(active)} was put back.`,
  /**
   * Read out when Escape puts it back.
   * @param event - The drag.
   * @param event.active - What was picked up.
   * @returns The words.
   */
  onDragCancel: ({ active }) => `Moving ${dragName(active)} was cancelled.`,
};

const INSTRUCTIONS = {
  draggable:
    "To move it, press Space, use the arrow keys to go to another day, then press Space to drop it or Escape to cancel.",
};

/**
 * Calendar page body.
 * @param props - Component props.
 * @param props.view - The view.
 * @param props.dayKey - The day it's on.
 * @param props.today - Today's key.
 * @param props.colour - What colour stands for.
 * @param props.entries - Posts and open times for the days shown; empty for the grid.
 * @param props.grid - The Instagram grid's tiles; empty for the other views.
 * @param props.items - Content items for the side panel.
 * @param props.schedules - Every schedule.
 * @param props.tags - Every tag.
 * @param props.defaultMinute - Where new times start (Settings > Social & brand).
 * @param props.now - The page's time, as an ISO time.
 * @returns The calendar.
 */
export function CalendarView({
  view,
  dayKey,
  today,
  colour,
  entries,
  grid,
  items,
  schedules,
  tags,
  defaultMinute,
  now: pageNow,
}: {
  view: View;
  dayKey: string;
  today: string;
  colour: ColourMode;
  entries: CalendarEntry[];
  grid: CalendarEntry[];
  items: CalendarItem[];
  schedules: CalendarSchedule[];
  tags: SocialTagRow[];
  defaultMinute: number;
  now: string;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const dndId = useId();
  const [now, setNow] = useState(() => new Date(pageNow));
  const [pending, setPending] = useState<Pending>({});
  // Fresh data from the server already has every move in it.
  const [seen, setSeen] = useState({ entries, grid });
  if (seen.entries !== entries || seen.grid !== grid) {
    setSeen({ entries, grid });
    setPending({});
  }
  const [dragging, setDragging] = useState<CalendarDrag | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const [slot, setSlot] = useState<CalendarEntry | null>(null);
  const [posting, setPosting] = useState<{ item: CalendarItem; at?: string } | null>(null);
  const [shape, setShape] = useState<TileShape>("tall");

  // Which posts can still move depends on the time, so keep it current.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const ctx: ColourContext = useMemo(
    () => ({
      queues: new Map(schedules.map((s) => [s.id, { name: s.name, colour: s.colour }])),
      tags: new Map(tags.map((t) => [t.id, { name: t.name, colour: t.colour }])),
    }),
    [schedules, tags],
  );

  const shown = entries.map((e) => withPending(e, pending));
  // A month view's first and last rows reach into the months either side; the figures, key and
  // CSV are for the month itself.
  const month = dayKey.slice(0, 7);
  const inRange =
    view === "month" ? shown.filter((e) => nzDateKey(new Date(e.at)).startsWith(month)) : shown;
  const byDay = entriesByDay(shown);
  const tiles = useMemo(() => {
    const all = grid.map((e) => withPending(e, pending));
    const ahead = all.filter((e) => e.status === "scheduled" || e.status === "posting");
    const out = all.filter((e) => e.status !== "scheduled" && e.status !== "posting");
    return [...ahead.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), ...out];
  }, [grid, pending]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      // Enter stays the chip's own: it opens the post.
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Enter],
      },
    }),
  );

  /**
   * The address for another view, day or colour.
   * @param next - What changes.
   * @param next.view - Another view.
   * @param next.date - Another day.
   * @param next.colour - Another colour mode.
   * @returns The address.
   */
  const href = (next: { view?: View; date?: string; colour?: ColourMode }): string =>
    calendarHref({
      view: next.view ?? view,
      date: next.date ?? dayKey,
      colour: next.colour ?? colour,
    });
  /**
   * The day view's address for a day.
   * @param key - The day.
   * @returns The address.
   */
  const dayHref = (key: string): string => href({ view: "day", date: key });

  /**
   * Drops back a move the server turned down.
   * @param ids - The entries moved.
   */
  function undoPending(ids: readonly string[]): void {
    setPending((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
  }

  /**
   * Moves a scheduled post, showing it there straight away.
   * @param entry - The post.
   * @param at - Its new time.
   */
  async function move(entry: CalendarEntry, at: Date): Promise<void> {
    if (at.getTime() === Date.parse(entry.at)) return;
    if (at.getTime() < Date.now() + MIN_LEAD_MS) {
      toast("Pick a time at least a minute from now.", { tone: "error" });
      return;
    }
    setPending((prev) => ({ ...prev, [entry.id]: at.toISOString() }));
    const res = await callApi(`/api/admin/social/${entry.id}/schedule`, "PUT", {
      scheduledAt: at.toISOString(),
    });
    if (!res.ok) {
      undoPending([entry.id]);
      toast(res.error, { tone: "error" });
      return;
    }
    toast(`${entry.name} moved to ${formatDateTimeShort(at)}.`, { tone: "success" });
    router.refresh();
  }

  /**
   * Swaps two scheduled posts' times, showing it straight away.
   * @param a - The tile dragged.
   * @param b - The tile it was dropped on.
   */
  async function swap(a: CalendarEntry, b: CalendarEntry): Promise<void> {
    setPending((prev) => ({ ...prev, [a.id]: b.at, [b.id]: a.at }));
    const res = await callApi(`/api/admin/social/${a.id}/schedule`, "PUT", { swapWith: b.id });
    if (!res.ok) {
      undoPending([a.id, b.id]);
      toast(res.error, { tone: "error" });
      return;
    }
    toast(`${a.name} and ${b.name} swapped times.`, { tone: "success" });
    router.refresh();
  }

  /**
   * The time a drop lands on, from where it was let go.
   * @param drop - The drop target.
   * @param top - The dragged box's top edge, in page px.
   * @param overTop - The target's top edge.
   * @param drag - What's dropped.
   * @returns The new time.
   */
  function dropTime(
    drop: CalendarDrop,
    top: number,
    overTop: number,
    drag: CalendarDrag,
  ): Date | null {
    if (drop.kind === "tile") return null;
    if (drop.kind === "column") {
      return atMinute(drop.key, dropMinute(top - overTop, drop.pxPerMinute, drop));
    }
    return drag.kind === "post"
      ? onDay(new Date(drag.entry.at), drop.key)
      : atMinute(drop.key, defaultMinute);
  }

  /**
   * Follows a drag over a week column, for the guide line.
   * @param event - dnd-kit drag move.
   */
  function onDragMove(event: DragMoveEvent): void {
    const drop = event.over?.data.current as CalendarDrop | undefined;
    const top = event.active.rect.current.translated?.top;
    if (drop?.kind !== "column" || top === undefined || !event.over) {
      if (hint) setHint(null);
      return;
    }
    const minute = dropMinute(top - event.over.rect.top, drop.pxPerMinute, drop);
    if (hint?.key !== drop.key || hint.minute !== minute) setHint({ key: drop.key, minute });
  }

  /**
   * Acts on a drop: moves a post, swaps two tiles, or opens the posting dialog for content.
   * @param event - dnd-kit drag end.
   */
  function onDragEnd(event: DragEndEvent): void {
    setDragging(null);
    setHint(null);
    const drag = event.active.data.current as CalendarDrag | undefined;
    const drop = event.over?.data.current as CalendarDrop | undefined;
    if (!drag || !drop || !event.over) return;
    if (drop.kind === "tile") {
      if (drag.kind === "post" && drag.entry.id !== drop.entry.id)
        void swap(drag.entry, drop.entry);
      return;
    }
    const top = event.active.rect.current.translated?.top ?? event.over.rect.top;
    const at = dropTime(drop, top, event.over.rect.top, drag);
    if (!at) return;
    if (drag.kind === "item") setPosting({ item: drag.item, at: at.toISOString() });
    else void move(drag.entry, at);
  }

  /** Downloads what's on screen as a CSV. */
  function download(): void {
    const blob = new Blob([calendarCsv(inRange, ctx)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = calendarCsvName(view, dayKey);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const legend = legendOf(inRange, colour, ctx);
  const hasOpen = inRange.some((e) => e.status === "open");
  const title = viewTitle(view, dayKey);

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{ announcements: ANNOUNCEMENTS, screenReaderInstructions: INSTRUCTIONS }}
      onDragStart={(e) => setDragging((e.active.data.current as CalendarDrag) ?? null)}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setHint(null);
      }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        {view !== "grid" && (
          <div className="flex items-center gap-2">
            <AdminButton href={href({ date: today })} variant="outline">
              Today
            </AdminButton>
            <AdminButton
              href={href({ date: stepKey(view, dayKey, -1) })}
              variant="ghost"
              aria-label={`Previous ${view}`}
            >
              <FaChevronLeft aria-hidden className="size-3.5" />
            </AdminButton>
            <AdminButton
              href={href({ date: stepKey(view, dayKey, 1) })}
              variant="ghost"
              aria-label={`Next ${view}`}
            >
              <FaChevronRight aria-hidden className="size-3.5" />
            </AdminButton>
          </div>
        )}
        <h2 className="text-xl font-bold text-admin-text">{title}</h2>
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <nav aria-label="Calendar view" className={SEGMENTED_GROUP_CLS}>
            {CALENDAR_VIEWS.map((v) => (
              <Link
                key={v}
                href={href({ view: v })}
                aria-current={v === view ? "page" : undefined}
                className={cn(segmentedButtonClass(v === view), "inline-flex items-center")}
              >
                {CALENDAR_VIEW_LABEL[v]}
              </Link>
            ))}
          </nav>
          {view === "grid" ? (
            <div role="group" aria-label="Tile shape" className={SEGMENTED_GROUP_CLS}>
              {(
                [
                  ["tall", "Tall"],
                  ["square", "Square"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={shape === key}
                  onClick={() => setShape(key)}
                  className={segmentedButtonClass(shape === key)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm font-semibold text-admin-text-secondary">
                Colour by
                <AdminSelect
                  value={colour}
                  onChange={(e) =>
                    router.replace(href({ colour: readColourMode(e.target.value) }), {
                      scroll: false,
                    })
                  }
                  className="w-auto"
                >
                  {COLOUR_MODES.map((m) => (
                    <option key={m} value={m}>
                      {COLOUR_MODE_LABEL[m]}
                    </option>
                  ))}
                </AdminSelect>
              </label>
              <AdminButton variant="outline" onClick={download} disabled={inRange.length === 0}>
                <FaDownload aria-hidden className="size-3.5" /> Download CSV
              </AdminButton>
            </>
          )}
        </div>
      </div>

      {view !== "grid" && (legend.length > 0 || hasOpen) && (
        <ul aria-label="Key" className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
          {legend.map((l) => (
            <li
              key={`${l.colour}:${l.label}`}
              className="flex items-center gap-1.5 text-sm text-admin-text-secondary"
            >
              <span aria-hidden className={cn("size-3 rounded-full", TAG_COLOURS[l.colour].dot)} />
              {l.label}
            </li>
          ))}
          {hasOpen && (
            <li className="flex items-center gap-1.5 text-sm text-admin-text-secondary">
              <span
                aria-hidden
                className="size-3 rounded-full border border-dashed border-admin-muted"
              />
              Open time in a schedule
            </li>
          )}
        </ul>
      )}

      {view === "grid" ? (
        <div className="flex flex-col gap-4">
          <p className="text-base text-admin-text-secondary">
            Your Instagram profile as it will look: scheduled posts on top, the one going out last
            first. Drag a scheduled post onto another scheduled post to swap their times.
          </p>
          <InstagramGrid tiles={tiles} shape={shape} now={now} />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">
            {view === "month" && (
              <CalendarMonth
                dayKey={dayKey}
                byDay={byDay}
                today={today}
                mode={colour}
                ctx={ctx}
                now={now}
                dayHref={dayHref}
                onOpenSlot={setSlot}
              />
            )}
            {view === "week" && (
              <CalendarWeek
                dayKey={dayKey}
                byDay={byDay}
                dayHref={dayHref}
                today={today}
                hours={weekHours(shown)}
                mode={colour}
                ctx={ctx}
                now={now}
                hint={hint}
                onOpenSlot={setSlot}
              />
            )}
            {view === "day" && (
              <CalendarDay
                dayKey={dayKey}
                today={today}
                entries={byDay.get(dayKey) ?? []}
                ctx={ctx}
                onOpenSlot={setSlot}
              />
            )}
          </div>
          <CalendarSidePanel
            items={items}
            stats={rangeStats(inRange)}
            range={title}
            onSchedule={(item) =>
              setPosting({
                item,
                at:
                  view === "day" && dayKey >= today
                    ? atMinute(dayKey, defaultMinute).toISOString()
                    : undefined,
              })
            }
          />
        </div>
      )}

      <DragOverlay dropAnimation={null}>
        {dragging?.kind === "post" ? (
          <CalendarChip
            entry={dragging.entry}
            mode={colour}
            ctx={ctx}
            onOpenSlot={() => {}}
            className="w-48 shadow-lg"
          />
        ) : dragging?.kind === "item" ? (
          <div className="w-56 truncate rounded-md border border-russian-violet bg-admin-surface px-2 py-1.5 text-sm font-semibold text-admin-text shadow-lg">
            {dragging.item.name}
          </div>
        ) : null}
      </DragOverlay>

      {slot && (
        <FillSlotDialog
          entry={slot}
          items={items}
          schedule={schedules.find((s) => s.id === slot.queueId)}
          onDone={() => {
            setSlot(null);
            router.refresh();
          }}
          onClose={() => setSlot(null)}
        />
      )}
      {posting && (
        <PostingDialog
          itemId={posting.item.id}
          captions={posting.item.captions}
          next={posting.item.next}
          start="later"
          at={posting.at}

          onDone={() => {
            setPosting(null);
            router.refresh();
          }}
          onClose={() => setPosting(null)}
        />
      )}
    </DndContext>
  );
}
