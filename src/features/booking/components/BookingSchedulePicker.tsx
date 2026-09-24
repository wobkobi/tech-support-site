"use client";
// Schedule section of the booking form: duration, day and start-time pickers.

import type {
  BookableDay,
  JobDuration,
  StartMinute,
  TimeOfDay,
} from "@/features/booking/lib/booking";
import {
  buildDurationOptions,
  DAY_ANCHOR,
  durationText,
  subSlotLabel,
} from "@/features/booking/lib/booking-form";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** One hourly window of a bookable day. */
type TimeWindow = BookableDay["timeWindows"][number];

export interface BookingSchedulePickerProps {
  /** Days offered for booking. */
  availableDays: BookableDay[];
  /** Live job durations (minutes) for the picker labels. */
  durations: { short: number; long: number };
  /** Chosen job duration. */
  duration: JobDuration;
  /** Called when the customer picks a duration. */
  onDurationChange: (duration: JobDuration) => void;
  /** Chosen day, resolved against the current `availableDays`. */
  selectedDay: BookableDay | null;
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
 * @param props.availableDays - Days offered for booking.
 * @param props.durations - Live job durations (minutes) for the picker labels.
 * @param props.duration - Chosen job duration.
 * @param props.onDurationChange - Called when the customer picks a duration.
 * @param props.selectedDay - Chosen day, or null.
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

  // One run in date order, so tomorrow always sits next to today even when it's a
  // Saturday. Each label carries its weekday name, so weekends still read as such.
  const daysInOrder = [...availableDays].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const dayHasNoRoom =
    selectedDay?.timeWindows.every((w) =>
      duration === "short" ? !w.availableShort : !w.availableLong,
    ) ?? false;
  // One polite status line for the schedule picker, instead of a live region
  // over the whole time grid that re-announced every button on each change.
  const scheduleStatus = !selectedDay
    ? ""
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
                    !day.hasAnySlots && "cursor-not-allowed opacity-50",
                    selectedDay?.dateKey === day.dateKey
                      ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                      : day.hasAnySlots
                        ? "border-seasalt-200/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                        : "border-seasalt-200/40 bg-white/20 text-rich-black/60",
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
        <fieldset id="booking-time" className="flex min-w-0 flex-col gap-3">
          <legend className="mb-3 text-base font-semibold text-rich-black">
            Start time for {selectedDay.fullLabel}
          </legend>

          {dayHasNoRoom ? (
            <div className="rounded-lg border border-seasalt-200/80 bg-white/30 p-4">
              <p className="text-base text-rich-black/70">
                Sorry, this day has no room for {durationText(durations[duration])}.
                {duration === "long" &&
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
                        !available && "cursor-not-allowed opacity-40",
                        isSelected
                          ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                          : available
                            ? "border-seasalt-200/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                            : "border-seasalt-200/40 bg-white/30 text-rich-black/60",
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
                          !available && "cursor-not-allowed opacity-40",
                          selectedMinute === minute
                            ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                            : available
                              ? "border-seasalt-200/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                              : "border-seasalt-200/40 bg-white/30 text-rich-black/60",
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
