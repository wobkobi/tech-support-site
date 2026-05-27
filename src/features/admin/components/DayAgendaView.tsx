"use client";
// src/features/admin/components/DayAgendaView.tsx
/**
 * @file DayAgendaView.tsx
 * @description Mobile-friendly single-day schedule view. Renders one NZ day at
 * a time as a vertical agenda list with prev/today/next-day navigation, swipe
 * gestures, and the same booking/block/travel data as the desktop week grid.
 *
 * Day-switching within the visible week stays client-side: state updates
 * instantly and the URL is mirrored via history.replaceState. Crossing the
 * week boundary falls back to a router.push so the server can fetch the next
 * week's calendar events.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { FaCalendarDay, FaChevronLeft, FaChevronRight, FaRegCalendar } from "react-icons/fa6";
import { cn } from "@/shared/lib/cn";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { ManualBookingModal } from "@/features/admin/components/ManualBookingModal";
import { BlockDayButton } from "@/features/admin/components/BlockDayButton";
import {
  KIND_BAR_BG,
  KIND_STYLES,
  LegendDot,
  NZ_TZ,
  formatTimeRange,
  type WeekEvent,
} from "@/features/admin/lib/schedule-types";

interface DayAgendaViewProps {
  token: string;
  /** NZ YYYY-MM-DD for the day to show on mount. */
  initialDayKey: string;
  /** NZ YYYY-MM-DD for "today" - drives the "Jump to today" + new-booking defaults. */
  todayKey: string;
  /** Day keys in the buffered 21-day window (prev + current + next week). */
  bufferedDayKeys: string[];
  /** All events fetched for the buffered window, both timed and all-day. */
  events: WeekEvent[];
  /** NZ public holidays for the buffered window, keyed by NZ YYYY-MM-DD. */
  holidaysByDateKey: Record<string, string>;
}

const SWIPE_MIN_DX = 60;
const SWIPE_MAX_MS = 500;

/**
 * Mobile single-day agenda view. Holds the selected day in client state so
 * day-stepping within the fetched week is instant (no server round-trip);
 * crossing the week boundary calls router.push to refetch the next week.
 * @param props - Component props.
 * @param props.token - Admin token forwarded to the modal POST + block-day calls.
 * @param props.initialDayKey - NZ YYYY-MM-DD for the day to show on mount.
 * @param props.todayKey - NZ YYYY-MM-DD for "today".
 * @param props.bufferedDayKeys - Day keys in the buffered 21-day window.
 * @param props.events - All events for the buffered window.
 * @param props.holidaysByDateKey - Public-holiday map for the buffered window.
 * @returns Day agenda element.
 */
export function DayAgendaView({
  token,
  initialDayKey,
  todayKey,
  bufferedDayKeys,
  events,
  holidaysByDateKey,
}: DayAgendaViewProps): React.ReactElement {
  const router = useRouter();
  const [selectedDayKey, setSelectedDayKey] = useState(initialDayKey);
  const [modalStartAt, setModalStartAt] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // useTransition keeps the current view interactive while the next week
  // is being fetched, so crossing the week boundary doesn't blank the UI.
  const [isPending, startTransition] = useTransition();
  const dateInputRef = useRef<HTMLInputElement>(null);

  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);

  const [yy, mm, dd] = selectedDayKey.split("-").map(Number);
  const offset = getPacificAucklandOffset(yy, mm, dd);

  const { dayLabel, yearLabel, prevDayKey, nextDayKey } = useMemo(() => {
    const noonUtc = new Date(Date.UTC(yy, mm - 1, dd, 12 - offset, 0, 0));
    const dayFmt = new Intl.DateTimeFormat("en-NZ", {
      timeZone: NZ_TZ,
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const yearFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: NZ_TZ, year: "numeric" });
    // ±1 day in NZ-local terms - compute by date-part math so DST + UTC noon
    // edge cases don't shift the key by an extra day.
    const midnightUtc = Date.UTC(yy, mm - 1, dd, 0, 0, 0);
    const prevNz = new Intl.DateTimeFormat("en-CA", {
      timeZone: NZ_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(midnightUtc - 86_400_000));
    const nextNz = new Intl.DateTimeFormat("en-CA", {
      timeZone: NZ_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(midnightUtc + 86_400_000));
    return {
      dayLabel: dayFmt.format(noonUtc),
      yearLabel: yearFmt.format(noonUtc),
      prevDayKey: prevNz,
      nextDayKey: nextNz,
    };
  }, [yy, mm, dd, offset]);

  // Filter the week's events down to the selected day. All-day events are
  // start-inclusive / end-exclusive so multi-day Busy blocks show on each
  // overlapping day key.
  const { timedEvents, allDayEvents } = useMemo(() => {
    const timed: WeekEvent[] = [];
    const allDay: WeekEvent[] = [];
    for (const ev of events) {
      if (ev.isAllDay) {
        const startKey = new Intl.DateTimeFormat("en-CA", {
          timeZone: NZ_TZ,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(ev.startAt));
        const endKey = new Intl.DateTimeFormat("en-CA", {
          timeZone: NZ_TZ,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(ev.endAt));
        if (selectedDayKey >= startKey && selectedDayKey < endKey) allDay.push(ev);
      } else {
        const key = new Intl.DateTimeFormat("en-CA", {
          timeZone: NZ_TZ,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(ev.startAt));
        if (key === selectedDayKey) timed.push(ev);
      }
    }
    // Compare parsed timestamps - lexical sort breaks when mixing Google's
    // `+12:00`-offset strings with travel blocks' UTC `Z` ISO output.
    timed.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return { timedEvents: timed, allDayEvents: allDay };
  }, [events, selectedDayKey]);

  const holidayName = holidaysByDateKey[selectedDayKey] ?? null;
  const busyEvent = allDayEvents.find((e) => e.kind === "booking");
  const isToday = selectedDayKey === todayKey;
  const hasBookings = timedEvents.some((e) => e.kind === "booking");

  /**
   * Navigates to a new day. Stays client-side when the day is inside the
   * buffered 21-day window (instant + URL mirrored); falls back to
   * router.push when the target is outside the buffer so the server can
   * rebuild it around the new day.
   * @param newDayKey - NZ YYYY-MM-DD to navigate to.
   */
  function goToDay(newDayKey: string): void {
    if (!bufferedDayKeys.includes(newDayKey)) {
      // Day falls outside the prefetched 21-day window - bounce through the
      // server so it rebuilds the buffer around the new day. useTransition
      // keeps the old day visible (dimmed) while the fetch happens.
      const params = new URLSearchParams({ token, day: newDayKey });
      startTransition(() => {
        router.push(`/admin/schedule?${params.toString()}`);
      });
      return;
    }
    setSelectedDayKey(newDayKey);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("day", newDayKey);
      // weekStart is server-derived from `day` when both are present, so we
      // drop it from the URL to avoid drift when stepping across the
      // visible-week boundary inside the buffer.
      url.searchParams.delete("weekStart");
      window.history.replaceState(null, "", url.toString());
    }
  }

  /**
   * Handles selection from the native date input.
   * @param e - Change event from the hidden date input.
   */
  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = e.target.value;
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v === selectedDayKey) return;
    goToDay(v);
  }

  /** Opens the native date picker via the underlying input. */
  function openDatePicker(): void {
    const el = dateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      el.showPicker();
    } else {
      el.click();
    }
  }

  /** Step one day backward. */
  function handlePrev(): void {
    goToDay(prevDayKey);
  }

  /** Step one day forward. */
  function handleNext(): void {
    goToDay(nextDayKey);
  }

  /** Jump to today. */
  function handleToday(): void {
    goToDay(todayKey);
  }

  /**
   * Swipe-start handler. Touch only - mouse/trackpad users use the buttons.
   * @param e - Pointer event.
   */
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.pointerType !== "touch") return;
    if ((e.target as HTMLElement).closest("[data-no-swipe]")) return;
    swipeStart.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }

  /**
   * Swipe-end handler. Steps day forward/back when the gesture clears the
   * directional + velocity thresholds; ignored when starting inside a
   * `data-no-swipe` element so taps and links aren't intercepted.
   * @param e - Pointer event.
   */
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dt = Date.now() - start.t;
    if (dt > SWIPE_MAX_MS) return;
    if (Math.abs(dx) < SWIPE_MIN_DX) return;
    if (Math.abs(dx) < 2 * Math.abs(dy)) return;
    if (dx < 0) handleNext();
    else handlePrev();
  }

  /**
   * Stops pointer events from bubbling out of interactive elements so the
   * swipe handler never sees them - chevron taps always fire as clicks.
   * @param e - Pointer event.
   */
  function stopPointer(e: React.PointerEvent<HTMLElement>): void {
    e.stopPropagation();
  }

  /**
   * Computes a sensible default start time for the manual-booking modal: the
   * next half-hour when the day is today, or 9am NZ otherwise.
   */
  function handleAddBooking(): void {
    if (isToday) {
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-NZ", {
        timeZone: NZ_TZ,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
      const min = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
      const totalMin = Math.min(21 * 60, Math.max(6 * 60, Math.ceil((h * 60 + min + 1) / 30) * 30));
      const startH = Math.floor(totalMin / 60);
      const startM = totalMin % 60;
      const startAt = new Date(Date.UTC(yy, mm - 1, dd, startH - offset, startM, 0));
      setModalStartAt(startAt.toISOString());
      return;
    }
    const startAt = new Date(Date.UTC(yy, mm - 1, dd, 9 - offset, 0, 0));
    setModalStartAt(startAt.toISOString());
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className={cn(
        "touch-pan-y transition-opacity",
        // Subtle dim while the next week is loading so the user gets feedback
        // without the layout shifting or going blank.
        isPending && "opacity-60",
      )}
    >
      <div className={cn("mb-4 flex items-end justify-between gap-3")}>
        <div>
          <h1 className={cn("text-russian-violet text-2xl font-extrabold")}>Schedule</h1>
          <p className={cn("mt-1 text-sm text-slate-500")}>{yearLabel}</p>
        </div>
      </div>

      <div
        data-no-swipe
        onPointerDown={stopPointer}
        onPointerUp={stopPointer}
        className={cn(
          "mb-4 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2 shadow-sm",
        )}
      >
        <button
          type="button"
          onClick={handlePrev}
          aria-label="Previous day"
          className={cn(
            "inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-50",
          )}
        >
          <FaChevronLeft />
        </button>
        <div className={cn("flex min-w-0 flex-col items-center text-center")}>
          <button
            type="button"
            onClick={openDatePicker}
            aria-label="Pick a date"
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-base font-bold hover:bg-slate-50",
              isToday ? "text-russian-violet" : "text-slate-800",
            )}
          >
            <span className={cn("truncate")}>{dayLabel}</span>
            <FaRegCalendar className={cn("h-3.5 w-3.5 shrink-0 text-slate-400")} aria-hidden />
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={handleToday}
              className={cn(
                "mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700",
              )}
            >
              <FaCalendarDay className={cn("h-3 w-3")} />
              Jump to today
            </button>
          )}
          {isToday && (
            <div
              className={cn(
                "mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400",
              )}
            >
              Today
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleNext}
          aria-label="Next day"
          className={cn(
            "inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-50",
          )}
        >
          <FaChevronRight />
        </button>
        {/* Hidden native date input - opened via showPicker() from the day-label button. */}
        <input
          ref={dateInputRef}
          type="date"
          value={selectedDayKey}
          onChange={handleDateChange}
          className={cn("sr-only")}
          tabIndex={-1}
          aria-hidden
        />
      </div>

      {holidayName && (
        <div
          className={cn(
            "mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800",
          )}
        >
          Public holiday: {holidayName}
        </div>
      )}

      <div data-no-swipe className={cn("mb-4")}>
        <BlockDayButton
          token={token}
          dateKey={selectedDayKey}
          busyEventId={busyEvent?.id ?? null}
          hasBookings={hasBookings}
          busyAction={busyAction}
          onPending={setBusyAction}
          onChanged={() => router.refresh()}
          variant="full"
        />
      </div>

      {allDayEvents.length > 0 && (
        <div className={cn("mb-3 flex flex-col gap-2")}>
          {allDayEvents.map((ev) => (
            <div
              key={ev.id}
              data-no-swipe
              className={cn(
                "rounded-md border px-3 py-2 text-sm font-semibold",
                KIND_STYLES[ev.kind],
              )}
              title={ev.title}
            >
              <div className={cn("truncate")}>{ev.title}</div>
              {ev.location && (
                <div className={cn("mt-0.5 truncate text-xs font-normal opacity-80")}>
                  {ev.location}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={cn("flex flex-col gap-2")}>
        {timedEvents.length === 0 ? (
          <p
            className={cn(
              "rounded-md border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400",
            )}
          >
            No timed events on this day.
          </p>
        ) : (
          timedEvents.map((ev) => (
            <div
              key={ev.id}
              data-no-swipe
              className={cn(
                "flex overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm",
              )}
            >
              <div className={cn("w-1.5 shrink-0", KIND_BAR_BG[ev.kind])} />
              <div className={cn("min-w-0 flex-1 px-3 py-2")}>
                <div className={cn("text-xs font-semibold text-slate-500")}>
                  {formatTimeRange(ev.startAt, ev.endAt)}
                </div>
                <div className={cn("truncate text-sm font-semibold text-slate-800")}>
                  {ev.title}
                </div>
                {ev.location && (
                  <div className={cn("truncate text-xs text-slate-500")}>{ev.location}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={handleAddBooking}
        data-no-swipe
        className={cn(
          "bg-russian-violet mt-4 inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-semibold text-white hover:opacity-90",
        )}
      >
        Add booking on this day
      </button>

      <div className={cn("mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500")}>
        <LegendDot kind="booking" label="Booking" />
        <LegendDot kind="car" label="No car" />
        <LegendDot kind="personal" label="Personal" />
        <LegendDot kind="travel" label="Travel" />
      </div>

      {modalStartAt && (
        <ManualBookingModal
          token={token}
          startAtIso={modalStartAt}
          onClose={() => setModalStartAt(null)}
        />
      )}
    </div>
  );
}
