"use client";
// src/features/admin/components/DayAgendaView.tsx
/**
 * @description Mobile-friendly single-day schedule view: one NZ day as a
 * vertical agenda with prev/today/next navigation, swipe gestures, and the
 * same booking/block/travel data as the desktop week grid.
 */

import { BlockDayButton } from "@/features/admin/components/BlockDayButton";
import { EventActionSheet } from "@/features/admin/components/EventActionSheet";
import { ManualBookingModal } from "@/features/admin/components/ManualBookingModal";
import {
  KIND_BAR_BG,
  KIND_STYLES,
  LegendDot,
  NZ_TZ,
  formatTimeRange,
  mondayOf,
  optimisticBusyEvent,
  type WeekEvent,
} from "@/features/admin/lib/schedule-types";
import { cn } from "@/shared/lib/cn";
import { isPastEditWindow, nzDayEndMs } from "@/shared/lib/edit-window";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FaCalendarDay, FaChevronLeft, FaChevronRight, FaRegCalendar } from "react-icons/fa6";

/**
 * Formats a positive minute count as "Xh Ym free" / "Xh free" / "Ym free".
 * @param minutes - Gap length in minutes.
 * @returns Display label.
 */
function formatGap(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m free`;
  if (h > 0) return `${h}h free`;
  return `${m}m free`;
}

/**
 * NZ YYYY-MM-DD for a day offset from a starting NZ date key. Pure UTC math
 * to avoid DST + offset edges.
 * @param dayKey - Starting NZ date key.
 * @param delta - Days to add (negative for earlier days).
 * @returns Resulting NZ date key.
 */
function shiftDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + delta));
  const sy = shifted.getUTCFullYear();
  const sm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const sd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${sy}-${sm}-${sd}`;
}

/** Minimum gap between consecutive bookings to render a "free" label. */
const MIN_GAP_MINUTES = 30;

/** Tailwind pill colours per booking status - mirrors BookingAdminList. */
const BOOKING_STATUS_CHIP: Record<"held" | "confirmed" | "cancelled" | "completed", string> = {
  confirmed: "bg-moonstone-400/20 text-moonstone-400",
  held: "bg-yellow-500/20 text-yellow-600",
  cancelled: "bg-red-500/20 text-red-500",
  completed: "bg-green-500/20 text-green-600",
};

interface DayAgendaViewProps {
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
  /** Live past-edit lock window (hours) - scheduling.pastEditLockHours. */
  lockHours: number;
}

const SWIPE_MIN_DX = 60;
const SWIPE_MAX_MS = 500;

/**
 * Mobile single-day agenda view. Holds the selected day in client state so
 * day-stepping within the fetched week is instant (no server round-trip);
 * crossing the week boundary calls router.push to refetch the next week.
 * @param props - Component props.
 * @param props.initialDayKey - NZ YYYY-MM-DD for the day to show on mount.
 * @param props.todayKey - NZ YYYY-MM-DD for "today".
 * @param props.bufferedDayKeys - Day keys in the buffered 21-day window.
 * @param props.events - All events for the buffered window.
 * @param props.holidaysByDateKey - Public-holiday map for the buffered window.
 * @param props.lockHours - Live past-edit lock window (hours).
 * @returns Day agenda element.
 */
export function DayAgendaView({
  initialDayKey,
  todayKey,
  bufferedDayKeys,
  events,
  holidaysByDateKey,
  lockHours,
}: DayAgendaViewProps): React.ReactElement {
  const router = useRouter();
  // Day selection and sheet state
  const [selectedDayKey, setSelectedDayKey] = useState(initialDayKey);
  const [modalStartAt, setModalStartAt] = useState<string | null>(null);
  // Days with a block/unblock request in flight - a Set so several can run at
  // once (each button disables only its own day, not the whole schedule).
  const [pendingDays, setPendingDays] = useState<Set<string>>(() => new Set());
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [actionSheetEvent, setActionSheetEvent] = useState<WeekEvent | null>(null);
  // Stable "now" for the past-event lock (avoids an impure call during render).
  const [renderedAt] = useState(() => Date.now());
  // Optimistic block/unblock overrides per day (dateKey > blocked?), applied
  // on click so the UI flips instantly - Google lags a write and the 30s cache
  // can serve a stale read, so a plain refetch lags. Kept until the server
  // refetch catches up; a failed request reverts it.
  const [optimisticBlock, setOptimisticBlock] = useState<Map<string, boolean>>(() => new Map());
  // useTransition keeps the current view interactive while the next week
  // is being fetched, so crossing the week boundary doesn't blank the UI.
  const [isPending, startTransition] = useTransition();
  const dateInputRef = useRef<HTMLInputElement>(null);

  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);
  // Long-press infrastructure: timer + start position + "fired" flag so the
  // subsequent click doesn't also trigger the tap-to-expand toggle.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef<boolean>(false);

  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_THRESHOLD = 10;

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

  // Day-key formatter shared across the per-day bucketing and the week-strip
  // count below. Constructing once is cheaper than per-event.
  const dayKeyFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: NZ_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    [],
  );

  // Filter the week's events down to the selected day. All-day events are
  // start-inclusive / end-exclusive so multi-day Busy blocks show on each
  // overlapping day key. Timed events are sorted by start instant + then
  // interleaved with "free" gap markers between consecutive bookings.
  const { agendaItems, timedEvents, allDayEvents } = useMemo(() => {
    const timed: WeekEvent[] = [];
    const allDay: WeekEvent[] = [];
    for (const ev of events) {
      if (ev.isAllDay) {
        const startKey = dayKeyFmt.format(new Date(ev.startAt));
        const endKey = dayKeyFmt.format(new Date(ev.endAt));
        if (selectedDayKey >= startKey && selectedDayKey < endKey) allDay.push(ev);
      } else {
        const key = dayKeyFmt.format(new Date(ev.startAt));
        if (key === selectedDayKey) timed.push(ev);
      }
    }
    // Compare parsed timestamps - lexical sort breaks when mixing Google's
    // `+12:00`-offset strings with travel blocks' UTC `Z` ISO output.
    timed.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

    // Interleave free-time gap markers between consecutive bookings. Only
    // booking>booking gaps get a label - the operator's free-slot view
    // shouldn't be confused by travel or personal events that already imply
    // unavailability.
    type AgendaItem = { type: "event"; ev: WeekEvent } | { type: "gap"; minutes: number };
    const items: AgendaItem[] = [];
    for (let i = 0; i < timed.length; i++) {
      const cur = timed[i];
      items.push({ type: "event", ev: cur });
      const next = timed[i + 1];
      if (!next) continue;
      if (cur.kind !== "booking" || next.kind !== "booking") continue;
      const gapMs = new Date(next.startAt).getTime() - new Date(cur.endAt).getTime();
      const gapMin = Math.round(gapMs / 60_000);
      if (gapMin >= MIN_GAP_MINUTES) items.push({ type: "gap", minutes: gapMin });
    }

    return { agendaItems: items, timedEvents: timed, allDayEvents: allDay };
  }, [events, selectedDayKey, dayKeyFmt]);

  const holidayName = holidaysByDateKey[selectedDayKey] ?? null;
  // Optimistic override for a just-clicked day: true = blocked, false = free,
  // undefined = use the real calendar. `busyEvent` (real event, for the unblock
  // id) excludes the placeholder; the displayed list shows/hides the block to
  // match the click instantly.
  const override = optimisticBlock.get(selectedDayKey);
  const realBusy = allDayEvents.find((e) => e.kind === "booking");
  const effectiveBlocked = override ?? realBusy != null;
  const busyEvent = override === false ? undefined : realBusy;
  const visibleAllDayEvents =
    override === false
      ? allDayEvents.filter((e) => e.kind !== "booking")
      : override === true && realBusy == null
        ? [optimisticBusyEvent(selectedDayKey), ...allDayEvents]
        : allDayEvents;
  const isToday = selectedDayKey === todayKey;
  const hasBookings = timedEvents.some((e) => e.kind === "booking");
  const bookingCount = timedEvents.filter((e) => e.kind === "booking").length;

  /**
   * Records the optimistic busy state for a just-clicked day so the UI flips
   * before the server round-trip; the refetch reconciles (or the button reverts).
   * @param dayKey - The toggled day (NZ YYYY-MM-DD).
   * @param blocked - The new state (true = now blocked, false = now free).
   */
  function applyOptimisticBlock(dayKey: string, blocked: boolean): void {
    setOptimisticBlock((prev) => new Map(prev).set(dayKey, blocked));
  }

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

  // 7-day strip data: the Monday-to-Sunday week containing the selected day,
  // with a booking count per day. Booking count drives the dot indicators
  // and is also a useful aggregate for the at-a-glance read.
  const weekDays = useMemo(() => {
    const mondayKey = mondayOf(selectedDayKey);
    return Array.from({ length: 7 }, (_, i) => {
      const dayKey = shiftDayKey(mondayKey, i);
      const [y, m, d] = dayKey.split("-").map(Number);
      const ofs = getPacificAucklandOffset(y, m, d);
      const noon = new Date(Date.UTC(y, m - 1, d, 12 - ofs, 0, 0));
      const weekday = new Intl.DateTimeFormat("en-NZ", {
        timeZone: NZ_TZ,
        weekday: "narrow",
      }).format(noon);
      const dayOfMonth = new Intl.DateTimeFormat("en-NZ", {
        timeZone: NZ_TZ,
        day: "numeric",
      }).format(noon);
      // Count timed bookings whose NZ start-day matches this strip cell.
      let count = 0;
      for (const ev of events) {
        if (ev.kind !== "booking" || ev.isAllDay) continue;
        if (dayKeyFmt.format(new Date(ev.startAt)) === dayKey) count++;
      }
      return { key: dayKey, weekday, dayOfMonth, count };
    });
  }, [selectedDayKey, events, dayKeyFmt]);

  /**
   * Navigates to a new day. Stays client-side when the day is inside the
   * buffered 21-day window (instant + URL mirrored); falls back to
   * router.push when the target is outside the buffer so the server can
   * rebuild it around the new day.
   * @param newDayKey - NZ YYYY-MM-DD to navigate to.
   */
  function goToDay(newDayKey: string): void {
    if (!bufferedDayKeys.includes(newDayKey)) {
      // useTransition keeps the old day visible (dimmed) while the fetch happens.
      const params = new URLSearchParams({ day: newDayKey });
      startTransition(() => {
        router.push(`/admin/schedule?${params.toString()}`);
      });
      return;
    }
    setSelectedDayKey(newDayKey);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("day", newDayKey);
      // weekStart is server-derived from `day` when both are present, so drop
      // it from the URL to avoid drift when stepping across the visible-week
      // boundary inside the buffer.
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
   * Starts the long-press timer on a booking card. Clears any prior timer so
   * a rapid second touch doesn't double-fire.
   * @param e - Pointer event from the card.
   * @param ev - The week-event the card represents.
   */
  function onCardPointerDown(e: React.PointerEvent<HTMLDivElement>, ev: WeekEvent): void {
    longPressStart.current = { x: e.clientX, y: e.clientY };
    longPressFired.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setActionSheetEvent(ev);
    }, LONG_PRESS_MS);
  }

  /**
   * Cancels the long-press if the finger drifts more than the threshold -
   * keeps swipes from accidentally triggering the action sheet.
   * @param e - Pointer event.
   */
  function onCardPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const start = longPressStart.current;
    if (!start || !longPressTimer.current) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  /** Clears the long-press timer; called from pointerup/cancel/leave. */
  function clearLongPress(): void {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  }

  /**
   * Toggles the inline expanded view for a booking card. Skipped when the
   * preceding pointer interaction fired a long-press so the action sheet
   * doesn't get immediately closed by the tap-to-expand toggle.
   * @param eventId - WeekEvent.id.
   */
  function handleCardClick(eventId: string): void {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    setExpandedEventId((cur) => (cur === eventId ? null : eventId));
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
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-russian-violet">Schedule</h1>
          <p className="mt-1 text-sm text-admin-muted">{yearLabel}</p>
        </div>
      </div>

      {/* Sticky header band - mini week strip + day-picker bar pinned to the
          top of the viewport while the events list scrolls under them. The
          band sits at `top-14` to clear the mobile hamburger button (the admin
          shell layout uses pt-16 / 64px), and `-mx-4` / `-mx-6` so the page background
          covers the page edges as content scrolls behind. */}
      <div
        data-no-swipe
        onPointerDown={stopPointer}
        onPointerUp={stopPointer}
        className="sticky top-14 z-10 -mx-4 mb-4 bg-admin-bg px-4 pt-1 pb-2 sm:top-8 sm:-mx-6 sm:px-6"
      >
        {/* Mini 7-day strip - visible week containing the selected day. Dots
            indicate booking count per day (capped at 4). Compact so it
            reads as glance-only; primary nav stays in the picker below. */}
        <div className="mb-3 grid grid-cols-7 gap-1">
          {weekDays.map((wd) => {
            const isSelected = wd.key === selectedDayKey;
            const isTodayCell = wd.key === todayKey;
            const dotCount = Math.min(wd.count, 4);
            return (
              <button
                key={wd.key}
                type="button"
                onClick={() => goToDay(wd.key)}
                aria-label={`${wd.weekday} ${wd.dayOfMonth}${wd.count > 0 ? `, ${wd.count} booking${wd.count === 1 ? "" : "s"}` : ""}`}
                aria-current={isSelected ? "date" : undefined}
                className={cn(
                  "flex h-10 flex-col items-center justify-center rounded-md border transition-colors",
                  isSelected
                    ? "border-russian-violet bg-russian-violet text-white"
                    : "border-admin-border bg-admin-surface text-admin-text hover:bg-admin-bg",
                  !isSelected && isTodayCell && "ring-2 ring-russian-violet/40 ring-inset",
                )}
              >
                <span className="text-[9px] font-medium uppercase opacity-70">{wd.weekday}</span>
                <span className="text-xs leading-tight font-bold">{wd.dayOfMonth}</span>
                <span className="mt-0.5 flex h-1 items-center gap-0.5" aria-hidden>
                  {dotCount > 0
                    ? Array.from({ length: dotCount }).map((_, i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-1 w-1 rounded-full",
                            isSelected ? "bg-admin-surface/80" : "bg-russian-violet",
                          )}
                        />
                      ))
                    : null}
                </span>
              </button>
            );
          })}
        </div>

        {/* Day-picker bar. Generous spacing between the chevrons and the
            central label/today chip so finger-fat taps don't go wrong. */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-admin-border bg-admin-surface px-2 py-2 shadow-sm">
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous day"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-admin-text-secondary hover:bg-admin-bg"
          >
            <FaChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-col items-center gap-1 text-center">
            <button
              type="button"
              onClick={openDatePicker}
              aria-label="Pick a date"
              className={cn(
                "inline-flex h-9 max-w-full items-center gap-1.5 rounded-md px-3 text-base font-bold hover:bg-admin-bg",
                isToday ? "text-russian-violet" : "text-admin-text",
              )}
            >
              <span className="truncate">{dayLabel}</span>
              <FaRegCalendar className="h-4 w-4 shrink-0 text-admin-faint" aria-hidden />
            </button>
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              {bookingCount > 0 && (
                <span className="inline-flex h-7 items-center rounded-full bg-russian-violet/10 px-2.5 font-semibold text-russian-violet">
                  {bookingCount} booking{bookingCount === 1 ? "" : "s"}
                </span>
              )}
              {!isToday && (
                <button
                  type="button"
                  onClick={handleToday}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-admin-border bg-admin-surface px-3 font-medium text-admin-text-secondary hover:bg-admin-bg"
                >
                  <FaCalendarDay className="h-3 w-3" />
                  Today
                </button>
              )}
              {isToday && (
                <span className="inline-flex h-7 items-center rounded-full bg-admin-bg px-2.5 text-[10px] font-semibold tracking-wide text-admin-muted uppercase">
                  Today
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next day"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-admin-text-secondary hover:bg-admin-bg"
          >
            <FaChevronRight className="h-5 w-5" />
          </button>
          {/* Hidden native date input - opened via showPicker() from the day-label button. */}
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDayKey}
            onChange={handleDateChange}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
          />
        </div>
      </div>

      {holidayName && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          Public holiday: {holidayName}
        </div>
      )}

      <div data-no-swipe className="mb-4">
        <BlockDayButton
          dateKey={selectedDayKey}
          busyEventId={busyEvent?.id ?? null}
          blocked={effectiveBlocked}
          hasBookings={hasBookings}
          locked={isPastEditWindow(nzDayEndMs(selectedDayKey), renderedAt, lockHours)}
          pending={pendingDays.has(selectedDayKey)}
          onPending={setPending}
          onChanged={debouncedRefresh}
          onOptimisticChange={applyOptimisticBlock}
          variant="full"
        />
      </div>

      {visibleAllDayEvents.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {visibleAllDayEvents.map((ev) => (
            <div
              key={ev.id}
              data-no-swipe
              className={cn(
                "rounded-md border px-3 py-2 text-sm font-semibold",
                KIND_STYLES[ev.kind],
              )}
              title={ev.title}
            >
              <div className="truncate">{ev.title}</div>
              {ev.location && (
                <div className="mt-0.5 truncate text-xs font-normal opacity-80">{ev.location}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {agendaItems.length === 0 ? (
          <p className="rounded-md border border-dashed border-admin-border bg-admin-surface px-4 py-8 text-center text-sm text-admin-faint">
            No timed events on this day.
          </p>
        ) : (
          agendaItems.map((item, idx) => {
            if (item.type === "gap") {
              return (
                <div
                  key={`gap-${idx}`}
                  className="flex items-center gap-2 px-2 text-[11px] font-medium tracking-wide text-admin-faint uppercase"
                  aria-hidden
                >
                  <span className="h-px flex-1 bg-admin-border" />
                  {formatGap(item.minutes)}
                  <span className="h-px flex-1 bg-admin-border" />
                </div>
              );
            }
            const ev = item.ev;
            const isInteractive = ev.kind === "booking" && Boolean(ev.booking);
            const isExpanded = expandedEventId === ev.id;
            return (
              <div
                key={ev.id}
                data-no-swipe
                onPointerDown={isInteractive ? (e) => onCardPointerDown(e, ev) : undefined}
                onPointerMove={isInteractive ? onCardPointerMove : undefined}
                onPointerUp={isInteractive ? clearLongPress : undefined}
                onPointerCancel={isInteractive ? clearLongPress : undefined}
                onPointerLeave={isInteractive ? clearLongPress : undefined}
                onClick={isInteractive ? () => handleCardClick(ev.id) : undefined}
                role={isInteractive ? "button" : undefined}
                tabIndex={isInteractive ? 0 : undefined}
                aria-expanded={isInteractive ? isExpanded : undefined}
                className={cn(
                  "flex overflow-hidden rounded-md border border-admin-border bg-admin-surface shadow-sm",
                  isInteractive && "cursor-pointer transition-colors hover:bg-admin-bg",
                )}
              >
                <div className={cn("w-1.5 shrink-0", KIND_BAR_BG[ev.kind])} />
                <div className="min-w-0 flex-1 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-admin-muted">
                      {formatTimeRange(ev.startAt, ev.endAt)}
                    </div>
                    {ev.booking && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          BOOKING_STATUS_CHIP[ev.booking.status],
                        )}
                      >
                        {ev.booking.status}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-sm font-semibold text-admin-text">{ev.title}</div>
                  {ev.location && (
                    <div className="truncate text-xs text-admin-muted">{ev.location}</div>
                  )}
                  {isExpanded && ev.booking && (
                    <div className="mt-3 flex flex-col gap-3 border-t border-admin-border pt-3 text-sm">
                      <div className="flex flex-wrap gap-2">
                        {ev.booking.phone && (
                          <a
                            href={`tel:${ev.booking.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-russian-violet/10 px-3 text-sm font-semibold text-russian-violet hover:bg-russian-violet/20"
                          >
                            Call {ev.booking.phone}
                          </a>
                        )}
                        <a
                          href={`mailto:${ev.booking.email}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-russian-violet/10 px-3 text-sm font-semibold text-russian-violet hover:bg-russian-violet/20"
                        >
                          Email
                        </a>
                        {ev.booking.address && (
                          <a
                            href={`https://maps.google.com/?q=${encodeURIComponent(
                              ev.booking.address,
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-russian-violet/10 px-3 text-sm font-semibold text-russian-violet hover:bg-russian-violet/20"
                          >
                            Open in Maps
                          </a>
                        )}
                      </div>
                      {ev.booking.address && (
                        <div className="text-xs text-admin-muted">
                          <span className="text-admin-faint">Address: </span>
                          {ev.booking.address}
                        </div>
                      )}
                      {ev.booking.notes && (
                        <div className="text-xs whitespace-pre-wrap text-admin-text-secondary">
                          <span className="text-admin-faint">Notes: </span>
                          {ev.booking.notes}
                        </div>
                      )}
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-admin-faint">
                        <span className="font-mono">#{ev.booking.id}</span>
                        <span className="italic">Hold to edit</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <button
        type="button"
        onClick={handleAddBooking}
        data-no-swipe
        className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg bg-russian-violet px-4 text-sm font-semibold text-white hover:opacity-90"
      >
        Add booking on this day
      </button>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-admin-muted">
        <LegendDot kind="booking" label="Booking" />
        <LegendDot kind="car" label="No car" />
        <LegendDot kind="personal" label="Personal" />
        <LegendDot kind="travel" label="Travel" />
      </div>

      {modalStartAt && (
        <ManualBookingModal startAtIso={modalStartAt} onClose={() => setModalStartAt(null)} />
      )}

      {actionSheetEvent?.booking && (
        <EventActionSheet
          event={actionSheetEvent as WeekEvent & { booking: NonNullable<WeekEvent["booking"]> }}
          lockHours={lockHours}
          onChanged={() => router.refresh()}
          onClose={() => setActionSheetEvent(null)}
        />
      )}
    </div>
  );
}
