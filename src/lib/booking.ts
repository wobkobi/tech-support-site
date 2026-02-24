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
  nextDayMorningCutoffHour: 20,
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
  const nzTime = new Date(now.toLocaleString("en-US", { timeZone: config.timeZone }));
  const currentHourNZ = nzTime.getHours();
  const currentMinuteNZ = nzTime.getMinutes();

  const startDate = new Date(nzTime);
  startDate.setHours(0, 0, 0, 0);

  for (let i = 0; i < config.maxAdvanceDays; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    const dateKey = date.toISOString().split("T")[0];

    // Calculate day of week from dateKey to avoid timezone issues
    // (date object might have UTC time component that shifts the day)
    const dayOfWeek = new Date(dateKey + "T12:00:00.000Z").getUTCDay();

    const isToday = i === 0;
    const isTomorrow = i === 1;
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

    const dayLabel = `${shortDayNames[dayOfWeek]} ${date.getDate()} ${monthNames[date.getMonth()]}`;
    const fullLabel = `${dayNames[dayOfWeek]}, ${monthNames[date.getMonth()]} ${date.getDate()}`;

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

      // Next-day morning cutoff (8pm blocks next morning)
      if (isTomorrow && currentHourNZ >= config.nextDayMorningCutoffHour && slotHour < 12) {
        availableShort = false;
        availableLong = false;
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

    // Always add the day to the list (even if fully booked)
    // Exception: Skip today if all time slots are in the past
    if (isToday && !hasAnySlots) {
      continue; // Don't show today if it's fully booked (all times past)
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

  const selectedDate = new Date(year, month - 1, day);
  selectedDate.setHours(0, 0, 0, 0);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (selectedDate < today) {
    return { valid: false, error: "Cannot book dates in the past" };
  }

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + config.maxAdvanceDays);
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
