// src/lib/booking.ts
/**
 * @file booking.ts
 * @description Booking domain logic with simplified time-of-day preferences.
 * Clients pick a day and time window, you confirm the exact time.
 */

import type { CalendarEvent } from "@/server/google/calendar";

/**
 * Configuration for the booking system.
 */
export interface BookingConfig {
  /** Buffer time in minutes after each booking (for travel). */
  bufferMin: number;
  /** Maximum days in advance that can be booked. */
  maxAdvanceDays: number;
  /** IANA time zone identifier for the booking calendar. */
  timeZone: string;
  /** Earliest bookable hour (24h format). */
  dayStartHour: number;
  /** Latest bookable hour (24h format). */
  dayEndHour: number;
  /** Hour of day after which same-day bookings are not allowed (24h format). */
  sameDayCutoffHour: number;
}

/**
 * Time of day preference for booking.
 */
export type TimeOfDay =
  | "morning"
  | "late-morning"
  | "early-afternoon"
  | "late-afternoon"
  | "early-evening"
  | "late-evening";

/**
 * Time of day option with label and hour range.
 */
export interface TimeOfDayOption {
  /** Unique identifier. */
  value: TimeOfDay;
  /** Display label. */
  label: string;
  /** Start hour (24h format). */
  startHour: number;
  /** End hour (24h format). */
  endHour: number;
}

/**
 * A single available day for booking.
 */
export interface BookableDay {
  /** Date string in YYYY-MM-DD format. */
  dateKey: string;
  /** Human-readable label (e.g., "Mon 3 Feb"). */
  label: string;
  /** Full date label (e.g., "Monday, 3 February"). */
  fullLabel: string;
  /** Whether this is today. */
  isToday: boolean;
  /** Whether this is a weekend. */
  isWeekend: boolean;
  /** Available time slots for this day. */
  availableTimes: TimeOfDay[];
}

/**
 * Booking configuration:
 * - 10am to 7pm working hours
 * - 30 minute buffer after bookings
 * - Same-day bookings allowed before 6pm
 * - Up to 14 days ahead
 * - Pacific/Auckland time zone
 */
export const BOOKING_CONFIG: BookingConfig = {
  bufferMin: 30,
  maxAdvanceDays: 14,
  timeZone: "Pacific/Auckland",
  dayStartHour: 10,
  dayEndHour: 19, // 7pm
  sameDayCutoffHour: 18, // 6pm - no same-day bookings after this
};

/**
 * Time of day options - narrower 1.5-2 hour windows.
 */
export const TIME_OF_DAY_OPTIONS: readonly TimeOfDayOption[] = [
  { value: "morning", label: "10:00am–11:30am", startHour: 10, endHour: 11.5 },
  { value: "late-morning", label: "11:30am–1:00pm", startHour: 11.5, endHour: 13 },
  {
    value: "early-afternoon",
    label: "1:00pm–2:30pm",
    startHour: 13,
    endHour: 14.5,
  },
  {
    value: "late-afternoon",
    label: "2:30pm–4:00pm",
    startHour: 14.5,
    endHour: 16,
  },
  { value: "early-evening", label: "4:00pm–5:30pm", startHour: 16, endHour: 17.5 },
  { value: "late-evening", label: "5:30pm–7:00pm", startHour: 17.5, endHour: 19 },
] as const;

const MS_PER_MIN = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

/**
 * Get time-zone wall-clock parts for a given UTC date.
 */
function getZonedParts(
  dateUtc: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-NZ", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = dtf.formatToParts(dateUtc);
  const values: Record<string, string> = {};

  for (const p of parts) {
    if (p.type !== "literal") {
      values[p.type] = p.value;
    }
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: weekdayMap[values.weekday] ?? 0,
  };
}

/**
 * Convert a wall-clock time in a time zone into a UTC Date.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const zoned = getZonedParts(approxUtc, timeZone);
  const zonedAsUtcMs = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    0,
  );
  const offsetMs = zonedAsUtcMs - approxUtc.getTime();
  return new Date(approxUtc.getTime() - offsetMs);
}

/**
 * Format a date label in the configured time zone.
 */
function formatInTimeZone(
  dateUtc: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-NZ", { timeZone, ...options }).format(dateUtc);
}

/**
 * Check if a time range overlaps with any existing events (including buffer).
 */
function hasConflict(
  startUtc: Date,
  endUtc: Date,
  events: CalendarEvent[],
  bufferMin: number,
): boolean {
  const startMs = startUtc.getTime();
  const endMs = endUtc.getTime() + bufferMin * MS_PER_MIN;

  return events.some((event) => {
    const eventStartMs = event.startUtc.getTime();
    const eventEndMs = event.endUtc.getTime() + bufferMin * MS_PER_MIN;
    return startMs < eventEndMs && endMs > eventStartMs;
  });
}

/**
 * Check if a time-of-day window is available on a given date.
 */
function isTimeWindowAvailable(
  dateKey: string,
  timeOption: TimeOfDayOption,
  events: CalendarEvent[],
  config: BookingConfig,
): boolean {
  const [year, month, day] = dateKey.split("-").map(Number);

  // Check if any hour in this window is free
  for (let hour = timeOption.startHour; hour < timeOption.endHour; hour++) {
    const slotStart = zonedTimeToUtc(config.timeZone, year, month, day, hour, 0);
    const slotEnd = zonedTimeToUtc(config.timeZone, year, month, day, hour + 1, 0);

    if (!hasConflict(slotStart, slotEnd, events, config.bufferMin)) {
      return true;
    }
  }

  return false;
}

/**
 * Build the list of available days for booking.
 */
export function buildAvailableDays(
  existingEvents: CalendarEvent[],
  now: Date,
  config: BookingConfig,
): BookableDay[] {
  const days: BookableDay[] = [];
  const nowZoned = getZonedParts(now, config.timeZone);

  for (let dayOffset = 0; dayOffset <= config.maxAdvanceDays; dayOffset++) {
    const baseUtc = zonedTimeToUtc(
      config.timeZone,
      nowZoned.year,
      nowZoned.month,
      nowZoned.day,
      12,
      0,
    );
    const targetUtc = new Date(baseUtc.getTime() + dayOffset * MS_PER_DAY);
    const targetZoned = getZonedParts(targetUtc, config.timeZone);

    const isToday = dayOffset === 0;
    const isWeekend = targetZoned.weekday === 0 || targetZoned.weekday === 6;

    // Check same-day cutoff
    if (isToday && nowZoned.hour >= config.sameDayCutoffHour) {
      continue;
    }

    const dateKey = `${targetZoned.year}-${String(targetZoned.month).padStart(2, "0")}-${String(targetZoned.day).padStart(2, "0")}`;

    // Check which time windows are available
    const availableTimes: TimeOfDay[] = [];

    for (const timeOption of TIME_OF_DAY_OPTIONS) {
      // For today, skip time windows that have already passed
      if (isToday && timeOption.endHour <= nowZoned.hour + 1) {
        continue;
      }

      if (isTimeWindowAvailable(dateKey, timeOption, existingEvents, config)) {
        availableTimes.push(timeOption.value);
      }
    }

    if (availableTimes.length > 0) {
      const label = formatInTimeZone(targetUtc, config.timeZone, {
        weekday: "short",
        day: "numeric",
        month: "short",
      });

      const fullLabel = formatInTimeZone(targetUtc, config.timeZone, {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      days.push({
        dateKey,
        label,
        fullLabel,
        isToday,
        isWeekend,
        availableTimes,
      });
    }
  }

  return days;
}

/**
 * Validate a booking request.
 */
export function validateBookingRequest(
  dateKey: string,
  timeOfDay: TimeOfDay,
  existingEvents: CalendarEvent[],
  now: Date,
  config: BookingConfig,
): { valid: boolean; error?: string } {
  const dateParts = dateKey.split("-").map(Number);
  if (dateParts.length !== 3 || dateParts.some(isNaN)) {
    return { valid: false, error: "Invalid date format." };
  }

  const [year, month, day] = dateParts;
  const requestedDate = zonedTimeToUtc(config.timeZone, year, month, day, 12, 0);
  const nowZoned = getZonedParts(now, config.timeZone);
  const todayStart = zonedTimeToUtc(
    config.timeZone,
    nowZoned.year,
    nowZoned.month,
    nowZoned.day,
    0,
    0,
  );

  if (requestedDate.getTime() < todayStart.getTime()) {
    return { valid: false, error: "Cannot book dates in the past." };
  }

  const maxDate = new Date(todayStart.getTime() + config.maxAdvanceDays * MS_PER_DAY);
  if (requestedDate.getTime() > maxDate.getTime()) {
    return { valid: false, error: "Date is too far in the future." };
  }

  const isToday = year === nowZoned.year && month === nowZoned.month && day === nowZoned.day;
  if (isToday && nowZoned.hour >= config.sameDayCutoffHour) {
    return { valid: false, error: "Same-day bookings must be made before 6pm." };
  }

  const timeOption = TIME_OF_DAY_OPTIONS.find((t) => t.value === timeOfDay);
  if (!timeOption) {
    return { valid: false, error: "Invalid time preference." };
  }

  if (isToday && timeOption.endHour <= nowZoned.hour + 1) {
    return { valid: false, error: "This time window has already passed." };
  }

  if (!isTimeWindowAvailable(dateKey, timeOption, existingEvents, config)) {
    return { valid: false, error: "This time is no longer available." };
  }

  return { valid: true };
}
