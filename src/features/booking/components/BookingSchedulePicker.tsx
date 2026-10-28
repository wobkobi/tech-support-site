"use client";
// src/features/booking/components/BookingSchedulePicker.tsx
// Schedule section of the booking form: duration, day and start-time pickers.

import {
  offersAfterHoursStart,
  type BookableDay,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import {
  buildDurationOptions,
  DAY_ANCHOR,
  durationText,
  subSlotLabel,
} from "@/features/booking/lib/booking-form";
import { dateSurchargeNote, eveningTickLabel } from "@/features/business/lib/pricing-policy";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** One hourly window of a bookable day. */
type TimeWindow = BookableDay["timeWindows"][number];

export interface BookingSchedulePickerProps {
  /** Days offered for booking, evening starts included. */
  availableDays: BookableDay[];
  /** Live job durations (minutes) for the picker labels. */
  durations: { short: number; long: number };
  /** Chosen job duration. */
  duration: JobDuration;
  /** Called when the customer picks a duration. */
  onDurationChange: (duration: JobDuration) => void;
  /** Chosen day as shown, without its evening starts unless `showEvenings` is on. */
  selectedDay: BookableDay | null;
  /** Whether the customer ticked Show evening times. */
  showEvenings: boolean;
  /** Called when the customer ticks or unticks Show evening times. */
  onShowEveningsChange: (on: boolean) => void;
  /** Chosen time window, or null. */
  selectedTime: TimeOfDay | null;
  /** Chosen minute past the hour. */
  selectedMinute: StartMinute;
  /** The chosen time window's data, or null when no time is picked. */
  activeWindow: TimeWindow | null;
  /** Label of the picked start time ("2:15pm"), or null. */
  timeLabel: string | null;
  /** Owner phone link for the no-availability fallback, or null. */
  phoneLink: React.ReactNode;
  /** Called when the customer picks a day. */
  onDaySelect: (day: BookableDay) => void;
  /** Called when the customer picks an hour, with its first free minute. */
  onTimeSelect: (time: TimeOfDay, minute: StartMinute) => void;
  /** Called when the customer picks a minute within the chosen hour. */
  onMinuteSelect: (minute: StartMinute) => void;
}

/**
 * Duration, day and start-time pickers for the booking form.
 * @param props - Component props.
 * @param props.availableDays - Days offered for booking, evening starts included.
 * @param props.durations - Live job durations (minutes) for the picker labels.
 * @param props.duration - Chosen job duration.
 * @param props.onDurationChange - Called when the customer picks a duration.
 * @param props.selectedDay - Chosen day as shown, or null.
 * @param props.showEvenings - Whether the customer ticked Show evening times.
 * @param props.onShowEveningsChange - Called when the customer ticks or unticks it.
 * @param props.selectedTime - Chosen time window, or null.
 * @param props.selectedMinute - Chosen minute past the hour.
 * @param props.activeWindow - The chosen time window's data, or null.
 * @param props.timeLabel - Label of the picked start time, or null.
 * @param props.phoneLink - Owner phone link for the no-availability fallback.
 * @param props.onDaySelect - Called when the customer picks a day.
 * @param props.onTimeSelect - Called when the customer picks an hour.
 * @param props.onMinuteSelect - Called when the customer picks a minute.
 * @returns The schedule fieldset.
 */
export function BookingSchedulePicker({
  availableDays,
  durations,
  duration,
  onDurationChange,
  selectedDay,
  showEvenings,
  onShowEveningsChange,
  selectedTime,
  selectedMinute,
  activeWindow,
  timeLabel,
  phoneLink,
  onDaySelect,
  onTimeSelect,
  onMinuteSelect,
}: BookingSchedulePickerProps): React.ReactElement {
  const durationOptions = buildDurationOptions(durations);

  // The tick shows on a weekday with an open evening start for this duration, and stays while
  // ticked so it can be unticked. Read from the full day, as the shown one has evenings removed.
  const fullDay = availableDays.find((d) => d.dateKey === selectedDay?.dateKey);
  const eveningTick =
    fullDay?.afterHours && (showEvenings || offersAfterHoursStart(fullDay, duration))
      ? fullDay.afterHours
      : null;

  // One run in date order, so tomorrow always sits next to today even when it's a
  // Saturday. Each label carries its weekday name, so weekends still read as such.
  const daysInOrder = [...availableDays].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const dayHasNoRoom =
    selectedDay?.timeWindows.every((w) =>
      duration === "short" ? !w.availableShort : !w.availableLong,
    ) ?? false;
  const onlyEveningsLeft = dayHasNoRoom && !!eveningTick && !showEvenings;
  // One polite status line for the schedule picker, instead of a live region
  // over the whole time grid that re-announced every button on each change.
  const scheduleStatus = !selectedDay
    ? ""
    : onlyEveningsLeft
      ? `${selectedDay.fullLabel} only has evening times left.`
      : dayHasNoRoom
        ? `${selectedDay.fullLabel} has no room for ${durationText(durations[duration])}.`
        : timeLabel
          ? `${timeLabel} on ${selectedDay.fullLabel} selected.`
          : `${selectedDay.fullLabel}: choose a start time.`;

  return (
    <fieldset className="flex flex-col gap-6">
      <legend className="mb-1 text-xl font-bold text-russian-violet sm:text-2xl">Schedule</legend>

      <p aria-live="polite" className="sr-only">
        {scheduleStatus}
      </p>

      {/* Duration */}
      <fieldset id="booking-duration" className="min-w-0">
        <legend className="mb-2 text-base font-semibold text-rich-black">
          How long do you need? <span className="text-error">*</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {durationOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={duration === opt.value}
              onClick={() => onDurationChange(opt.value)}
              className={cn(
                "rounded-lg border p-4 text-left transition-colors",
                duration === opt.value
                  ? "border-russian-violet bg-russian-violet/10"
                  : "border-seasalt-200/60 bg-seasalt hover:border-russian-violet/40",
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-semibold text-rich-black">{opt.label}</p>
                  <p className="mt-1 text-base text-rich-black/70">{opt.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-base text-rich-black/70">
          Duration is just an estimate for scheduling. Most appointments are 1 hour. Choose 2 hours
          if you have multiple issues or complex setup needs.
        </p>
      </fieldset>

      {/* Day Selection */}
      <fieldset id={DAY_ANCHOR} className="min-w-0">
        <legend className="mb-2 text-base font-semibold text-rich-black">Choose a day</legend>

        {!availableDays.some((d) => d.hasAnySlots) ? (
          <p className="text-base text-rich-black/70">
            No availability in the next two weeks. Please call or text me
            {phoneLink ? <> on {phoneLink}</> : " directly"}.
          </p>
        ) : (
          // pt-5 reserves space above the first row for the Today/Tomorrow labels
          // that sit fully outside their button; both are always first in date order.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-2 gap-y-3 pt-5">
            {daysInOrder.map((day) => (
              <div key={day.dateKey} className="relative">
                {(day.isToday || day.isTomorrow) && day.hasAnySlots && (
                  <span className="absolute -top-5 right-0 left-0 text-center text-sm leading-5 font-bold tracking-wide text-coquelicot-600 uppercase">
                    {day.isToday ? "Today" : "Tomorrow"}
                  </span>
                )}
                <button
                  type="button"
                  aria-pressed={selectedDay?.dateKey === day.dateKey}
                  disabled={!day.hasAnySlots}
                  onClick={() => onDaySelect(day)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-base font-medium whitespace-nowrap",
                    !day.hasAnySlots && "cursor-not-allowed line-through",
                    selectedDay?.dateKey === day.dateKey
                      ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                      : day.hasAnySlots
                        ? "border-seasalt-200/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                        : "border-dashed border-seasalt-300 bg-seasalt-100 text-rich-black/55",
                    day.isToday && day.hasAnySlots && "ring-2 ring-coquelicot-500/50 ring-offset-1",
                  )}
                >
                  {day.dayLabel}
                </button>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      {/* Time Selection */}
      {selectedDay && (
        // Named by the heading alone, so the tick's label doesn't read as part of the group name.
        <fieldset
          id="booking-time"
          aria-labelledby="booking-time-heading"
          className="flex min-w-0 flex-col gap-3"
        >
          {/* The day's surcharge note or the evening tick sits beside the heading, wrapping
              under it on a phone. */}
          <legend className="mb-3 flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 text-base font-semibold text-rich-black">
            <span id="booking-time-heading">Start time for {selectedDay.fullLabel}</span>
            {selectedDay.surcharge ? (
              <span className="font-normal text-rich-black/80">
                {dateSurchargeNote(selectedDay.surcharge)}
              </span>
            ) : (
              eveningTick && (
                <label
                  htmlFor="booking-evenings"
                  className="flex min-h-11 cursor-pointer items-center gap-3 font-normal text-rich-black/80"
                >
                  <input
                    id="booking-evenings"
                    type="checkbox"
                    checked={showEvenings}
                    onChange={(e) => onShowEveningsChange(e.target.checked)}
                    className="size-5 shrink-0 cursor-pointer accent-russian-violet"
                  />
                  <span>{eveningTickLabel(eveningTick.surcharge, eveningTick.fromHour)}</span>
                </label>
              )
            )}
          </legend>

          {dayHasNoRoom ? (
            <div className="rounded-lg border border-seasalt-200/80 bg-white/30 p-4">
              <p className="text-base text-rich-black/70">
                {onlyEveningsLeft
                  ? "Only evening times are left on this day. Tick Show evening times to see them, or choose another day."
                  : `Sorry, this day has no room for ${durationText(durations[duration])}.`}
                {duration === "long" &&
                  !onlyEveningsLeft &&
                  ` Try ${durationText(durations.short)} instead, or choose another day.`}
              </p>
            </div>
          ) : (
            <>
              {/* Hour picker */}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
                {selectedDay.timeWindows.map((window) => {
                  const available =
                    duration === "short" ? window.availableShort : window.availableLong;
                  const isSelected = selectedTime === window.value;
                  return (
                    <button
                      key={window.value}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={!available}
                      onClick={() => {
                        const firstAvailable = window.subSlots.find((s) =>
                          duration === "short" ? s.availableShort : s.availableLong,
                        );
                        onTimeSelect(window.value, firstAvailable?.minute ?? 0);
                      }}
                      className={cn(
                        "min-h-11 rounded-lg border px-4 py-2.5 text-base font-medium",
                        !available && "cursor-not-allowed line-through",
                        isSelected
                          ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                          : available
                            ? "border-seasalt-200/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                            : "border-dashed border-seasalt-300 bg-seasalt-100 text-rich-black/55",
                      )}
                    >
                      {window.label}
                    </button>
                  );
                })}
              </div>

              {/* Sub-slot picker - shown once an hour is selected */}
              {activeWindow && (
                <div className="flex flex-wrap gap-2">
                  {activeWindow.subSlots.map((sub) => {
                    const minute = sub.minute;
                    const available = duration === "short" ? sub.availableShort : sub.availableLong;
                    return (
                      <button
                        key={minute}
                        type="button"
                        aria-pressed={selectedMinute === minute}
                        disabled={!available}
                        onClick={() => onMinuteSelect(minute)}
                        className={cn(
                          "min-h-11 rounded-lg border px-4 py-2 text-base font-medium",
                          !available && "cursor-not-allowed line-through",
                          selectedMinute === minute
                            ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                            : available
                              ? "border-seasalt-200/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                              : "border-dashed border-seasalt-300 bg-seasalt-100 text-rich-black/55",
                        )}
                      >
                        {subSlotLabel(activeWindow.startHour, minute)}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </fieldset>
      )}
    </fieldset>
  );
}
