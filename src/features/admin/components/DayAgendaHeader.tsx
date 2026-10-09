"use client";
// src/features/admin/components/DayAgendaHeader.tsx
// Sticky header band of the mobile day agenda: the mini 7-day strip and the day-picker bar
// (prev/next, date picker, booking count, Today). DayAgendaView owns the state; this only
// renders it and reports taps back.

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaCalendarDay, FaChevronLeft, FaChevronRight, FaRegCalendar } from "react-icons/fa6";

/** One cell of the mini week strip. */
export interface WeekStripDay {
  /** NZ YYYY-MM-DD. */
  key: string;
  /** Narrow weekday letter, e.g. "M". */
  weekday: string;
  /** Day of the month, e.g. "17". */
  dayOfMonth: string;
  /** Timed bookings starting that day. */
  count: number;
}

/** Props for {@link DayAgendaHeader}. */
interface DayAgendaHeaderProps {
  /** The Monday-to-Sunday week containing the selected day. */
  weekDays: WeekStripDay[];
  /** NZ YYYY-MM-DD of the selected day. */
  selectedDayKey: string;
  /** NZ YYYY-MM-DD of today. */
  todayKey: string;
  /** Selected day label, e.g. "Wednesday, 17 Sept". */
  dayLabel: string;
  /** Whether the selected day is today. */
  isToday: boolean;
  /** Timed bookings on the selected day. */
  bookingCount: number;
  /** Ref for the hidden native date input that the label button opens. */
  dateInputRef: React.RefObject<HTMLInputElement | null>;
  /** Jumps to a day from the strip. */
  onGoToDay: (dayKey: string) => void;
  /** Steps one day back. */
  onPrev: () => void;
  /** Steps one day forward. */
  onNext: () => void;
  /** Jumps to today. */
  onToday: () => void;
  /** Opens the native date picker. */
  onOpenDatePicker: () => void;
  /** Handles a pick from the native date input. */
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Stops pointer events from bubbling out of the band so the agenda's swipe handler never
 * sees them - chevron taps always fire as clicks.
 * @param e - Pointer event.
 */
function stopPointer(e: React.PointerEvent<HTMLElement>): void {
  e.stopPropagation();
}

/**
 * Sticky week strip and day-picker bar.
 * @param props - Component props.
 * @param props.weekDays - Week strip cells.
 * @param props.selectedDayKey - Selected NZ day key.
 * @param props.todayKey - Today's NZ day key.
 * @param props.dayLabel - Selected day label.
 * @param props.isToday - Whether the selected day is today.
 * @param props.bookingCount - Timed bookings on the selected day.
 * @param props.dateInputRef - Ref for the hidden date input.
 * @param props.onGoToDay - Jumps to a strip day.
 * @param props.onPrev - Steps one day back.
 * @param props.onNext - Steps one day forward.
 * @param props.onToday - Jumps to today.
 * @param props.onOpenDatePicker - Opens the native date picker.
 * @param props.onDateChange - Handles a native date pick.
 * @returns The sticky header band.
 */
export function DayAgendaHeader({
  weekDays,
  selectedDayKey,
  todayKey,
  dayLabel,
  isToday,
  bookingCount,
  dateInputRef,
  onGoToDay,
  onPrev,
  onNext,
  onToday,
  onOpenDatePicker,
  onDateChange,
}: DayAgendaHeaderProps): React.ReactElement {
  return (
    // Pinned to the top of the viewport while the events list scrolls under it. The band
    // sits at `top-14`, just under the shell's 56px sticky top bar, and `-mx-4` / `-mx-6`
    // so the page background covers the page edges as content scrolls behind.
    <div
      data-no-swipe
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      className="sticky top-14 z-10 -mx-4 mb-4 bg-admin-bg px-4 pt-1 pb-2 sm:-mx-6 sm:px-6"
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
              onClick={() => onGoToDay(wd.key)}
              aria-label={`${wd.weekday} ${wd.dayOfMonth}${wd.count > 0 ? `, ${wd.count} booking${wd.count === 1 ? "" : "s"}` : ""}`}
              aria-current={isSelected ? "date" : undefined}
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-md border transition-colors",
                isSelected
                  ? "border-russian-violet bg-russian-violet text-white"
                  : "border-admin-border bg-admin-surface text-admin-text hover:bg-admin-bg",
                !isSelected && isTodayCell && "ring-2 ring-russian-violet/40 ring-inset",
              )}
            >
              <span className="text-sm leading-none font-medium uppercase opacity-70">
                {wd.weekday}
              </span>
              <span className="text-sm leading-tight font-bold">{wd.dayOfMonth}</span>
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
      <div className="flex items-center justify-between gap-3 rounded-lg border border-admin-border bg-admin-surface px-2 py-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous day"
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-admin-text-secondary hover:bg-admin-bg"
        >
          <FaChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-col items-center gap-1 text-center">
          <button
            type="button"
            onClick={onOpenDatePicker}
            aria-label="Pick a date"
            className={cn(
              "inline-flex h-9 max-w-full items-center gap-1.5 rounded-md px-3 text-base font-bold hover:bg-admin-bg",
              isToday ? "text-russian-violet" : "text-admin-text",
            )}
          >
            <span className="truncate">{dayLabel}</span>
            <FaRegCalendar className="h-4 w-4 shrink-0 text-admin-faint" aria-hidden />
          </button>
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            {bookingCount > 0 && (
              <span className="inline-flex h-8 items-center rounded-full bg-russian-violet/10 px-3 font-semibold text-russian-violet">
                {bookingCount} booking{bookingCount === 1 ? "" : "s"}
              </span>
            )}
            {!isToday && (
              <button
                type="button"
                onClick={onToday}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-admin-border-strong bg-admin-surface px-3 font-semibold text-admin-text hover:border-russian-violet"
              >
                <FaCalendarDay className="h-3.5 w-3.5" />
                Today
              </button>
            )}
            {isToday && (
              <span className="inline-flex h-8 items-center rounded-full bg-admin-bg px-3 font-semibold tracking-wide text-admin-muted uppercase">
                Today
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next day"
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-admin-text-secondary hover:bg-admin-bg"
        >
          <FaChevronRight className="h-5 w-5" />
        </button>
        {/* Hidden native date input - opened via showPicker() from the day-label button. */}
        <input
          ref={dateInputRef}
          type="date"
          value={selectedDayKey}
          onChange={onDateChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
      </div>
    </div>
  );
}
