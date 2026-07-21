"use client";
// src/features/admin/components/WeekView.tsx
/**
 * @description Admin week-grid view. Renders booking, work, personal, and travel
 * events for the requested week and opens a manual-booking modal when an empty
 * slot is clicked.
 */

import { BlockDayButton } from "@/features/admin/components/BlockDayButton";
import { ManualBookingModal } from "@/features/admin/components/ManualBookingModal";
import {
  KIND_STYLES,
  LegendDot,
  NZ_TZ,
  OPTIMISTIC_BUSY_PREFIX,
  formatHour,
  formatTimeRange,
  optimisticBusyEvent,
  type WeekEvent,
  type WeekViewKind,
} from "@/features/admin/lib/schedule-types";
import { cn } from "@/shared/lib/cn";
import { isPastEditWindow, nzDayEndMs } from "@/shared/lib/edit-window";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FaCalendarDay, FaChevronLeft, FaChevronRight } from "react-icons/fa6";

interface WeekViewProps {
  /** ISO of Monday-NZ-midnight for the initial week (state takes over after mount). */
  initialWeekStartIso: string;
  /** All day keys in the buffered 21-day window (prev + current + next week). */
  bufferedDayKeys: string[];
  events: WeekEvent[];
  /** Map of NZ-local YYYY-MM-DD > holiday name for days falling inside the buffer. */
  holidaysByDateKey: Record<string, string>;
  /** Live past-edit lock window (hours) - scheduling.pastEditLockHours. */
  lockHours: number;
}

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;
const PX_PER_MINUTE = 1.1;
const DAY_HOURS = DAY_END_HOUR - DAY_START_HOUR;
const DAY_HEIGHT_PX = DAY_HOURS * 60 * PX_PER_MINUTE;

/**
 * Renders the week schedule grid and the manual-booking modal trigger.
 * @param props - Component props.
 * @param props.initialWeekStartIso - ISO of Monday-NZ-midnight for the initial week.
 * @param props.bufferedDayKeys - Day keys in the buffered 21-day window.
 * @param props.events - Events to render across the buffered window.
 * @param props.holidaysByDateKey - NZ-local YYYY-MM-DD > holiday name lookup.
 * @param props.lockHours - Live past-edit lock window (hours).
 * @returns Week view element.
 */
export function WeekView({
  initialWeekStartIso,
  bufferedDayKeys,
  events,
  holidaysByDateKey,
  lockHours,
}: WeekViewProps): React.ReactElement {
  const router = useRouter();
  const [weekStartIso, setWeekStartIso] = useState(initialWeekStartIso);
  const [modalStartAt, setModalStartAt] = useState<string | null>(null);
  // Days with a block/unblock request in flight - a Set so several can run at
  // once (each button disables only its own day, not the whole week).
  const [pendingDays, setPendingDays] = useState<Set<string>>(() => new Set());

  /**
   * Adds/removes a day from the in-flight set as its request starts/finishes.
   * @param dayKey - The day whose request changed state.
   * @param pending - True when starting, false when finished.
   */
  function setPending(dayKey: string, pending: boolean): void {
    setPendingDays((prev) => {
      const next = new Set(prev);
      if (pending) next.add(dayKey);
      else next.delete(dayKey);
      return next;
    });
  }

  // Optimistic block/unblock overrides per day (dateKey > blocked?), applied
  // on click so the header button + spanning bars flip instantly - Google lags
  // a write and the 30s cache can serve a stale read, so a plain refetch lags.
  // Applied when bucketing all-day events; a failed request reverts it.
  const [optimisticBlock, setOptimisticBlock] = useState<Map<string, boolean>>(() => new Map());

  /**
   * Records the optimistic busy state for a just-clicked day so the UI flips
   * before the server round-trip; the refetch reconciles (or the button reverts).
   * @param dayKey - The toggled day (NZ YYYY-MM-DD).
   * @param blocked - The new state (true = now blocked, false = now free).
   */
  function applyOptimisticBlock(dayKey: string, blocked: boolean): void {
    setOptimisticBlock((prev) => new Map(prev).set(dayKey, blocked));
  }

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Coalesces schedule refetches into ONE after rapid changes settle. Blocking
   * several days fires one refresh, not one per click: each block busts the 30s
   * cache, so N immediate refreshes would each re-hit Google and back the server
   * up (locking out further clicks). The optimistic UI covers the 1.2s interim.
   */
  function debouncedRefresh(): void {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 1200);
  }

  // Reconcile optimistic overrides against fresh server data: an override only
  // bridges click > next refresh, so drop overrides for days no longer in
  // flight (a lost/merged block falls back to its real state). Pending lives
  // in a ref so reconciliation fires on server data only, not when a request settles.
  const pendingRef = useRef(pendingDays);
  useEffect(() => {
    pendingRef.current = pendingDays;
  }, [pendingDays]);
  useEffect(() => {
    setOptimisticBlock((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const day of prev.keys()) {
        if (!pendingRef.current.has(day)) {
          next.delete(day);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [events]);
  // useTransition keeps the current grid visible while the server rebuilds
  // the buffer around a week that falls outside the current 21-day window.
  const [isPending, startTransition] = useTransition();

  const todayNzKey = useMemo(() => formatNzDateKey(new Date()), []);
  // Stable "now" for the past-event lock (hides block buttons on old days).
  const [renderedAt] = useState(() => Date.now());

  // Live "now" for the current-time line - ticks each minute so the marker
  // creeps down today's column. Separate from renderedAt (which stays stable so
  // the block buttons don't flicker as the clock advances).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowKey = formatNzDateKey(new Date(nowMs));
  const nowOffsetMin = minuteOfDay(new Date(nowMs).toISOString());

  // Prev/Next/Today Monday keys derived from current state for the nav
  // chevrons and the "Today" button.
  const { prevWeekKey, nextWeekKey, todayWeekKey } = useMemo(() => {
    const ws = new Date(weekStartIso);
    return {
      prevWeekKey: formatNzDateKey(new Date(ws.getTime() - 7 * 86_400_000)),
      nextWeekKey: formatNzDateKey(new Date(ws.getTime() + 7 * 86_400_000)),
      todayWeekKey: computeMondayNzKey(new Date()),
    };
  }, [weekStartIso]);

  /**
   * Navigates to a different week. Stays client-side when the target Monday
   * is inside the buffered window (instant + URL mirrored); otherwise fires
   * router.push so the server can rebuild the buffer.
   * @param weekStartKey - NZ Monday-YYYY-MM-DD to navigate to.
   */
  function goToWeek(weekStartKey: string): void {
    if (!bufferedDayKeys.includes(weekStartKey)) {
      const params = new URLSearchParams({ weekStart: weekStartKey });
      startTransition(() => {
        router.push(`/admin/schedule?${params.toString()}`);
      });
      return;
    }
    // Convert the NZ Monday key to a UTC ISO that represents NZ midnight
    // (same shape as initialWeekStartIso so the days memo math stays consistent).
    const [y, m, d] = weekStartKey.split("-").map(Number);
    const offset = getPacificAucklandOffset(y, m, d);
    const iso = new Date(Date.UTC(y, m - 1, d, -offset, 0, 0)).toISOString();
    setWeekStartIso(iso);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("weekStart", weekStartKey);
      url.searchParams.delete("day");
      window.history.replaceState(null, "", url.toString());
    }
  }

  const days = useMemo(() => {
    const weekStart = new Date(weekStartIso);
    const arr: {
      key: string;
      date: Date;
      label: string;
      subLabel: string;
      timedEvents: WeekEvent[];
      allDayEvents: WeekEvent[];
    }[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart.getTime() + i * 86_400_000);
      arr.push({
        key: formatNzDateKey(date),
        date,
        label: new Intl.DateTimeFormat("en-NZ", { timeZone: NZ_TZ, weekday: "short" }).format(date),
        subLabel: new Intl.DateTimeFormat("en-NZ", {
          timeZone: NZ_TZ,
          day: "numeric",
          month: "short",
        }).format(date),
        timedEvents: [],
        allDayEvents: [],
      });
    }
    for (const ev of events) {
      if (ev.isAllDay) {
        // Multi-day all-day events (Busy blocks spanning several days) need to
        // appear in every day bucket they overlap. Google's all-day end is
        // exclusive (next NZ midnight), so the YYYY-MM-DD comparison is
        // start-inclusive, end-exclusive.
        const startKey = formatNzDateKey(new Date(ev.startAt));
        const endKey = formatNzDateKey(new Date(ev.endAt));
        for (const day of arr) {
          if (day.key < startKey || day.key >= endKey) continue;
          // Drop a Busy block from a day the operator just unblocked (optimistic).
          if (ev.kind === "booking" && optimisticBlock.get(day.key) === false) continue;
          day.allDayEvents.push(ev);
        }
      } else {
        const key = formatNzDateKey(new Date(ev.startAt));
        const bucket = arr.find((d) => d.key === key);
        if (bucket) bucket.timedEvents.push(ev);
      }
    }
    // Inject a placeholder Busy for days just blocked optimistically that don't
    // yet have a real event, so the header button + a spanning bar show instantly.
    for (const day of arr) {
      if (
        optimisticBlock.get(day.key) === true &&
        !day.allDayEvents.some((e) => e.kind === "booking")
      ) {
        day.allDayEvents.push(optimisticBusyEvent(day.key));
      }
    }
    return arr;
  }, [weekStartIso, events, optimisticBlock]);

  const hours = useMemo(
    () => Array.from({ length: DAY_HOURS + 1 }, (_, i) => DAY_START_HOUR + i),
    [],
  );

  // Merge consecutive-day all-day events into spanning bars. Each bar covers
  // the columns from its first visible day to its last visible day (inclusive).
  // Column numbering: 1 = time gutter, 2..8 = days, so day index i sits at
  // grid column i + 2.
  const allDayBars = useMemo(() => {
    interface RawBar {
      key: string;
      title: string;
      kind: WeekViewKind;
      startCol: number;
      endCol: number;
    }
    const raw: RawBar[] = [];

    // Blocks (booking-kind all-day, incl. optimistic placeholders): merge ANY
    // contiguous run of blocked days into ONE "Busy" span so the bar stays
    // stable while the server reconciles rapid blocks into a merged event -
    // no flicker as the calendar catches up.
    const blocked = days.map((d) => d.allDayEvents.some((e) => e.kind === "booking"));
    for (let i = 0; i < days.length;) {
      if (!blocked[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < days.length && blocked[j + 1]) j++;
      raw.push({
        key: `busy-${days[i].key}`,
        title: "Busy",
        kind: "booking",
        startCol: i + 2,
        endCol: j + 3,
      });
      i = j + 1;
    }

    // Other all-day events (e.g. car): one bar per event's contiguous run.
    const idxByEvent = new Map<string, { event: WeekEvent; indices: number[] }>();
    for (let i = 0; i < days.length; i++) {
      for (const ev of days[i].allDayEvents) {
        if (ev.kind === "booking") continue;
        const entry = idxByEvent.get(ev.id);
        if (entry) entry.indices.push(i);
        else idxByEvent.set(ev.id, { event: ev, indices: [i] });
      }
    }
    for (const { event, indices } of idxByEvent.values()) {
      let runStart = indices[0];
      let prev = indices[0];
      /** Pushes the current contiguous run [runStart..prev] as one bar. */
      const flush = (): void => {
        raw.push({
          key: `${event.id}-${runStart}`,
          title: event.title,
          kind: event.kind,
          startCol: runStart + 2,
          endCol: prev + 3,
        });
      };
      for (let k = 1; k < indices.length; k++) {
        if (indices[k] === prev + 1) {
          prev = indices[k];
        } else {
          flush();
          runStart = indices[k];
          prev = indices[k];
        }
      }
      flush();
    }

    // Pack bars onto rows: a bar reuses the first lane whose last bar ends before
    // it starts, so non-overlapping bars share ONE row instead of staggering.
    raw.sort((a, b) => a.startCol - b.startCol);
    const laneEnds: number[] = [];
    return raw.map((bar) => {
      let lane = laneEnds.findIndex((end) => bar.startCol >= end);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = bar.endCol;
      return { ...bar, lane };
    });
  }, [days]);

  /**
   * Maps a click position inside a day column to a 15-min-rounded UTC ISO
   * start time and opens the manual-booking modal at that time.
   * @param event - Mouse event for the click.
   * @param dayKey - YYYY-MM-DD key for the day column that was clicked.
   */
  function handleColumnClick(event: React.MouseEvent<HTMLDivElement>, dayKey: string): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const minuteOfDay = Math.max(0, Math.min(DAY_HOURS * 60 - 60, y / PX_PER_MINUTE));
    const rounded = Math.round(minuteOfDay / 15) * 15;
    const hour = DAY_START_HOUR + Math.floor(rounded / 60);
    const minute = rounded % 60;
    const [y2, m, d] = dayKey.split("-").map(Number);
    const offset = getPacificAucklandOffset(y2, m, d);
    const startAt = new Date(Date.UTC(y2, m - 1, d, hour - offset, minute, 0));
    setModalStartAt(startAt.toISOString());
  }

  return (
    <div className={cn("transition-opacity", isPending && "opacity-60")}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-russian-violet">Schedule</h1>
          <p className="mt-1 text-sm text-admin-muted">
            {days[0]?.subLabel} - {days[6]?.subLabel} (
            {days[0]?.date
              ? new Intl.DateTimeFormat("en-NZ", { timeZone: NZ_TZ, year: "numeric" }).format(
                  days[0].date,
                )
              : ""}
            )
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goToWeek(prevWeekKey)}
            aria-label="Previous week"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-admin-border bg-admin-surface text-admin-text-secondary hover:bg-admin-bg sm:h-9 sm:w-9"
          >
            <FaChevronLeft />
          </button>
          <button
            type="button"
            onClick={() => goToWeek(todayWeekKey)}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-admin-border bg-admin-surface px-3 text-sm font-medium text-admin-text hover:bg-admin-bg sm:h-9"
          >
            <FaCalendarDay />
            Today
          </button>
          <button
            type="button"
            onClick={() => goToWeek(nextWeekKey)}
            aria-label="Next week"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-admin-border bg-admin-surface text-admin-text-secondary hover:bg-admin-bg sm:h-9 sm:w-9"
          >
            <FaChevronRight />
          </button>
        </div>
      </div>

      {/* relative wrapper carries the right-edge fade hint - the grid is wider
          than the admin content area until ~xl, so it scrolls horizontally. */}
      <div className="relative">
        <div className="overflow-x-auto rounded-xl border border-admin-border bg-admin-surface shadow-sm">
          <div className="min-w-225">
            {/* Day headers */}
            <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b border-admin-border">
              <div className="border-r border-admin-border" />
              {days.map((day) => {
                const isToday = day.key === todayNzKey;
                // Real block (for the unblock id) excludes the optimistic placeholder;
                // `blocked` reflects the effective state so the button flips instantly.
                const realBusy = day.allDayEvents.find(
                  (e) => e.kind === "booking" && !e.id.startsWith(OPTIMISTIC_BUSY_PREFIX),
                );
                const anyBusy = day.allDayEvents.some((e) => e.kind === "booking");
                const hasBookings = day.timedEvents.some((e) => e.kind === "booking");
                const holidayName = holidaysByDateKey[day.key];
                return (
                  <div
                    key={day.key}
                    className={cn(
                      "relative border-r border-admin-border px-2 pt-4 pb-3 text-center last:border-r-0",
                      isToday && "bg-russian-violet/5",
                    )}
                  >
                    {/* Overlaid (no layout space) so a holiday never pushes the date
                        down - every day/week keeps the same header height. */}
                    {holidayName && (
                      <div
                        className="absolute inset-x-0 top-0.5 truncate px-1 text-[9px] leading-none font-semibold tracking-wide text-amber-700 uppercase"
                        title={holidayName}
                      >
                        {holidayName}
                      </div>
                    )}
                    <div className="text-xs font-semibold tracking-wide text-admin-muted uppercase">
                      {day.label}
                    </div>
                    <div className="mt-0.5 flex items-center justify-center gap-1.5">
                      <div
                        className={cn(
                          "text-sm font-bold",
                          isToday ? "text-russian-violet" : "text-admin-text",
                        )}
                      >
                        {day.subLabel}
                      </div>
                      <BlockDayButton
                        dateKey={day.key}
                        busyEventId={realBusy?.id ?? null}
                        blocked={anyBusy}
                        hasBookings={hasBookings}
                        locked={isPastEditWindow(nzDayEndMs(day.key), renderedAt, lockHours)}
                        pending={pendingDays.has(day.key)}
                        onPending={setPending}
                        onChanged={debouncedRefresh}
                        onOptimisticChange={applyOptimisticBlock}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* All-day events bar - merges consecutive days into one continuous
              span so multi-day Busy blocks read as a single bar. */}
            {allDayBars.length > 0 && (
              <div className="grid grid-cols-[64px_repeat(7,1fr)] gap-y-0.5 border-b border-admin-border px-0 py-1">
                {allDayBars.map((bar) => (
                  <div
                    key={bar.key}
                    className={cn(
                      "mx-1 truncate rounded border px-2 py-0.5 text-center text-[11px] font-semibold",
                      KIND_STYLES[bar.kind],
                    )}
                    style={{
                      gridColumnStart: bar.startCol,
                      gridColumnEnd: bar.endCol,
                      gridRowStart: bar.lane + 1,
                    }}
                    title={bar.title}
                  >
                    {bar.title}
                  </div>
                ))}
              </div>
            )}

            {/* Grid body */}
            <div
              className="relative grid grid-cols-[64px_repeat(7,1fr)]"
              style={{ height: `${DAY_HEIGHT_PX}px` }}
            >
              {/* Time gutter */}
              <div className="relative border-r border-admin-border">
                {hours.map((h, i) => (
                  <div
                    key={h}
                    className={cn(
                      "absolute right-1 text-[11px] font-medium text-admin-faint",
                      i === 0 && "top-0",
                    )}
                    style={{ top: i === 0 ? 0 : `${i * 60 * PX_PER_MINUTE - 6}px` }}
                  >
                    {formatHour(h)}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {days.map((day) => (
                <DayColumn
                  key={day.key}
                  day={day}
                  onClick={(e) => handleColumnClick(e, day.key)}
                  onOpenBooking={(id) => router.push(`/admin/bookings/${id}`)}
                  nowLineTop={
                    day.key === nowKey && nowOffsetMin >= 0 && nowOffsetMin <= DAY_HOURS * 60
                      ? nowOffsetMin * PX_PER_MINUTE
                      : null
                  }
                />
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 border-t border-admin-border px-4 py-3 text-xs text-admin-muted">
              <LegendDot kind="booking" label="Booking" />
              <LegendDot kind="car" label="No car (Car cal)" />
              <LegendDot kind="personal" label="Personal" />
              <LegendDot kind="travel" label="Travel" />
              <span className="ml-auto text-admin-faint">
                Click an empty slot to add · click a booking to edit
              </span>
            </div>
          </div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-linear-to-l from-white to-transparent"
        />
      </div>

      {modalStartAt && (
        <ManualBookingModal startAtIso={modalStartAt} onClose={() => setModalStartAt(null)} />
      )}
    </div>
  );
}

interface DayColumnProps {
  day: { key: string; timedEvents: WeekEvent[] };
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onOpenBooking: (bookingId: string) => void;
  /** Pixel offset of the current-time line, or null when today isn't this column. */
  nowLineTop: number | null;
}

/**
 * Renders a single day column with its events as absolute-positioned blocks.
 * Clicking the background opens the booking modal; clicking a booking card
 * opens its detail page. Today's column draws a live current-time line.
 * @param props - Component props.
 * @param props.day - Day bucket with the day key and its events.
 * @param props.onClick - Click handler forwarded from the parent week view.
 * @param props.onOpenBooking - Opens a booking's detail page by id (on click).
 * @param props.nowLineTop - Current-time line offset in px, or null if not today.
 * @returns Day column element.
 */
function DayColumn({
  day,
  onClick,
  onOpenBooking,
  nowLineTop,
}: DayColumnProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      className={cn(
        "relative border-r border-admin-border last:border-r-0 hover:bg-admin-bg/40",
        "cursor-pointer focus:ring-2 focus:ring-russian-violet/30 focus:outline-none focus:ring-inset",
      )}
      style={{ height: `${DAY_HEIGHT_PX}px` }}
    >
      {/* Hour grid lines */}
      {Array.from({ length: DAY_HOURS }).map((_, i) => (
        <div
          key={i}
          className="pointer-events-none absolute right-0 left-0 border-t border-admin-border"
          style={{ top: `${i * 60 * PX_PER_MINUTE}px` }}
        />
      ))}

      {day.timedEvents.map((ev) => {
        const top = minuteOfDay(ev.startAt) * PX_PER_MINUTE;
        const durationMin =
          (new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime()) / 60_000;
        const height = Math.max(18, durationMin * PX_PER_MINUTE);
        // Bookings open on single click (double-click silently fails if the
        // clicks drift a pixel). With a DB row > in-app detail page; no row
        // (added straight in Google Calendar) > open there. stopPropagation
        // always runs so a card click never falls through to the add-booking modal.
        const bookingId = ev.kind === "booking" ? ev.booking?.id : undefined;
        const calendarLink =
          ev.kind === "booking" && !bookingId ? (ev.htmlLink ?? undefined) : undefined;
        const canOpen = Boolean(bookingId || calendarLink);
        return (
          <div
            key={ev.id}
            onClick={(e) => {
              e.stopPropagation();
              if (bookingId) onOpenBooking(bookingId);
              else if (calendarLink) window.open(calendarLink, "_blank", "noopener,noreferrer");
            }}
            className={cn(
              "absolute right-1 left-1 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight shadow-sm select-none",
              KIND_STYLES[ev.kind],
              canOpen && "cursor-pointer",
            )}
            style={{ top: `${top}px`, height: `${height}px` }}
            title={`${ev.title}${ev.location ? `\n${ev.location}` : ""}${bookingId ? "\nClick to open" : calendarLink ? "\nClick to open in Google Calendar" : ""}`}
          >
            <div className="truncate font-semibold">{ev.title}</div>
            {height > 32 && (
              <div className="truncate opacity-80">{formatTimeRange(ev.startAt, ev.endAt)}</div>
            )}
            {ev.location && height > 50 && <div className="truncate opacity-70">{ev.location}</div>}
          </div>
        );
      })}

      {/* Live current-time line: only today's column passes a non-null offset. */}
      {nowLineTop != null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
          style={{ top: `${nowLineTop}px` }}
        >
          <span className="absolute -top-1.25 left-0 h-2.5 w-2.5 rounded-full bg-red-500" />
        </div>
      )}
    </div>
  );
}

/**
 * Returns the NZ wall-clock minute-of-day for an ISO timestamp. Used to position
 * event blocks vertically within their day column.
 * @param iso - ISO 8601 timestamp.
 * @returns Minute-of-day relative to the grid's DAY_START_HOUR.
 */
function minuteOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hour - DAY_START_HOUR) * 60 + minute;
}

/**
 * Formats a Date as a NZ-local YYYY-MM-DD key for bucketing events by day.
 * @param date - Date to format.
 * @returns Date key in YYYY-MM-DD form.
 */
function formatNzDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NZ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns the YYYY-MM-DD key for the Monday of the NZ week containing the
 * given date - the "today" jump target for the week nav. Pure UTC date-part
 * math so DST + offset edges can't shift the result.
 * @param date - Reference date.
 * @returns Monday-of-week date key.
 */
function computeMondayNzKey(date: Date): string {
  const nzKey = formatNzDateKey(date);
  const [y, m, d] = nzKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const back = (utc.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - back));
  const my = monday.getUTCFullYear();
  const mm = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const md = String(monday.getUTCDate()).padStart(2, "0");
  return `${my}-${mm}-${md}`;
}
