// src/lib/booking.ts
/**
 * @file booking.ts
 * @description Booking system with duration selection (1hr quick jobs vs 2hr standard jobs).
 */

import { getPacificAucklandOffset } from "@/lib/timezone-utils";

export const BOOKING_CONFIG = {
  timeZone: "Pacific/Auckland",
  maxAdvanceDays: 14,
  bufferMin: 15,
  minHoursNotice: 2,
  sameDayCutoffHour: 18,
  workStartHour: 10,
  workEndHour: 20,
} as const;

// Duration options
export type JobDuration = "short" | "long";

export interface DurationOption {
  value: JobDuration;
  label: string;
  description: string;
  durationMinutes: number;
}

export const DURATION_OPTIONS: ReadonlyArray<DurationOption> = [
  {
    value: "short",
    label: "Standard (1 hour)",
    description: "Most common appointment length",
    durationMinutes: 60,
  },
  {
    value: "long",
    label: "Extended (2 hours)",
    description: "For complex issues or multiple tasks",
    durationMinutes: 120,
  },
] as const;

export interface TimeOfDayOption {
  value: string;
  label: string;
  startHour: number;
  endHour: number;
}

// Hourly time slots (10am-6pm, last slot needs 2hrs for long jobs)
export const TIME_OF_DAY_OPTIONS: ReadonlyArray<TimeOfDayOption> = [
  { value: "10am", label: "10am", startHour: 10, endHour: 11 },
  { value: "11am", label: "11am", startHour: 11, endHour: 12 },
  { value: "12pm", label: "12pm", startHour: 12, endHour: 13 },
  { value: "1pm", label: "1pm", startHour: 13, endHour: 14 },
  { value: "2pm", label: "2pm", startHour: 14, endHour: 15 },
  { value: "3pm", label: "3pm", startHour: 15, endHour: 16 },
  { value: "4pm", label: "4pm", startHour: 16, endHour: 17 },
  { value: "5pm", label: "5pm", startHour: 17, endHour: 18 },
  { value: "6pm", label: "6pm", startHour: 18, endHour: 19 },
] as const;

export type TimeOfDay = (typeof TIME_OF_DAY_OPTIONS)[number]["value"];

export interface TimeWindow {
  value: TimeOfDay;
  label: string;
  availableShort: boolean; // Can fit 1hr job
  availableLong: boolean; // Can fit 2hr job
}

export interface BookableDay {
  dateKey: string;
  dayLabel: string;
  fullLabel: string;
  isToday: boolean;
  isWeekend: boolean;
  timeWindows: TimeWindow[];
  hasAnySlots: boolean; // True if any time slots are available
}

export interface ExistingBooking {
  id: string;
  startUtc: Date;
  endUtc: Date;
  bufferBeforeMin: number;
  bufferAfterMin: number;
}

export interface ExistingEvent {
  id: string;
  start: string;
  end: string;
}

/**
 * Check if a time slot conflicts with existing bookings/events
 * @param slotStart - Slot start time
 * @param slotEnd - Slot end time
 * @param existingBookings - Database bookings
 * @param calendarEvents - Calendar events
 * @param bufferMin - Buffer time in minutes
 * @returns True if slot is free
 */
function isSlotFree(
  slotStart: Date,
  slotEnd: Date,
  existingBookings: ExistingBooking[],
  calendarEvents: Array<{ start: string; end: string }>,
  bufferMin: number,
): boolean {
  // Check database bookings
  for (const booking of existingBookings) {
    const bookingStart = new Date(booking.startUtc.getTime() - booking.bufferBeforeMin * 60 * 1000);
    const bookingEnd = new Date(booking.endUtc.getTime() + booking.bufferAfterMin * 60 * 1000);

    if (slotStart < bookingEnd && slotEnd > bookingStart) {
      return false;
    }
  }

  // Check calendar events
  for (const event of calendarEvents) {
    const eventStart = new Date(new Date(event.start).getTime() - bufferMin * 60 * 1000);
    const eventEnd = new Date(new Date(event.end).getTime() + bufferMin * 60 * 1000);

    if (slotStart < eventEnd && slotEnd > eventStart) {
      return false;
    }
  }

  return true;
}

/**
 * Build available days with duration-aware slot checking
 * @param existingBookings - Array of existing bookings from database
 * @param calendarEvents - Array of calendar events to block
 * @param now - Current date/time
 * @param config - Booking configuration settings
 * @returns Array of bookable days with time windows
 */
export function buildAvailableDays(
  existingBookings: ExistingBooking[],
  calendarEvents: Array<{ id: string; start: string; end: string }>,
  now: Date,
  config: typeof BOOKING_CONFIG,
): BookableDay[] {
  const days: BookableDay[] = [];

  // Use toLocaleString only for extracting NZ wall-clock hour/minute —
  // getHours()/getMinutes() on the resulting Date give the correct NZ values
  // regardless of whether the server is in UTC or NZ local time.
  const nzTime = new Date(now.toLocaleString("en-US", { timeZone: config.timeZone }));
  const currentHourNZ = nzTime.getHours();
  const currentMinuteNZ = nzTime.getMinutes();

  // Derive today's NZ calendar date independently of server timezone.
  // en-CA locale reliably produces YYYY-MM-DD on all Node.js platforms.
  const todayNZStr = now.toLocaleDateString("en-CA", { timeZone: config.timeZone });
  const [startY, startM, startD] = todayNZStr.split("-").map(Number);

  for (let i = 0; i < config.maxAdvanceDays; i++) {
    // UTC noon for day i — using noon avoids any DST-induced date-boundary shift
    // when extracting UTC date components. JavaScript's Date constructor handles
    // month/day overflow automatically (e.g. day 32 wraps to the next month).
    const dayUTC = new Date(Date.UTC(startY, startM - 1, startD + i, 12, 0, 0));
    const dateKey = dayUTC.toISOString().split("T")[0];
    const dayOfWeek = dayUTC.getUTCDay();

    const isToday = i === 0;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Format labels
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const shortDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const dayLabel = `${shortDayNames[dayOfWeek]} ${dayUTC.getUTCDate()} ${monthNames[dayUTC.getUTCMonth()]}`;
    const fullLabel = `${dayNames[dayOfWeek]}, ${monthNames[dayUTC.getUTCMonth()]} ${dayUTC.getUTCDate()}`;

    const timeWindows: TimeWindow[] = [];

    // Extract year/month/day from dateKey for reliable timezone calculations
    const [year, month, day] = dateKey.split("-").map(Number);

    for (const slot of TIME_OF_DAY_OPTIONS) {
      const slotHour = slot.startHour;

      // Get dynamic UTC offset for this date (handles NZDT/NZST)
      const utcOffset = getPacificAucklandOffset(year, month, day);

      // Check 1-hour availability
      const shortStart = new Date(
        Date.UTC(
          year,
          month - 1, // Date.UTC expects 0-indexed month
          day,
          slotHour - utcOffset,
          0,
          0,
        ),
      );
      const shortEnd = new Date(shortStart.getTime() + 60 * 60 * 1000); // 1 hour

      let availableShort = isSlotFree(
        shortStart,
        shortEnd,
        existingBookings,
        calendarEvents,
        config.bufferMin,
      );

      // Check 2-hour availability
      const longEnd = new Date(shortStart.getTime() + 120 * 60 * 1000); // 2 hours
      let availableLong = isSlotFree(
        shortStart,
        longEnd,
        existingBookings,
        calendarEvents,
        config.bufferMin,
      );

      // Apply time-based rules
      if (isToday) {
        const minutesUntilSlot = (slotHour - currentHourNZ) * 60 - currentMinuteNZ;
        const hoursUntilSlot = minutesUntilSlot / 60;

        // 2-hour minimum notice
        if (hoursUntilSlot < config.minHoursNotice) {
          availableShort = false;
          availableLong = false;
        }

        // 6pm same day cutoff
        if (currentHourNZ >= config.sameDayCutoffHour) {
          availableShort = false;
          availableLong = false;
        }
      }

      timeWindows.push({
        value: slot.value,
        label: slot.label,
        availableShort,
        availableLong,
      });
    }

    // Check if day has any available slots
    const hasAnySlots = timeWindows.some((w) => w.availableShort || w.availableLong);

    // Skip any day that has no available slots — fully-blocked days are not shown.
    if (!hasAnySlots) {
      continue;
    }

    days.push({
      dateKey,
      dayLabel,
      fullLabel,
      isToday,
      isWeekend,
      timeWindows,
      hasAnySlots,
    });
  }

  return days;
}

/**
 * Validate booking request
 * @param dateKey - Selected date in YYYY-MM-DD format
 * @param timeOfDay - Selected time slot value
 * @param duration - Job duration (short or long)
 * @param existingBookings - Array of existing bookings from database
 * @param calendarEvents - Array of calendar events to check against
 * @param now - Current date/time
 * @param config - Booking configuration settings
 * @returns Validation result with success flag and optional error message
 */
export function validateBookingRequest(
  dateKey: string,
  timeOfDay: TimeOfDay,
  duration: JobDuration,
  existingBookings: ExistingBooking[],
  calendarEvents: Array<{ id: string; start: string; end: string }>,
  now: Date,
  config: typeof BOOKING_CONFIG,
): { valid: boolean; error?: string } {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) {
    return { valid: false, error: "Invalid date format" };
  }

  // Use UTC noon for both selected and today so comparisons are timezone-agnostic.
  // "Today" is derived from the NZ wall-clock date (same logic as buildAvailableDays).
  const selectedDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const todayNZStr = now.toLocaleDateString("en-CA", { timeZone: config.timeZone });
  const [ty, tm, td] = todayNZStr.split("-").map(Number);
  const today = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0));

  if (selectedDate < today) {
    return { valid: false, error: "Cannot book dates in the past" };
  }

  const maxDate = new Date(Date.UTC(ty, tm - 1, td + config.maxAdvanceDays, 12, 0, 0));
  if (selectedDate > maxDate) {
    return {
      valid: false,
      error: `Cannot book more than ${config.maxAdvanceDays} days in advance`,
    };
  }

  const slot = TIME_OF_DAY_OPTIONS.find((t) => t.value === timeOfDay);
  if (!slot) {
    return { valid: false, error: "Invalid time slot" };
  }

  // Get dynamic UTC offset for this date (handles NZDT/NZST)
  const utcOffset = getPacificAucklandOffset(year, month, day);

  // Check if slot is actually available for this duration
  const durationMinutes = duration === "short" ? 60 : 120;
  const slotStart = new Date(Date.UTC(year, month - 1, day, slot.startHour - utcOffset, 0, 0));
  const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

  if (!isSlotFree(slotStart, slotEnd, existingBookings, calendarEvents, config.bufferMin)) {
    return { valid: false, error: "This time slot is no longer available" };
  }

  return { valid: true };
}
