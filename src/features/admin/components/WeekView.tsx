"use client";
// src/features/admin/components/WeekView.tsx
/**
 * @file WeekView.tsx
 * @description Admin week-grid view. Renders booking, work, personal, and travel
 * events for the requested week and opens a manual-booking modal when an empty
 * slot is clicked.
 */

import { useMemo, useState, useTransition } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { FaChevronLeft, FaChevronRight, FaCalendarDay } from "react-icons/fa6";
import { cn } from "@/shared/lib/cn";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { ManualBookingModal } from "@/features/admin/components/ManualBookingModal";
import { BlockDayButton } from "@/features/admin/components/BlockDayButton";
import {
  KIND_STYLES,
  LegendDot,
  NZ_TZ,
  formatHour,
  formatTimeRange,
  type WeekEvent,
  type WeekViewKind,
} from "@/features/admin/lib/schedule-types";

export type { WeekEvent, WeekViewKind };

interface WeekViewProps {
  /** ISO of Monday-NZ-midnight for the initial week (state takes over after mount). */
  initialWeekStartIso: string;
  /** All day keys in the buffered 21-day window (prev + current + next week). */
  bufferedDayKeys: string[];
  events: WeekEvent[];
  /** Map of NZ-local YYYY-MM-DD > holiday name for days falling inside the buffer. */
  holidaysByDateKey: Record<string, string>;
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
 * @returns Week view element.
 */
export function WeekView({
  initialWeekStartIso,
  bufferedDayKeys,
  events,
  holidaysByDateKey,
}: WeekViewProps): React.ReactElement {
  const router = useRouter();
  const [weekStartIso, setWeekStartIso] = useState(initialWeekStartIso);
  const [modalStartAt, setModalStartAt] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // useTransition keeps the current grid visible while the server rebuilds
  // the buffer around a week that falls outside the current 21-day window.
  const [isPending, startTransition] = useTransition();

  const todayNzKey = useMemo(() => formatNzDateKey(new Date()), []);

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
          if (day.key >= startKey && day.key < endKey) day.allDayEvents.push(ev);
        }
      } else {
        const key = formatNzDateKey(new Date(ev.startAt));
        const bucket = arr.find((d) => d.key === key);
        if (bucket) bucket.timedEvents.push(ev);
      }
    }
    return arr;
  }, [weekStartIso, events]);

  const hours = useMemo(
    () => Array.from({ length: DAY_HOURS + 1 }, (_, i) => DAY_START_HOUR + i),
    [],
  );

  // Merge consecutive-day all-day events into spanning bars. Each bar covers
  // the columns from its first visible day to its last visible day (inclusive).
  // Column numbering: 1 = time gutter, 2..8 = days, so day index i sits at
  // grid column i + 2.
  const allDayBars = useMemo(() => {
    const seen = new Map<string, { event: WeekEvent; firstIdx: number; lastIdx: number }>();
    for (let i = 0; i < days.length; i++) {
      for (const ev of days[i].allDayEvents) {
        const existing = seen.get(ev.id);
        if (existing) existing.lastIdx = i;
        else seen.set(ev.id, { event: ev, firstIdx: i, lastIdx: i });
      }
    }
    return Array.from(seen.values()).map((b) => ({
      event: b.event,
      startCol: b.firstIdx + 2,
      endCol: b.lastIdx + 3,
    }));
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
      <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-3")}>
        <div>
          <h1 className={cn("text-russian-violet text-2xl font-extrabold")}>Schedule</h1>
          <p className={cn("mt-1 text-sm text-slate-500")}>
            {days[0]?.subLabel} - {days[6]?.subLabel} ({days[0]?.date.getFullYear()})
          </p>
        </div>
        <div className={cn("flex items-center gap-2")}>
          <button
            type="button"
            onClick={() => goToWeek(prevWeekKey)}
            aria-label="Previous week"
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 sm:h-9 sm:w-9",
            )}
          >
            <FaChevronLeft />
          </button>
          <button
            type="button"
            onClick={() => goToWeek(todayWeekKey)}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:h-9",
            )}
          >
            <FaCalendarDay />
            Today
          </button>
          <button
            type="button"
            onClick={() => goToWeek(nextWeekKey)}
            aria-label="Next week"
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 sm:h-9 sm:w-9",
            )}
          >
            <FaChevronRight />
          </button>
        </div>
      </div>

      <div className={cn("overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm")}>
        <div className={cn("min-w-225")}>
          {/* Day headers */}
          <div className={cn("grid grid-cols-[64px_repeat(7,1fr)] border-b border-slate-200")}>
            <div className={cn("border-r border-slate-200")} />
            {days.map((day) => {
              const isToday = day.key === todayNzKey;
              const busyEvent = day.allDayEvents.find((e) => e.kind === "booking");
              const hasBookings = day.timedEvents.some((e) => e.kind === "booking");
              const holidayName = holidaysByDateKey[day.key];
              return (
                <div
                  key={day.key}
                  className={cn(
                    "border-r border-slate-200 px-2 py-3 text-center last:border-r-0",
                    isToday && "bg-russian-violet/5",
                  )}
                >
                  {holidayName && (
                    <div
                      className={cn(
                        "mb-1 truncate text-[10px] font-semibold uppercase tracking-wide text-amber-700",
                      )}
                      title={holidayName}
                    >
                      {holidayName}
                    </div>
                  )}
                  <div
                    className={cn("text-xs font-semibold uppercase tracking-wide text-slate-500")}
                  >
                    {day.label}
                  </div>
                  <div className={cn("mt-0.5 flex items-center justify-center gap-1.5")}>
                    <div
                      className={cn(
                        "text-sm font-bold",
                        isToday ? "text-russian-violet" : "text-slate-800",
                      )}
                    >
                      {day.subLabel}
                    </div>
                    <BlockDayButton
                      dateKey={day.key}
                      busyEventId={busyEvent?.id ?? null}
                      hasBookings={hasBookings}
                      busyAction={busyAction}
                      onPending={setBusyAction}
                      onChanged={() => router.refresh()}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* All-day events bar - merges consecutive days into one continuous
              span so multi-day Busy blocks read as a single bar. */}
          {allDayBars.length > 0 && (
            <div className={cn("border-b border-slate-200 px-0 py-1")}>
              {allDayBars.map((bar) => (
                <div
                  key={bar.event.id}
                  className={cn("grid grid-cols-[64px_repeat(7,1fr)] py-0.5")}
                >
                  <div
                    className={cn(
                      "mx-1 truncate rounded border px-2 py-0.5 text-center text-[11px] font-semibold",
                      KIND_STYLES[bar.event.kind],
                    )}
                    style={{ gridColumnStart: bar.startCol, gridColumnEnd: bar.endCol }}
                    title={bar.event.title}
                  >
                    {bar.event.title}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Grid body */}
          <div
            className={cn("relative grid grid-cols-[64px_repeat(7,1fr)]")}
            style={{ height: `${DAY_HEIGHT_PX}px` }}
          >
            {/* Time gutter */}
            <div className={cn("relative border-r border-slate-200")}>
              {hours.map((h, i) => (
                <div
                  key={h}
                  className={cn(
                    "absolute right-1 text-[11px] font-medium text-slate-400",
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
              <DayColumn key={day.key} day={day} onClick={(e) => handleColumnClick(e, day.key)} />
            ))}
          </div>

          {/* Legend */}
          <div
            className={cn(
              "flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500",
            )}
          >
            <LegendDot kind="booking" label="Booking" />
            <LegendDot kind="car" label="No car (Car cal)" />
            <LegendDot kind="personal" label="Personal" />
            <LegendDot kind="travel" label="Travel" />
            <span className={cn("ml-auto text-slate-400")}>
              Click an empty slot to add a booking
            </span>
          </div>
        </div>
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
}

/**
 * Renders a single day column with its events overlaid as absolute-positioned
 * blocks. Clicking the column background opens the booking modal.
 * @param props - Component props.
 * @param props.day - Day bucket with the day key and its events.
 * @param props.onClick - Click handler forwarded from the parent week view.
 * @returns Day column element.
 */
function DayColumn({ day, onClick }: DayColumnProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      className={cn(
        "relative border-r border-slate-200 last:border-r-0 hover:bg-slate-50/40",
        "focus:ring-russian-violet/30 cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset",
      )}
      style={{ height: `${DAY_HEIGHT_PX}px` }}
    >
      {/* Hour grid lines */}
      {Array.from({ length: DAY_HOURS }).map((_, i) => (
        <div
          key={i}
          className={cn("pointer-events-none absolute left-0 right-0 border-t border-slate-100")}
          style={{ top: `${i * 60 * PX_PER_MINUTE}px` }}
        />
      ))}

      {day.timedEvents.map((ev) => {
        const top = minuteOfDay(ev.startAt) * PX_PER_MINUTE;
        const durationMin =
          (new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime()) / 60_000;
        const height = Math.max(18, durationMin * PX_PER_MINUTE);
        return (
          <div
            key={ev.id}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute left-1 right-1 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight shadow-sm",
              KIND_STYLES[ev.kind],
            )}
            style={{ top: `${top}px`, height: `${height}px` }}
            title={`${ev.title}${ev.location ? `\n${ev.location}` : ""}`}
          >
            <div className={cn("truncate font-semibold")}>{ev.title}</div>
            {height > 32 && (
              <div className={cn("truncate opacity-80")}>
                {formatTimeRange(ev.startAt, ev.endAt)}
              </div>
            )}
            {ev.location && height > 50 && (
              <div className={cn("truncate opacity-70")}>{ev.location}</div>
            )}
          </div>
        );
      })}
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
