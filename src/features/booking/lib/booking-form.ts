// src/features/booking/lib/booking-form.ts
// Pure helpers, constants and types for the public BookingForm: field anchors,
// duration labels, the saved-draft shape and submit-time field validation.

import {
  BOOKING_FIELD_LIMITS,
  validateEmail,
  type BookableDay,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import { focusAndReveal } from "@/shared/lib/focus-and-reveal";
import { isPlausibleName } from "@/shared/lib/normalise-name";
import { validatePhone } from "@/shared/lib/normalise-phone";

/** localStorage key for the new-booking draft. Bumped when the shape changes. */
export const DRAFT_KEY = "booking-draft-v2";
/** Soft warning kicks in this many chars before the notes hard cap. */
export const NOTES_WARN_GAP = 50;

/** Element id of the day picker, the fallback while the time picker is not rendered. */
export const DAY_ANCHOR = "booking-day";

/**
 * Field-error key > the element id it points at, in form order. The order
 * matters: the mobile "N issues" link jumps to the first key with an error.
 */
export const FIELD_ANCHORS: Record<string, string> = {
  duration: "booking-duration",
  day: DAY_ANCHOR,
  time: "booking-time",
  name: "booking-name",
  email: "booking-email",
  phone: "booking-phone",
  meetingType: "booking-meeting-type",
  address: "booking-address",
  notes: "booking-notes",
};

/**
 * Moves focus to the field an error names. A button group has no single
 * input, so focus lands on its selected button, else its first enabled one. A
 * bare #anchor jump would scroll without focusing anything.
 * @param key - Field-error key from {@link FIELD_ANCHORS}.
 */
export function focusField(key: string): void {
  const anchor = FIELD_ANCHORS[key];
  // The time picker only renders once a day is picked; fall back to the days.
  const el =
    (anchor ? document.getElementById(anchor) : null) ?? document.getElementById(DAY_ANCHOR);
  if (!el) return;
  const target = el.matches("input, textarea, button")
    ? el
    : (el.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      el.querySelector<HTMLElement>("input, textarea, button:not(:disabled)") ??
      el);
  focusAndReveal(target);
}

/**
 * Formats a job duration in minutes as a short label ("1 hour", "2 hours", "90 min").
 * @param mins - Duration in minutes.
 * @returns Human label.
 */
export function durationText(mins: number): string {
  if (mins % 60 === 0) {
    const h = mins / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${mins} min`;
}

/**
 * Compact duration label ("45m", "1h", "1h 15m") - hours and minutes rather
 * than a raw "75 min", so over-an-hour estimates read naturally.
 * @param mins - Duration in minutes.
 * @returns Compact label.
 */
function compactDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Formats a low/high minute band as a compact range ("15 - 30m",
 * "45m - 1h 15m"). Collapses to a single label when the ends match, and shares
 * the "m" unit when both ends are under an hour.
 * @param low - Low end in minutes.
 * @param high - High end in minutes.
 * @returns Human range label.
 */
export function durationRangeText(low: number, high: number): string {
  if (low >= high) return compactDuration(high);
  if (high < 60) return `${low} - ${high}m`;
  return `${compactDuration(low)} - ${compactDuration(high)}`;
}

/**
 * Format a sub-slot time label, e.g. startHour=14, minute=15 > "2:15pm".
 * @param startHour - The hour in 24h format (e.g. 14 for 2pm)
 * @param minute - Minutes past the hour (0, 15, 30, or 45)
 * @returns Formatted time string (e.g. "2:15pm")
 */
export function subSlotLabel(startHour: number, minute: StartMinute): string {
  const period = startHour < 12 ? "am" : "pm";
  const h = startHour > 12 ? startHour - 12 : startHour;
  return minute === 0 ? `${h}:00${period}` : `${h}:${String(minute).padStart(2, "0")}${period}`;
}

/** One choice in the duration picker. */
export interface DurationOption {
  /** Job duration key. */
  value: JobDuration;
  /** Button label carrying the live length. */
  label: string;
  /** Fixed one-line description. */
  description: string;
}

/**
 * Duration choices built from the live settings; labels reflect the operator's
 * configured short/long lengths. Descriptions stay as fixed copy.
 * @param durations - Live job lengths in minutes.
 * @param durations.short - Standard job length.
 * @param durations.long - Extended job length.
 * @returns The two picker options, short first.
 */
export function buildDurationOptions(durations: { short: number; long: number }): DurationOption[] {
  return [
    {
      value: "short",
      label: `Standard (${durationText(durations.short)})`,
      description: "Most common appointment length",
    },
    {
      value: "long",
      label: `Extended (${durationText(durations.long)})`,
      description: "For complex issues or multiple tasks",
    },
  ];
}

/** Inline rough estimate shown under the description. */
export interface InlineQuote {
  /** Low end of the labour range in dollars. */
  low: number;
  /** High end of the labour range in dollars. */
  high: number;
  /** Round-trip travel charge in dollars (0 when remote or unknown). */
  travelCharge: number;
  /** Low end of the time band in minutes. */
  minsLow: number;
  /** High end of the time band in minutes. */
  minsHigh: number;
}

/** Saved new-booking draft, persisted to localStorage under {@link DRAFT_KEY}. */
export interface BookingDraft {
  duration: JobDuration;
  name: string;
  email: string;
  phone: string;
  meetingType: "in-person" | "remote" | "";
  unit: string;
  address: string;
  addressVerified: boolean;
  notes: string;
  accessNotes?: string;
  dateKey?: string;
  timeOfDay?: TimeOfDay;
  startMinute?: StartMinute;
}

/** Form values checked by {@link validateBookingFields}. */
export interface BookingFieldValues {
  /** Chosen job duration. */
  duration: JobDuration;
  /** Chosen day, or null when none is picked. */
  selectedDay: BookableDay | null;
  /** Chosen time window, or null when none is picked. */
  selectedTime: TimeOfDay | null;
  /** Customer name as typed. */
  name: string;
  /** Customer email as typed. */
  email: string;
  /** Customer phone as typed. */
  phone: string;
  /** Meeting type, or "" when not chosen. */
  meetingType: "in-person" | "remote" | "";
  /** Street address (without unit) as typed. */
  address: string;
  /** Issue description as typed. */
  notes: string;
}

/**
 * Collects all submit-time failures so the user fixes them in one pass. Keys
 * match {@link FIELD_ANCHORS} (and the input ids used for aria-describedby +
 * summary anchors).
 * @param values - Current form values.
 * @returns Field-error key > message; empty when the form is valid.
 */
export function validateBookingFields(values: BookingFieldValues): Record<string, string> {
  const { duration, selectedDay, selectedTime, name, email, phone, meetingType, address, notes } =
    values;
  const fe: Record<string, string> = {};
  if (!duration) fe.duration = "Please select job duration.";
  if (!selectedDay) fe.day = "Please select a day and time.";
  if (!selectedTime) fe.time = "Please select a time.";
  if (!name.trim()) fe.name = "Please enter your name.";
  else if (!isPlausibleName(name)) fe.name = "Please enter your full name.";
  if (validateEmail(email) !== "ok") {
    fe.email = "Please enter a valid email address.";
  }
  const phoneCheck = validatePhone(phone).result;
  if (meetingType === "in-person") {
    if (!phone.trim()) {
      fe.phone = "Please enter a phone number so I can contact you about arrival.";
    } else if (phoneCheck === "invalid") {
      fe.phone = "Please enter a valid phone number.";
    }
  } else if (phoneCheck === "invalid") {
    fe.phone = "Please enter a valid phone number, or leave it blank.";
  }
  if (!meetingType) fe.meetingType = "Please select in-person or remote.";
  if (meetingType === "in-person" && !address.trim()) {
    fe.address = "Please enter your address for in-person appointments.";
  }
  if (!notes.trim()) {
    fe.notes = "Please describe what you need help with.";
  } else if (notes.trim().length < BOOKING_FIELD_LIMITS.notesMin) {
    fe.notes = `Please describe the issue in at least ${BOOKING_FIELD_LIMITS.notesMin} characters so I have enough context.`;
  }
  return fe;
}

/**
 * Writes the new-booking draft to localStorage. Quota / private-mode failures
 * are swallowed: persistence is best-effort.
 * @param draft - Current form values.
 */
export function saveBookingDraft(draft: BookingDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Quota / private-mode: persistence is best-effort.
  }
}

/** Removes the saved new-booking draft. Best-effort; a no-op during SSR. */
export function removeBookingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore - removal is best-effort.
  }
}

/** Returning-customer details from the contact lookup. */
export interface BookingContactLookup {
  ok: boolean;
  name?: string;
  phone?: string | null;
  address?: string | null;
}

/**
 * Looks up a returning customer by email for the form's pre-fill.
 * @param email - Trimmed, lower-cased email.
 * @param signal - Aborts the request when a newer lookup supersedes it.
 * @returns The lookup result, or null on a non-OK response. Rejects on network
 *   failure or abort.
 */
export async function lookupBookingContact(
  email: string,
  signal: AbortSignal,
): Promise<BookingContactLookup | null> {
  const res = await fetch(`/api/booking/contact-lookup?email=${encodeURIComponent(email)}`, {
    signal,
  });
  if (!res.ok) return null;
  return (await res.json()) as BookingContactLookup;
}
