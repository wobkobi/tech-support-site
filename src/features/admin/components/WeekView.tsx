"use client";
// src/features/admin/components/WeekView.tsx
/**
 * @file WeekView.tsx
 * @description Admin week-grid view. Renders booking, work, personal, and travel
 * events for the requested week and opens a manual-booking modal when an empty
 * slot is clicked.
 */

import { useMemo, useState } from "react";
import type React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FaChevronLeft,
  FaChevronRight,
  FaCalendarDay,
  FaBan,
  FaCircleCheck,
} from "react-icons/fa6";
import { cn } from "@/shared/lib/cn";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { ManualBookingModal } from "@/features/admin/components/ManualBookingModal";

export type WeekViewKind = "booking" | "work" | "personal" | "travel";

export interface WeekEvent {
  id: string;
  kind: WeekViewKind;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
  isAllDay: boolean;
}

interface WeekViewProps {
  token: string;
  weekStartIso: string;
  prevWeekKey: string;
  nextWeekKey: string;
  events: WeekEvent[];
}

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;
const PX_PER_MINUTE = 1.1;
const DAY_HOURS = DAY_END_HOUR - DAY_START_HOUR;
const DAY_HEIGHT_PX = DAY_HOURS * 60 * PX_PER_MINUTE;
const NZ_TZ = "Pacific/Auckland";

const KIND_STYLES: Record<WeekViewKind, string> = {
  booking: "bg-russian-violet/90 text-white border-russian-violet ring-1 ring-white/10",
  work: "bg-red-100 text-red-900 border-red-300",
  personal: "bg-slate-200 text-slate-700 border-slate-300",
  travel: "bg-amber-100 text-amber-900 border-amber-300",
};

/**
 * Renders the week schedule grid and the manual-booking modal trigger.
 * @param props - Component props.
 * @param props.token - Admin token forwarded to the modal POST + week nav links.
 * @param props.weekStartIso - ISO timestamp of Monday-NZ-midnight for the displayed week.
 * @param props.prevWeekKey - YYYY-MM-DD for the previous week's nav link.
 * @param props.nextWeekKey - YYYY-MM-DD for the next week's nav link.
 * @param props.events - Events to render, already filtered to the visible window.
 * @returns Week view element.
 */
export function WeekView({
  token,
  weekStartIso,
  prevWeekKey,
  nextWeekKey,
  events,
}: WeekViewProps): React.ReactElement {
  const router = useRouter();
  const [modalStartAt, setModalStartAt] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const todayNzKey = useMemo(() => formatNzDateKey(new Date()), []);
  const todayWeekKey = useMemo(() => computeMondayNzKey(new Date()), []);

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
    <>
      <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-3")}>
        <div>
          <h1 className={cn("text-russian-violet text-2xl font-extrabold")}>Schedule</h1>
          <p className={cn("mt-1 text-sm text-slate-500")}>
            {days[0]?.subLabel} - {days[6]?.subLabel} ({days[0]?.date.getFullYear()})
          </p>
        </div>
        <div className={cn("flex items-center gap-2")}>
          <Link
            href={`/admin/schedule?token=${encodeURIComponent(token)}&weekStart=${prevWeekKey}`}
            aria-label="Previous week"
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            <FaChevronLeft />
          </Link>
          <Link
            href={`/admin/schedule?token=${encodeURIComponent(token)}&weekStart=${todayWeekKey}`}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50",
            )}
          >
            <FaCalendarDay />
            Today
          </Link>
          <Link
            href={`/admin/schedule?token=${encodeURIComponent(token)}&weekStart=${nextWeekKey}`}
            aria-label="Next week"
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            <FaChevronRight />
          </Link>
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
              return (
                <div
                  key={day.key}
                  className={cn(
                    "border-r border-slate-200 px-2 py-3 text-center last:border-r-0",
                    isToday && "bg-russian-violet/5",
                  )}
                >
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
                      token={token}
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
            <LegendDot kind="work" label="No car (work cal)" />
            <LegendDot kind="personal" label="Personal" />
            <LegendDot kind="travel" label="Travel" />
            <span className={cn("ml-auto text-slate-400")}>
              Click an empty slot to add a booking
            </span>
          </div>
        </div>
      </div>

      {modalStartAt && (
        <ManualBookingModal
          token={token}
          startAtIso={modalStartAt}
          onClose={() => setModalStartAt(null)}
        />
      )}
    </>
  );
}

interface BlockDayButtonProps {
  token: string;
  dateKey: string;
  busyEventId: string | null;
  hasBookings: boolean;
  busyAction: string | null;
  onPending: (dateKey: string | null) => void;
  onChanged: () => void;
}

/**
 * Small day-header button that toggles an all-day "Busy" event on the booking
 * calendar. Disabled when timed bookings already occupy the day, since the
 * existing calendar code would still let them slip through.
 * @param props - Component props.
 * @param props.token - Admin token forwarded as x-admin-secret.
 * @param props.dateKey - NZ YYYY-MM-DD for the target day.
 * @param props.busyEventId - Existing all-day booking-cal event id (toggle to delete).
 * @param props.hasBookings - True when timed bookings exist on the day.
 * @param props.busyAction - Date key currently submitting (disables all other buttons).
 * @param props.onPending - Sets the in-flight dateKey while a request is open.
 * @param props.onChanged - Called after a successful change so the parent refreshes.
 * @returns Block/Unblock button element.
 */
function BlockDayButton({
  token,
  dateKey,
  busyEventId,
  hasBookings,
  busyAction,
  onPending,
  onChanged,
}: BlockDayButtonProps): React.ReactElement {
  const isBlocked = busyEventId != null;
  const disabled = busyAction != null || (!isBlocked && hasBookings);
  const label = isBlocked
    ? "Unblock day"
    : hasBookings
      ? "Day has bookings"
      : "Block day with a Busy event";

  /**
   * Sends the block/unblock request and refreshes the parent on success.
   */
  async function onClick(): Promise<void> {
    if (disabled) return;
    const ok = window.confirm(
      isBlocked ? "Unblock this day?" : "Block this whole day with a Busy event?",
    );
    if (!ok) return;
    onPending(dateKey);
    try {
      const res = isBlocked
        ? await fetch(`/api/admin/blocked-days/${encodeURIComponent(busyEventId!)}`, {
            method: "DELETE",
            headers: { "x-admin-secret": token },
          })
        : await fetch("/api/admin/blocked-days", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-admin-secret": token },
            body: JSON.stringify({ dateKey }),
          });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) {
        window.alert(data.error ?? "Failed to update blocked day.");
      } else {
        onChanged();
      }
    } catch (err) {
      console.error("[BlockDayButton] request failed", err);
      window.alert("Network error - try again.");
    } finally {
      onPending(null);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors",
        "hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40",
        isBlocked && "text-red-500 hover:bg-red-100 hover:text-red-700",
      )}
    >
      {isBlocked ? (
        <FaCircleCheck className={cn("h-3 w-3")} />
      ) : (
        <FaBan className={cn("h-3 w-3")} />
      )}
    </button>
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

interface LegendDotProps {
  kind: WeekViewKind;
  label: string;
}

/**
 * Small coloured swatch + label used in the schedule legend.
 * @param props - Component props.
 * @param props.kind - Calendar kind controlling the swatch colour.
 * @param props.label - Visible legend text.
 * @returns Legend dot element.
 */
function LegendDot({ kind, label }: LegendDotProps): React.ReactElement {
  return (
    <span className={cn("inline-flex items-center gap-1.5")}>
      <span className={cn("h-3 w-3 rounded-sm border", KIND_STYLES[kind])} />
      {label}
    </span>
  );
}

/**
 * Formats an hour in 24h numeric form (0-23) as a 12h label with am/pm.
 * @param hour - Hour-of-day 0-23.
 * @returns Display label like "9am", "12pm", "5pm".
 */
function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
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
 * Builds a short "9:00am - 10:30am" range label from two ISO timestamps.
 * @param startIso - ISO 8601 timestamp of the range start.
 * @param endIso - ISO 8601 timestamp of the range end.
 * @returns Range label in NZ time.
 */
function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${fmt.format(new Date(startIso))} - ${fmt.format(new Date(endIso))}`;
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
 * given date - the "today" jump target for the week nav.
 * @param date - Reference date.
 * @returns Monday-of-week date key.
 */
function computeMondayNzKey(date: Date): string {
  const nzKey = formatNzDateKey(date);
  const [y, m, d] = nzKey.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = noon.getUTCDay();
  const back = (dow + 6) % 7;
  const mondayUtc = new Date(Date.UTC(y, m - 1, d - back, 12, 0, 0));
  return formatNzDateKey(mondayUtc);
}
