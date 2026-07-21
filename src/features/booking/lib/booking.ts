// src/features/booking/lib/booking.ts
/**
 * @description Booking system with duration selection (1hr quick jobs vs 2hr standard jobs).
 */

import type { AvailabilitySettings, MorningGuard } from "@/shared/lib/settings/types";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";

/**
 * Parses the structured booking notes blob back into its parts.
 * Format: `{userNotes}\n\n[{timeLabel} - {durationLabel}]\nMeeting type: ...\n[Address: ...]\n[Phone: ...]`
 * The structured columns (`address`, `meetingType`) are preferred now; this
 * stays because legacy rows carry the values only inside the notes text, and
 * `userNotes` - what the customer actually typed - has no column of its own.
 * @param raw - Raw notes string from the DB.
 * @returns The customer's own text plus the parsed metadata fields.
 */
export function parseBookingNotes(raw: string | null): {
  userNotes: string;
  meetingType: "in-person" | "remote" | "";
  address: string;
  phone: string;
} {
  if (!raw) return { userNotes: "", meetingType: "", address: "", phone: "" };

  const metaSeparatorIdx = raw.indexOf("\n\n[");
  const userNotes = metaSeparatorIdx >= 0 ? raw.slice(0, metaSeparatorIdx).trim() : raw.trim();
  const meta = metaSeparatorIdx >= 0 ? raw.slice(metaSeparatorIdx) : "";

  const meetingTypeLine = meta.match(/Meeting type:\s*(.+)/i)?.[1]?.trim() ?? "";
  const meetingType: "in-person" | "remote" | "" = meetingTypeLine
    .toLowerCase()
    .includes("in-person")
    ? "in-person"
    : meetingTypeLine.toLowerCase().includes("remote")
      ? "remote"
      : "";

  const address = meta.match(/Address:\s*(.+)/i)?.[1]?.trim() ?? "";
  const phone = meta.match(/Phone:\s*(.+)/i)?.[1]?.trim() ?? "";

  return { userNotes, meetingType, address, phone };
}

/**
 * Builds the customer-facing blurb that goes in a calendar entry (both the
 * `.ics` DESCRIPTION and the Google Calendar "details" field), so the two never
 * drift apart. Deliberately omits the time and address - a calendar entry
 * already shows those in its own fields.
 * @param input - The pieces to assemble.
 * @param input.company - Business name.
 * @param input.phone - Contact phone.
 * @param input.email - Contact email.
 * @param input.isRemote - Whether the appointment is remote.
 * @param input.userNotes - What the customer typed when booking.
 * @param input.manageUrl - Absolute reschedule link.
 * @param input.cancelUrl - Absolute cancel link.
 * @returns Plain-text description with newline separators.
 */
export function buildAppointmentDescription(input: {
  company: string;
  phone: string;
  email: string;
  isRemote: boolean;
  userNotes: string;
  manageUrl: string;
  cancelUrl: string;
}): string {
  const { company, phone, email, isRemote, userNotes, manageUrl, cancelUrl } = input;
  return [
    isRemote
      ? `Remote session with ${company} - no visit required.`
      : `${company} is coming to you.`,
    userNotes ? `\nWhat you told us:\n${userNotes}` : "",
    `\nNeed to change or cancel?\nReschedule: ${manageUrl}\nCancel: ${cancelUrl}`,
    `\nQuestions? ${phone} or ${email}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Splits an NZ-style apartment-prefixed address ("12/160 Kepa Road Orakei")
 * into unit + street-and-rest. The unit prefix is 1-4 digits with an optional
 * letter suffix (e.g. "12", "12A") followed by "/". Returns unit="" otherwise.
 * @param addr - Address string, possibly with a unit prefix.
 * @returns `unit` (may be empty) and `rest` (street + suburb).
 */
export function splitUnitFromAddress(addr: string): { unit: string; rest: string } {
  const trimmed = addr.replace(/\s+/g, " ").trim();
  const m = trimmed.match(/^(\d{1,4}[A-Za-z]?)\/(.+)$/);
  if (!m) return { unit: "", rest: trimmed };
  return { unit: m[1], rest: m[2].trim() };
}

/**
 * Combines a unit number and a street-and-rest back into the saved address
 * string ("12/160 Kepa Road Orakei"). Returns just the rest when no unit is
 * present, so non-apartment addresses are unchanged. Inverse of
 * {@link splitUnitFromAddress}; shared so every booking entry point (public form
 * + admin schedule modal) stores addresses identically.
 * @param unit - Apartment / unit number, may be empty.
 * @param rest - Street address + suburb.
 * @returns Combined address string suitable for persistence.
 */
export function combineUnitAndAddress(unit: string, rest: string): string {
  const u = unit.trim();
  const r = rest.trim();
  return u ? `${u}/${r}` : r;
}

/**
 * True when the entered unit duplicates the leading street number (e.g. unit
 * "500" against "500 Pt Chev Road") - warns customers in standalone houses who
 * put their street number in the Apt/Unit box. Same `1-4 digit + optional
 * letter` shape as {@link splitUnitFromAddress} so unit semantics stay consistent.
 * @param unit - Apartment / unit number as typed.
 * @param rest - Street address + suburb as typed.
 * @returns Whether the unit duplicates the leading street number.
 */
export function unitMatchesStreetNumber(unit: string, rest: string): boolean {
  const u = unit.trim();
  if (!u) return false;
  const m = rest.trim().match(/^(\d{1,4}[A-Za-z]?)\b/);
  return !!m && m[1].toLowerCase() === u.toLowerCase();
}

export const BOOKING_CONFIG = {
  timeZone: "Pacific/Auckland",
  maxAdvanceDays: 14,
  bufferMin: 15, // buffer applied around Google Calendar events
  bookingBufferAfterMin: 30, // buffer blocked after each booking ends (in case it runs long)
  minHoursNotice: 2,
  sameDayCutoffHour: 18,
  workStartHour: 10,
  workEndHour: 20,
} as const;

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

// Slot values are hour labels ("10am" ... "8pm"), generated per day from the
// operator's schedule, so the type is a plain string rather than a fixed enum.
export type TimeOfDay = string;

export type StartMinute = number;

/**
 * Resolved config the slot engine runs on: the operator's editable availability
 * settings plus the structural timezone. Built by server callers from
 * `getSettings()` and {@link BOOKING_CONFIG}.timeZone.
 */
export type AvailabilityConfig = AvailabilitySettings & { timeZone: string };

/**
 * Formats an hour-of-day (0-23) as a slot label like "10am", "12pm", "8pm".
 * @param hour - Hour of day, 0-23.
 * @returns Lowercase am/pm label.
 */
export function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * Parses a slot label produced by {@link hourLabel} back to an hour-of-day.
 * @param label - Slot label such as "10am" or "6pm".
 * @returns Hour 0-23, or null when unparseable.
 */
export function parseHourLabel(label: string): number | null {
  const m = /^(\d{1,2})(am|pm)$/.exec(label.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 12) return null;
  if (m[2] === "am") return n === 12 ? 0 : n;
  return n === 12 ? 12 : n + 12;
}

/**
 * Offered start hours for one weekday window: hourly from open up to the last
 * hour where the longest job still ends by close, skipping any start hour that
 * sits inside a midday break.
 * @param window - The day's open/close/break window.
 * @param window.open - Earliest start hour (0-23).
 * @param window.close - Latest end hour (1-24).
 * @param window.break - Optional midday break, or null for one continuous window.
 * @param longestDurationMins - Longest selectable job length, in minutes.
 * @returns Sorted list of start hours (empty when no job can fit).
 */
function startHoursForDay(
  window: { open: number; close: number; break: { start: number; end: number } | null },
  longestDurationMins: number,
): number[] {
  const lastStart = window.close - Math.ceil(longestDurationMins / 60);
  const hours: number[] = [];
  for (let h = window.open; h <= lastStart; h++) {
    if (window.break && h >= window.break.start && h < window.break.end) continue;
    hours.push(h);
  }
  return hours;
}

interface SubSlot {
  minute: StartMinute;
  availableShort: boolean;
  availableLong: boolean;
}

interface TimeWindow {
  value: TimeOfDay;
  label: string;
  startHour: number; // used for sub-slot label generation in the UI
  availableShort: boolean; // true if any sub-slot can fit a 1hr job
  availableLong: boolean; // true if any sub-slot can fit a 2hr job
  subSlots: SubSlot[];
}

export interface BookableDay {
  dateKey: string;
  dayLabel: string;
  fullLabel: string;
  isToday: boolean;
  isTomorrow: boolean;
  isWeekend: boolean;
  timeWindows: TimeWindow[];
  hasAnySlots: boolean; // True if any time slots are available
}

export interface BuildAvailableDaysResult {
  days: BookableDay[];
  /**
   * True when today was filtered out because the same-day cutoff or minimum
   * notice window has elapsed. Surfaced to the UI so it can explain to the
   * user why the list starts at tomorrow instead of silently shifting.
   */
  sameDayClosed: boolean;
}

export interface ExistingBooking {
  id: string;
  startAt: Date;
  endAt: Date;
  bufferBeforeMin: number;
  bufferAfterMin: number;
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
  calendarEvents: Array<{ id: string; start: string; end: string }>,
  bufferMin: number,
): boolean {
  for (const booking of existingBookings) {
    const bookingStart = new Date(booking.startAt.getTime() - booking.bufferBeforeMin * 60 * 1000);
    const bookingEnd = new Date(booking.endAt.getTime() + booking.bufferAfterMin * 60 * 1000);

    if (slotStart < bookingEnd && slotEnd > bookingStart) {
      return false;
    }
  }

  // Check calendar events.
  // Travel blocks (synthetic entries) already represent padding, so no additional
  // buffer is applied to them - only real calendar events get the bufferMin gap.
  for (const event of calendarEvents) {
    const isTravelBlock =
      event.id.startsWith("travel-before:") || event.id.startsWith("travel-after:");
    const effectiveBuffer = isTravelBlock ? 0 : bufferMin;
    const eventStart = new Date(new Date(event.start).getTime() - effectiveBuffer * 60 * 1000);
    const eventEnd = new Date(new Date(event.end).getTime() + effectiveBuffer * 60 * 1000);

    if (slotStart < eventEnd && slotEnd > eventStart) {
      return false;
    }
  }

  return true;
}

/**
 * Whether a slot falls under an active morning guard. A guard blocks slots on
 * its protectedDays before earliestHour once "now" has passed the most recent
 * triggerDay@triggerHour on or before the slot's date - so a weekend-morning
 * rule (Fri 18:00 > Sat/Sun before noon) only bites the imminent weekend, while
 * the same slots stay bookable if reserved earlier in the week.
 * @param year - Slot's NZ calendar year.
 * @param month - Slot's NZ calendar month (1-12).
 * @param day - Slot's NZ calendar day.
 * @param dayOfWeek - Slot's weekday (0 = Sunday .. 6 = Saturday).
 * @param slotHour - Slot's NZ-local start hour.
 * @param now - Current time.
 * @param guards - The live morning-guard rules.
 * @returns True when an enabled guard blocks the slot.
 */
function isSlotMorningGuarded(
  year: number,
  month: number,
  day: number,
  dayOfWeek: number,
  slotHour: number,
  now: Date,
  guards: MorningGuard[],
): boolean {
  for (const g of guards) {
    if (!g.enabled || slotHour >= g.earliestHour || !g.protectedDays.includes(dayOfWeek)) {
      continue;
    }
    // The most recent triggerDay on or before the slot's date (UTC noon avoids
    // any DST date-boundary shift when reading the trigger date's components).
    const daysBack = (dayOfWeek - g.triggerDay + 7) % 7;
    const trigger = new Date(Date.UTC(year, month - 1, day - daysBack, 12, 0, 0));
    const ty = trigger.getUTCFullYear();
    const tm = trigger.getUTCMonth() + 1;
    const td = trigger.getUTCDate();
    const tOffset = getPacificAucklandOffset(ty, tm, td);
    const triggerInstant = Date.UTC(ty, tm - 1, td, g.triggerHour - tOffset, 0, 0);
    if (now.getTime() >= triggerInstant) return true;
  }
  return false;
}

/**
 * Build available days with duration-aware slot checking.
 * @param existingBookings - Array of existing bookings from database
 * @param calendarEvents - Array of calendar events to block
 * @param now - Current date/time
 * @param config - Booking configuration settings
 * @returns Bookable days + a flag indicating whether today was filtered out.
 */
export function buildAvailableDays(
  existingBookings: ExistingBooking[],
  calendarEvents: Array<{ id: string; start: string; end: string }>,
  now: Date,
  config: AvailabilityConfig,
): BuildAvailableDaysResult {
  const days: BookableDay[] = [];
  let sameDayClosed = false;

  // Use toLocaleString only for extracting NZ wall-clock hour/minute -
  // getHours()/getMinutes() on the resulting Date give the correct NZ values
  // regardless of whether the server is in UTC or NZ local time.
  const nzTime = new Date(now.toLocaleString("en-US", { timeZone: config.timeZone }));
  const currentHourNZ = nzTime.getHours();
  const currentMinuteNZ = nzTime.getMinutes();

  // Derive today's NZ calendar date independently of server timezone.
  // en-CA locale reliably produces YYYY-MM-DD on all Node.js platforms.
  const todayNZStr = now.toLocaleDateString("en-CA", { timeZone: config.timeZone });
  const [startY, startM, startD] = todayNZStr.split("-").map(Number);

  for (let i = 0; days.length < config.maxAdvanceDays && i <= config.maxAdvanceDays; i++) {
    // UTC noon for day i - using noon avoids any DST-induced date-boundary shift
    // when extracting UTC date components. JavaScript's Date constructor handles
    // month/day overflow automatically (e.g. day 32 wraps to the next month).
    const dayUTC = new Date(Date.UTC(startY, startM - 1, startD + i, 12, 0, 0));
    const dateKey = dayUTC.toISOString().split("T")[0];
    const dayOfWeek = dayUTC.getUTCDay();

    const isToday = i === 0;
    const isTomorrow = i === 1;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Build day labels
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

    // Get dynamic UTC offset once per day (handles NZDT/NZST)
    const utcOffset = getPacificAucklandOffset(year, month, day);

    const window = config.schedule[dayOfWeek];
    const shortMins = config.durations.short;
    const longMins = config.durations.long;

    // A day yields no slots when it's switched off or its daily cap is reached.
    const dayBookings = existingBookings.filter(
      (b) => b.startAt.toLocaleDateString("en-CA", { timeZone: config.timeZone }) === dateKey,
    );
    const jobsCapHit = !!config.maxJobsPerDay && dayBookings.length >= config.maxJobsPerDay;
    const hoursCapHit =
      !!config.maxBillableHoursPerDay &&
      dayBookings.reduce((sum, b) => sum + (b.endAt.getTime() - b.startAt.getTime()) / 60000, 0) >=
        config.maxBillableHoursPerDay * 60;

    if (window?.enabled === true && !jobsCapHit && !hoursCapHit) {
      const closeMins = window.close * 60;
      const breakStartMins = window.break ? window.break.start * 60 : null;
      const breakEndMins = window.break ? window.break.end * 60 : null;

      /**
       * True when a job [startMins, endMins) finishes by close and doesn't
       * straddle the midday break (must sit entirely before or after it).
       * @param startMins - Job start, minutes from NZ midnight.
       * @param endMins - Job end, minutes from NZ midnight.
       * @returns Whether the job fits the day's window.
       */
      const fits = (startMins: number, endMins: number): boolean => {
        if (endMins > closeMins) return false;
        if (breakStartMins !== null && breakEndMins !== null) {
          if (startMins < breakEndMins && endMins > breakStartMins) return false;
        }
        return true;
      };

      // Check each start hour's sub-slots
      for (const slotHour of startHoursForDay(window, longMins)) {
        const subSlots: SubSlot[] = [];

        for (const minute of config.subSlotMinutes) {
          const slotTotalMinutes = slotHour * 60 + minute;
          const subStart = new Date(
            Date.UTC(year, month - 1, day, slotHour - utcOffset, minute, 0),
          );

          let subAvailableShort =
            fits(slotTotalMinutes, slotTotalMinutes + shortMins) &&
            isSlotFree(
              subStart,
              new Date(subStart.getTime() + shortMins * 60 * 1000),
              existingBookings,
              calendarEvents,
              config.bufferMin,
            );

          let subAvailableLong =
            fits(slotTotalMinutes, slotTotalMinutes + longMins) &&
            isSlotFree(
              subStart,
              new Date(subStart.getTime() + longMins * 60 * 1000),
              existingBookings,
              calendarEvents,
              config.bufferMin,
            );

          // Apply time-based rules for today.
          if (isToday) {
            const minutesUntilSubSlot = (slotHour - currentHourNZ) * 60 + minute - currentMinuteNZ;
            if (minutesUntilSubSlot < config.minHoursNotice * 60) {
              subAvailableShort = false;
              subAvailableLong = false;
            }
            if (config.sameDayCutoffHour !== null && currentHourNZ >= config.sameDayCutoffHour) {
              subAvailableShort = false;
              subAvailableLong = false;
            }
          }

          // Morning guards apply on every day, not just today (a weekend rule
          // triggered on Friday evening blocks the coming Sat/Sun mornings).
          if (
            isSlotMorningGuarded(year, month, day, dayOfWeek, slotHour, now, config.morningGuards)
          ) {
            subAvailableShort = false;
            subAvailableLong = false;
          }

          subSlots.push({
            minute,
            availableShort: subAvailableShort,
            availableLong: subAvailableLong,
          });
        }

        const availableShort = subSlots.some((s) => s.availableShort);
        const availableLong = subSlots.some((s) => s.availableLong);

        timeWindows.push({
          value: hourLabel(slotHour),
          label: hourLabel(slotHour),
          startHour: slotHour,
          availableShort,
          availableLong,
          subSlots,
        });
      }
    }

    const hasAnySlots = timeWindows.some((w) => w.availableShort || w.availableLong);

    // Hide today when nothing is bookable (e.g. past same-day cutoff).
    // Future fully-booked days stay in the array so they appear greyed out.
    if (isToday && !hasAnySlots) {
      sameDayClosed = true;
      continue;
    }

    days.push({
      dateKey,
      dayLabel,
      fullLabel,
      isToday,
      isTomorrow,
      isWeekend,
      timeWindows,
      hasAnySlots,
    });
  }

  return { days, sameDayClosed };
}

/**
 * Validate booking request
 * @param dateKey - Selected date in YYYY-MM-DD format
 * @param timeOfDay - Selected time slot value
 * @param startMinute - Minutes past the hour (0, 15, 30, or 45)
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
  startMinute: StartMinute,
  duration: JobDuration,
  existingBookings: ExistingBooking[],
  calendarEvents: Array<{ id: string; start: string; end: string }>,
  now: Date,
  config: AvailabilityConfig,
): { valid: true } | { valid: false; error: string } {
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

  const window = config.schedule[selectedDate.getUTCDay()];
  if (!window?.enabled) {
    return { valid: false, error: "That day isn't available for bookings" };
  }

  const startHour = parseHourLabel(timeOfDay);
  if (startHour === null) {
    return { valid: false, error: "Invalid time slot" };
  }

  // startMinute arrives raw from the JSON body; only accept an offset the
  // operator actually offers so off-grid, fractional, or negative minutes
  // can't slip past the window check below or land on a phantom slot key.
  if (!Number.isInteger(startMinute) || !config.subSlotMinutes.includes(startMinute)) {
    return { valid: false, error: "Invalid time slot" };
  }

  const durationMinutes = duration === "short" ? config.durations.short : config.durations.long;

  // The job must start no earlier than open, finish by close, and not straddle
  // a midday break.
  const startMins = startHour * 60 + startMinute;
  const endMins = startMins + durationMinutes;
  const inBreak = window.break
    ? startMins < window.break.end * 60 && endMins > window.break.start * 60
    : false;
  if (startMins < window.open * 60 || endMins > window.close * 60 || inBreak) {
    return { valid: false, error: "That time isn't within the day's hours" };
  }

  // Get dynamic UTC offset for this date (handles NZDT/NZST)
  const utcOffset = getPacificAucklandOffset(year, month, day);

  const slotStart = new Date(Date.UTC(year, month - 1, day, startHour - utcOffset, startMinute, 0));
  const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

  if (slotStart < now) {
    return { valid: false, error: "This time slot is in the past" };
  }

  // Server-side enforce the client's min-notice window so direct API calls
  // can't bypass it.
  const minNoticeMs = config.minHoursNotice * 60 * 60 * 1000;
  if (slotStart.getTime() - now.getTime() < minNoticeMs) {
    return {
      valid: false,
      error: `Bookings need at least ${config.minHoursNotice} hours notice`,
    };
  }

  // Authoritative morning-guard check (mirrors the day-grid filter) so a direct
  // API call can't book an early slot the guard has closed for that day.
  if (
    isSlotMorningGuarded(
      year,
      month,
      day,
      selectedDate.getUTCDay(),
      startHour,
      now,
      config.morningGuards,
    )
  ) {
    return {
      valid: false,
      error: "That time isn't available - early slots close ahead of the day",
    };
  }

  if (!isSlotFree(slotStart, slotEnd, existingBookings, calendarEvents, config.bufferMin)) {
    return { valid: false, error: "This time slot is no longer available" };
  }

  // Enforce the operator's daily caps server-side too - the day grid applies
  // them when rendering, but a stale page (loaded before the day filled) or a
  // direct API caller could otherwise book past the limit. Mirrors the
  // cap logic in buildAvailableDays; for edits the current booking is already
  // excluded from existingBookings, so it doesn't count against itself.
  const dayBookings = existingBookings.filter(
    (b) => b.startAt.toLocaleDateString("en-CA", { timeZone: config.timeZone }) === dateKey,
  );
  const jobsCapHit = !!config.maxJobsPerDay && dayBookings.length >= config.maxJobsPerDay;
  const hoursCapHit =
    !!config.maxBillableHoursPerDay &&
    dayBookings.reduce((sum, b) => sum + (b.endAt.getTime() - b.startAt.getTime()) / 60000, 0) >=
      config.maxBillableHoursPerDay * 60;
  if (jobsCapHit || hoursCapHit) {
    return { valid: false, error: "That day is fully booked." };
  }

  return { valid: true };
}

/**
 * Shape of the booking-form fields validated at the API edge. Each field is
 * optional because the payload comes from JSON.parse of a request body.
 */
export interface BookingPayloadFields {
  name?: string;
  email?: string;
  notes?: string;
  dateKey?: string;
  timeOfDay?: string;
  duration?: string;
  meetingType?: string;
  address?: string;
  phone?: string;
}

/**
 * Per-field max-length caps shared between the client form and the server
 * validator so both ends agree. Anything longer is rejected at the API edge
 * before hitting the database.
 */
export const BOOKING_FIELD_LIMITS = {
  name: 100,
  email: 320, // RFC 5321 path-length max
  phone: 32,
  notes: 2000,
  address: 250, // includes apartment prefix
  notesMin: 10,
} as const;

/**
 * Minimal email regex - rejects "a@", "@b", "a@b" (no TLD), whitespace-only
 * input. The domain is matched as one-or-more dot-separated dot-free segments
 * so dots only appear at explicit boundaries - this eliminates the backtrack
 * ambiguity that triggers the polynomial-ReDoS analyser.
 *
 * Module-internal only - all email validation goes through {@link validateEmail} below.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Discriminator returned by {@link validateEmail}. "empty" means the input is blank
 * (callers decide whether that's allowed based on whether the field is required).
 */
export type EmailValidationResult = "empty" | "invalid" | "too-long" | "ok";

/**
 * Single canonical email validator used by the shared EmailInput component and
 * by every submit handler / server route that accepts an email. Returns a
 * discriminator so callers can pick their own wording.
 * @param raw - Raw email input.
 * @returns Validation result.
 */
export function validateEmail(raw: string): EmailValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) return "empty";
  if (!EMAIL_REGEX.test(trimmed)) return "invalid";
  if (trimmed.length > BOOKING_FIELD_LIMITS.email) return "too-long";
  return "ok";
}

/**
 * Validates the user-supplied fields on a booking POST/edit payload. Returns
 * the same `{ valid, error }` shape as {@link validateBookingRequest} so call sites
 * can treat both checks uniformly.
 * @param payload - Request body fields.
 * @param opts - Validation options.
 * @param opts.requireEmail - Whether the email field must be present (true for new bookings, false for edits where the email is fixed on the existing record).
 * @returns Validation result.
 */
export function validateBookingPayloadFields(
  payload: BookingPayloadFields,
  opts: { requireEmail: boolean },
): { valid: true } | { valid: false; error: string } {
  if (!payload.name?.trim()) {
    return { valid: false, error: "Name is required." };
  }
  if (payload.name && payload.name.length > BOOKING_FIELD_LIMITS.name) {
    return { valid: false, error: "Name is too long." };
  }
  if (opts.requireEmail || payload.email?.trim()) {
    const emailResult = validateEmail(payload.email ?? "");
    if (opts.requireEmail && emailResult === "empty") {
      return { valid: false, error: "Valid email is required." };
    }
    if (emailResult === "invalid") {
      return { valid: false, error: "Valid email is required." };
    }
    if (emailResult === "too-long") {
      return { valid: false, error: "Email is too long." };
    }
  }
  if (!payload.notes?.trim()) {
    return { valid: false, error: "Please describe what you need help with." };
  }
  if (payload.notes && payload.notes.trim().length < BOOKING_FIELD_LIMITS.notesMin) {
    return {
      valid: false,
      error: `Please describe the issue in at least ${BOOKING_FIELD_LIMITS.notesMin} characters.`,
    };
  }
  if (payload.notes && payload.notes.length > BOOKING_FIELD_LIMITS.notes) {
    return { valid: false, error: "Description is too long." };
  }
  if (!payload.dateKey || !payload.timeOfDay) {
    return { valid: false, error: "Please select a day and time." };
  }
  if (!payload.duration) {
    return { valid: false, error: "Please select job duration." };
  }
  if (!payload.meetingType) {
    return { valid: false, error: "Please select in-person or remote." };
  }
  if (payload.meetingType === "in-person" && !payload.address?.trim()) {
    return { valid: false, error: "Address is required for in-person appointments." };
  }
  if (payload.address && payload.address.length > BOOKING_FIELD_LIMITS.address) {
    return { valid: false, error: "Address is too long." };
  }
  // A reachable phone is needed for in-person so the technician can contact the
  // customer on arrival (gate codes, running late, etc.). Remote sessions don't
  // need it because the calendar invite + email are sufficient.
  if (payload.meetingType === "in-person" && !payload.phone?.trim()) {
    return {
      valid: false,
      error: "Phone number is required for in-person appointments.",
    };
  }
  return { valid: true };
}
