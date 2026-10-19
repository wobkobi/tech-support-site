// src/features/booking/lib/booking.ts
// Booking system with duration selection (1hr quick jobs vs 2hr standard jobs).

import type { DateSurcharge } from "@/features/business/lib/pricing-policy";
import { isPlausibleName } from "@/shared/lib/normalise-name";
import type { AvailabilitySettings, MorningGuard } from "@/shared/lib/settings/types";
import {
  NZ_TZ,
  dateKeyParts,
  getPacificAucklandOffset,
  nzWallClockUtc,
  weekdayOf,
} from "@/shared/lib/timezone-utils";

/**
 * Splits a notes blob into the typed free text and the trailing metadata block.
 * @param raw - Raw notes string from the DB.
 * @returns The free text and the metadata block, both trimmed.
 */
function splitNotesBlob(raw: string | null): { userNotes: string; meta: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { userNotes: "", meta: "" };
  // A metadata-only blob opens straight onto "[...]" with no "\n\n[" separator; without
  // the startsWith check it would leak through as `userNotes`.
  const idx = trimmed.startsWith("[") ? 0 : trimmed.indexOf("\n\n[");
  if (idx === -1) return { userNotes: trimmed, meta: "" };
  return { userNotes: trimmed.slice(0, idx).trim(), meta: trimmed.slice(idx).trim() };
}

/**
 * Rewrites only the free text of a notes blob; the metadata block that
 * {@link parseBookingNotes} reads stays byte-identical.
 * @param raw - Existing notes blob.
 * @param userNotes - Replacement free text.
 * @returns The rebuilt blob.
 */
export function replaceUserNotes(raw: string | null, userNotes: string): string {
  const { meta } = splitNotesBlob(raw);
  const text = userNotes.trim();
  if (!meta) return text;
  return text ? `${text}\n\n${meta}` : meta;
}

/**
 * Maps the meeting type stated in a notes blob onto the MeetingType column's spelling,
 * for legacy rows that carry it only in the notes.
 * @param raw - Raw notes string from the DB.
 * @returns The column value, or null when the notes state neither.
 */
export function meetingTypeFromNotes(raw: string | null): "in_person" | "remote" | null {
  const { meetingType } = parseBookingNotes(raw);
  if (meetingType === "in-person") return "in_person";
  if (meetingType === "remote") return "remote";
  return null;
}

/**
 * Google Maps search link for a visit address.
 * @param address - Visit address as stored.
 * @returns The Maps URL.
 */
export function mapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * Parses the structured booking notes blob back into its parts.
 * Format: `{userNotes}\n\n[{timeLabel} - {durationLabel}]\nMeeting type: ...\n[Address: ...]\n[Phone: ...]`
 * Columns are preferred; this serves legacy rows and `userNotes`, which has no column.
 * @param raw - Raw notes string from the DB.
 * @returns The customer's own text plus the parsed metadata fields.
 */
export function parseBookingNotes(raw: string | null): {
  userNotes: string;
  meetingType: "in-person" | "remote" | "";
  address: string;
  phone: string;
} {
  const { userNotes, meta } = splitNotesBlob(raw);

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
 * Builds the customer-facing calendar blurb for both the `.ics` and Google Calendar.
 * Omits time and address, which have their own fields.
 * @param input - The pieces to assemble.
 * @param input.company - Business name.
 * @param input.phone - Contact phone.
 * @param input.email - Contact email.
 * @param input.isRemote - Whether the appointment is remote.
 * @param input.userNotes - What the customer typed when booking.
 * @param input.accessNotes - Parking, directions and other visit notes (optional).
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
  /** Parking, directions and other visit details; omitted when blank. */
  accessNotes?: string | null;
  manageUrl: string;
  cancelUrl: string;
}): string {
  const { company, phone, email, isRemote, userNotes, accessNotes, manageUrl, cancelUrl } = input;
  return [
    isRemote
      ? `Remote session with ${company} - no visit required.`
      : `${company} is coming to you.`,
    userNotes ? `\nWhat you told me:\n${userNotes}` : "",
    accessNotes?.trim() ? `\nOther notes for the visit:\n${accessNotes.trim()}` : "",
    `\nNeed to change or cancel?\nReschedule: ${manageUrl}\nCancel: ${cancelUrl}`,
    `\nQuestions? ${phone} or ${email}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Splits "12/160 Kepa Road Orakei" into unit and rest. Unit is 1-4 digits plus an optional
 * letter ("12A"), else "".
 * @param addr - Address string, possibly with a unit prefix.
 * @returns `unit` (may be empty) and `rest` (street + suburb).
 */
export function splitUnitFromAddress(addr: string): { unit: string; rest: string } {
  const trimmed = addr.replace(/\s+/g, " ").trim();
  const m = trimmed.match(/^(\d{1,4}[A-Za-z]?)\/(.+)$/);
  if (!m) return { unit: "", rest: trimmed };
  const [, unit = "", rest = ""] = m;
  return { unit, rest: rest.trim() };
}

/**
 * Joins unit and rest into the saved address ("12/160 Kepa Road Orakei"). Inverse of
 * {@link splitUnitFromAddress}.
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
 * True when the unit duplicates the leading street number (unit "500" on "500 Pt Chev
 * Road"). Same unit shape as {@link splitUnitFromAddress}.
 * @param unit - Apartment / unit number as typed.
 * @param rest - Street address + suburb as typed.
 * @returns Whether the unit duplicates the leading street number.
 */
export function unitMatchesStreetNumber(unit: string, rest: string): boolean {
  const u = unit.trim();
  if (!u) return false;
  const m = rest.trim().match(/^(\d{1,4}[A-Za-z]?)\b/);
  return !!m && (m[1] ?? "").toLowerCase() === u.toLowerCase();
}

/**
 * Prisma where-fragment for bookings whose calendar event still exists. MUST be this OR
 * shape: on Mongo a bare `null` means "exists AND is null" and skips pre-field rows.
 * Wrap in `AND` when the query has its own OR.
 */
export const CALENDAR_EVENT_PRESENT_FILTER = {
  // No `as const`: Prisma needs a mutable OR array.
  OR: [{ calendarEventMissingAt: null }, { calendarEventMissingAt: { isSet: false } }],
};

export const BOOKING_CONFIG = {
  timeZone: NZ_TZ,
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

// Hour labels ("10am" ... "8pm") generated per day from the schedule.
export type TimeOfDay = string;

export type StartMinute = number;

/**
 * Slot-engine config: availability settings plus {@link BOOKING_CONFIG}.timeZone.
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
 * Offered start hours for one weekday window: hourly while the longest job still ends by
 * close, skipping hours inside a midday break.
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
  /**
   * Labour surcharge for the day (public holiday or weekend); null or absent when none.
   */
  surcharge?: DateSurcharge | null;
}

export interface BuildAvailableDaysResult {
  days: BookableDay[];
  /**
   * True when today was dropped by the same-day cutoff or notice window, so the UI can say why.
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

  // Travel blocks are already padding; only real events get the bufferMin gap.
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
 * Whether an active morning guard blocks a slot: protectedDays before earliestHour, once
 * "now" passes the latest triggerDay@triggerHour on or before the slot (Fri 18:00 >
 * Sat/Sun before noon bites only the imminent weekend).
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
    // Latest triggerDay on or before the slot (UTC noon dodges DST boundaries).
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

  // toLocaleString gives NZ wall-clock hour/minute whatever the server's zone.
  const nzTime = new Date(now.toLocaleString("en-US", { timeZone: config.timeZone }));
  const currentHourNZ = nzTime.getHours();
  const currentMinuteNZ = nzTime.getMinutes();

  // Today's NZ date; en-CA reliably yields YYYY-MM-DD.
  const todayNZStr = now.toLocaleDateString("en-CA", { timeZone: config.timeZone });
  const [startY, startM, startD] = dateKeyParts(todayNZStr);

  for (let i = 0; days.length < config.maxAdvanceDays && i <= config.maxAdvanceDays; i++) {
    // UTC noon dodges DST boundaries; Date handles day overflow (32 > next month).
    const dayUTC = new Date(Date.UTC(startY, startM - 1, startD + i, 12, 0, 0));
    const dateKey = dayUTC.toISOString().split("T")[0]!;
    const dayOfWeek = weekdayOf(dayUTC);

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
    const fullLabel = `${dayNames[dayOfWeek]} ${dayUTC.getUTCDate()} ${monthNames[dayUTC.getUTCMonth()]}`;

    const timeWindows: TimeWindow[] = [];

    // Extract year/month/day from dateKey for reliable timezone calculations
    const [year, month, day] = dateKeyParts(dateKey);

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

    if (window.enabled && !jobsCapHit && !hoursCapHit) {
      const closeMins = window.close * 60;
      const breakStartMins = window.break ? window.break.start * 60 : null;
      const breakEndMins = window.break ? window.break.end * 60 : null;

      /**
       * True when a job [startMins, endMins) ends by close and doesn't straddle the break.
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

          // Morning guards apply on every day, not just today.
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

    // Hide today when nothing is bookable; full future days stay, greyed out.
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
  const [year, month, day] = dateKeyParts(dateKey);
  if (!year || !month || !day) {
    return { valid: false, error: "Invalid date format" };
  }

  // UTC noon for both dates; "today" is the NZ wall-clock date.
  const selectedDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const todayNZStr = now.toLocaleDateString("en-CA", { timeZone: config.timeZone });
  const [ty, tm, td] = dateKeyParts(todayNZStr);
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

  const window = config.schedule[weekdayOf(selectedDate)];
  if (!window.enabled) {
    return { valid: false, error: "That day isn't available for bookings" };
  }

  const startHour = parseHourLabel(timeOfDay);
  if (startHour === null) {
    return { valid: false, error: "Invalid time slot" };
  }

  // startMinute is raw JSON; accept only an offered offset.
  if (!Number.isInteger(startMinute) || !config.subSlotMinutes.includes(startMinute)) {
    return { valid: false, error: "Invalid time slot" };
  }

  const durationMinutes = duration === "short" ? config.durations.short : config.durations.long;

  // Within open/close and not straddling a midday break.
  const startMins = startHour * 60 + startMinute;
  const endMins = startMins + durationMinutes;
  const inBreak = window.break
    ? startMins < window.break.end * 60 && endMins > window.break.start * 60
    : false;
  if (startMins < window.open * 60 || endMins > window.close * 60 || inBreak) {
    return { valid: false, error: "That time isn't within the day's hours" };
  }

  const slotStart = nzWallClockUtc(year, month, day, startHour, startMinute);
  const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

  if (slotStart < now) {
    return { valid: false, error: "This time slot is in the past" };
  }

  // Enforce min notice server-side too.
  const minNoticeMs = config.minHoursNotice * 60 * 60 * 1000;
  if (slotStart.getTime() - now.getTime() < minNoticeMs) {
    return {
      valid: false,
      error: `Bookings need at least ${config.minHoursNotice} hours notice`,
    };
  }

  // Authoritative morning-guard check, mirroring the day grid.
  if (
    isSlotMorningGuarded(
      year,
      month,
      day,
      weekdayOf(selectedDate),
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

  // Enforce daily caps server-side (stale pages, direct calls), mirroring buildAvailableDays.
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
 * Booking-form fields validated at the API edge; all optional since they come from JSON.
 */
export interface BookingPayloadFields {
  name?: string;
  email?: string;
  notes?: string;
  accessNotes?: string;
  dateKey?: string;
  timeOfDay?: string;
  duration?: string;
  meetingType?: string;
  address?: string;
  phone?: string;
}

/**
 * Per-field max lengths shared by the client form and the server validator.
 */
export const BOOKING_FIELD_LIMITS = {
  name: 100,
  email: 320, // RFC 5321 path-length max
  phone: 32,
  notes: 2000,
  /** Optional second box: parking, directions, access. */
  accessNotes: 1000,
  address: 250, // includes apartment prefix
  notesMin: 10,
} as const;

/**
 * Minimal email regex rejecting "a@", "@b" and "a@b". Domain segments are dot-free so
 * there's no ReDoS backtracking. Use {@link validateEmail}.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Result of {@link validateEmail}; callers decide whether "empty" is allowed.
 */
export type EmailValidationResult = "empty" | "invalid" | "too-long" | "ok";

/**
 * The canonical email validator; returns a discriminator so callers pick their wording.
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
 * Discriminator returned by {@link checkDescription}. "no-words" is filler that
 * meets the length rule without describing anything.
 */
export type DescriptionCheckResult = "empty" | "too-short" | "no-words" | "ok";

/** Fewest letters (any script) a description needs; "PC slow" has 6. */
const DESCRIPTION_MIN_LETTERS = 4;

/**
 * Whether a description describes a problem: enough letters, and not a repeated chunk
 * (`^(.{1,4})\1+$` without spaces catches "asdasdasd" and "aaaaaaaaaa").
 * @param raw - Raw description text.
 * @returns The check result.
 */
export function checkDescription(raw: string): DescriptionCheckResult {
  const trimmed = raw.trim();
  if (!trimmed) return "empty";
  if (trimmed.length < BOOKING_FIELD_LIMITS.notesMin) return "too-short";
  const letters = trimmed.match(/\p{L}/gu)?.length ?? 0;
  if (letters < DESCRIPTION_MIN_LETTERS) return "no-words";
  if (/^(.{1,4})\1+$/u.test(trimmed.toLowerCase().replace(/\s+/g, ""))) return "no-words";
  return "ok";
}

/** Booking wording for a phone number the shared phone validator rejects. */
export const PHONE_INVALID_MESSAGE =
  "Please enter an NZ phone number starting with 0, like 021 123 4567.";

/** Shown when {@link checkDescription} returns "no-words". */
export const DESCRIPTION_NO_WORDS_MESSAGE =
  'Please describe the problem in a few words, like "printer won\'t connect to the wifi".';

/**
 * Validates a booking payload's user fields, in {@link validateBookingRequest}'s shape.
 * @param payload - Request body fields.
 * @param opts - Validation options.
 * @param opts.requireEmail - Whether email is required (false for edits, where it is fixed).
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
  if (!isPlausibleName(payload.name)) {
    return { valid: false, error: "Please enter your full name." };
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
  const description = checkDescription(payload.notes ?? "");
  if (description === "empty") {
    return { valid: false, error: "Please describe what you need help with." };
  }
  if (description === "too-short") {
    return {
      valid: false,
      error: `Please describe the issue in at least ${BOOKING_FIELD_LIMITS.notesMin} characters.`,
    };
  }
  if (description === "no-words") {
    return { valid: false, error: DESCRIPTION_NO_WORDS_MESSAGE };
  }
  if (payload.notes && payload.notes.length > BOOKING_FIELD_LIMITS.notes) {
    return { valid: false, error: "Description is too long." };
  }
  if (payload.accessNotes && payload.accessNotes.length > BOOKING_FIELD_LIMITS.accessNotes) {
    return { valid: false, error: "Other notes are too long." };
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
  // In-person visits need a phone for arrival contact; remote ones don't.
  if (payload.meetingType === "in-person" && !payload.phone?.trim()) {
    return {
      valid: false,
      error: "Phone number is required for in-person appointments.",
    };
  }
  return { valid: true };
}
