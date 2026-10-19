"use client";
// src/features/admin/components/DayAgendaView.tsx
// Mobile single-day schedule: one NZ day as a vertical agenda with swipe navigation.
// Owns the state and gestures; DayAgendaHeader and DayAgendaList render it.

import { BlockDayButton } from "@/features/admin/components/BlockDayButton";
import { DayAgendaHeader } from "@/features/admin/components/DayAgendaHeader";
import { DayAgendaList, type AgendaItem } from "@/features/admin/components/DayAgendaList";
import { EventActionSheet } from "@/features/admin/components/EventActionSheet";
import { ManualBookingModal } from "@/features/admin/components/ManualBookingModal";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useOptimisticDayBlocks } from "@/features/admin/hooks/use-optimistic-day-blocks";
import {
  KIND_STYLES,
  LegendDot,
  mondayOf,
  optimisticBusyEvent,
  type WeekEvent,
} from "@/features/admin/lib/schedule-types";
import { Notice } from "@/shared/components/Notice";
import { cn } from "@/shared/lib/cn";
import { isPastEditWindow, nzDayEndMs } from "@/shared/lib/edit-window";
import {
  NZ_TZ,
  addDaysToDateKey,
  dateKeyParts,
  getPacificAucklandOffset,
  nzDateKey,
  nzWallClockUtc,
} from "@/shared/lib/timezone-utils";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

/** Minimum gap between consecutive bookings to render a "free" label. */
const MIN_GAP_MINUTES = 30;

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
 * Mobile single-day agenda. Stepping within the fetched window is client-side;
 * leaving it calls router.push to refetch.
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
  const { pendingDays, optimisticBlock, setPending, applyOptimisticBlock, debouncedRefresh } =
    useOptimisticDayBlocks(events);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [actionSheetEvent, setActionSheetEvent] = useState<WeekEvent | null>(null);
  // Stable "now" for the past-event lock (avoids an impure call during render).
  const [renderedAt] = useState(() => Date.now());
  // Ticking clock for the now marker; renderedAt stays frozen so the lock doesn't shift.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  // Keeps the current view up while the next week fetches.
  const [isPending, startTransition] = useTransition();
  const dateInputRef = useRef<HTMLInputElement>(null);

  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);
  // Long-press state; the "fired" flag stops the following click toggling expand.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef<boolean>(false);

  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_THRESHOLD = 10;

  const [yy, mm, dd] = dateKeyParts(selectedDayKey);
  const offset = getPacificAucklandOffset(yy, mm, dd);

  const { dayLabel, prevDayKey, nextDayKey } = useMemo(() => {
    const noonUtc = nzWallClockUtc(yy, mm, dd, 12);
    // Short month: "Wednesday 17 September" truncates on a 360px phone.
    const dayFmt = new Intl.DateTimeFormat("en-NZ", {
      timeZone: NZ_TZ,
      weekday: "long",
      day: "numeric",
      month: "short",
    });
    return {
      dayLabel: dayFmt.format(noonUtc),
      prevDayKey: addDaysToDateKey(selectedDayKey, -1),
      nextDayKey: addDaysToDateKey(selectedDayKey, 1),
    };
  }, [yy, mm, dd, selectedDayKey]);

  // All-day events are end-exclusive so multi-day Busy blocks show on every day they cover.
  const { agendaItems, timedEvents, allDayEvents } = useMemo(() => {
    const timed: WeekEvent[] = [];
    const allDay: WeekEvent[] = [];
    for (const ev of events) {
      if (ev.isAllDay) {
        const startKey = nzDateKey(new Date(ev.startAt));
        const endKey = nzDateKey(new Date(ev.endAt));
        if (selectedDayKey >= startKey && selectedDayKey < endKey) allDay.push(ev);
      } else {
        const key = nzDateKey(new Date(ev.startAt));
        if (key === selectedDayKey) timed.push(ev);
      }
    }
    // Parse first: lexical sort breaks mixing Google's `+12:00` strings with UTC `Z` ones.
    timed.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

    // Only booking>booking gaps get a free-time label.
    const items: AgendaItem[] = [];
    for (let i = 0; i < timed.length; i++) {
      const cur = timed[i]!;
      items.push({ type: "event", ev: cur });
      const next = timed[i + 1];
      if (!next) continue;
      if (cur.kind !== "booking" || next.kind !== "booking") continue;
      const gapMs = new Date(next.startAt).getTime() - new Date(cur.endAt).getTime();
      const gapMin = Math.round(gapMs / 60_000);
      if (gapMin >= MIN_GAP_MINUTES) items.push({ type: "gap", minutes: gapMin });
    }

    // Now marker goes before the first event still to come; skipped on an empty day.
    if (timed.length > 0 && selectedDayKey === nzDateKey(new Date(nowMs))) {
      const next = items.findIndex(
        (it) => it.type === "event" && new Date(it.ev.startAt).getTime() > nowMs,
      );
      const marker: AgendaItem = { type: "now", atMs: nowMs };
      if (next === -1) items.push(marker);
      else items.splice(next, 0, marker);
    }

    return { agendaItems: items, timedEvents: timed, allDayEvents: allDay };
  }, [events, selectedDayKey, nowMs]);

  const holidayName = holidaysByDateKey[selectedDayKey] ?? null;
  // Optimistic override: true = blocked, false = free, undefined = real calendar.
  // `busyEvent` excludes the placeholder since it carries the unblock id.
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

  // Week strip: Monday-to-Sunday around the selected day, with a booking count per day.
  const weekDays = useMemo(() => {
    const mondayKey = mondayOf(selectedDayKey);
    return Array.from({ length: 7 }, (_, i) => {
      const dayKey = addDaysToDateKey(mondayKey, i);
      const [y, m, d] = dateKeyParts(dayKey);
      const noon = nzWallClockUtc(y, m, d, 12);
      const weekday = new Intl.DateTimeFormat("en-NZ", {
        timeZone: NZ_TZ,
        weekday: "narrow",
      }).format(noon);
      const dayOfMonth = new Intl.DateTimeFormat("en-NZ", {
        timeZone: NZ_TZ,
        day: "numeric",
      }).format(noon);
      let count = 0;
      for (const ev of events) {
        if (ev.kind !== "booking" || ev.isAllDay) continue;
        if (nzDateKey(new Date(ev.startAt)) === dayKey) count++;
      }
      return { key: dayKey, weekday, dayOfMonth, count };
    });
  }, [selectedDayKey, events]);

  /**
   * Navigates to a day: client-side inside the 21-day buffer, else router.push.
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
      // The server derives weekStart from `day`; drop it so the two can't drift.
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
   * Swipe-end handler: steps a day when the gesture is fast and horizontal enough.
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
   * Starts the long-press timer on a booking card, clearing any prior one.
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
   * Cancels the long-press when the finger drifts, so swipes don't open the sheet.
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
   * Toggles a booking card's expanded view, unless a long-press just fired.
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
   * Opens the booking modal at the next half-hour today, or 9am NZ otherwise.
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
      className={cn("touch-pan-y transition-opacity", isPending && "opacity-60")}
    >
      <DayAgendaHeader
        weekDays={weekDays}
        selectedDayKey={selectedDayKey}
        todayKey={todayKey}
        dayLabel={dayLabel}
        isToday={isToday}
        bookingCount={bookingCount}
        dateInputRef={dateInputRef}
        onGoToDay={goToDay}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onOpenDatePicker={openDatePicker}
        onDateChange={handleDateChange}
      />

      {holidayName && (
        // Amber matches the week grid; Notice has no amber tone.
        <Notice className="mb-3 border-amber-500 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Public holiday: {holidayName}
        </Notice>
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
                "rounded-md border px-3 py-2 text-[0.9375rem] font-semibold",
                KIND_STYLES[ev.kind],
              )}
              title={ev.title}
            >
              <div className="truncate">{ev.title}</div>
              {ev.location && (
                <div className="mt-0.5 truncate text-sm font-normal opacity-80">{ev.location}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <DayAgendaList
        agendaItems={agendaItems}
        expandedEventId={expandedEventId}
        onCardPointerDown={onCardPointerDown}
        onCardPointerMove={onCardPointerMove}
        onClearLongPress={clearLongPress}
        onCardClick={handleCardClick}
      />

      {/* The wrapper carries data-no-swipe, which AdminButton doesn't forward. */}
      <div data-no-swipe className="mt-6">
        <AdminButton onClick={handleAddBooking} className="h-12 w-full">
          Add booking on this day
        </AdminButton>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-admin-muted">
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
