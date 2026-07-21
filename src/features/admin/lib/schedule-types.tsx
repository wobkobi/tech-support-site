// src/features/admin/lib/schedule-types.tsx
/**
 * @description Shared types, styles, and formatters used by both the desktop
 * week grid and the mobile day-agenda view.
 */

import { cn } from "@/shared/lib/cn";
import type React from "react";

export const NZ_TZ = "Pacific/Auckland";

export type WeekViewKind = "booking" | "car" | "personal" | "travel";

export type BookingStatus = "held" | "confirmed" | "cancelled" | "completed";

/**
 * Booking-row fields joined to a calendar event by `calendarEventId`. Present
 * only on events where `kind === "booking"` and a matching Booking row was
 * found. Drives the tap-to-expand details + long-press quick actions in the
 * mobile day agenda.
 */
export interface WeekEventBooking {
  id: string;
  cancelToken: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  status: BookingStatus;
}

export interface WeekEvent {
  id: string;
  kind: WeekViewKind;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
  /**
   * Google Calendar "open in Calendar" URL, set only for booking-calendar events
   * so a booking added straight into Google Calendar (no in-app record) can still
   * be opened there on click. Null for car/personal (not openable); bookings that
   * have a DB row open their in-app detail page instead.
   */
  htmlLink?: string | null;
  isAllDay: boolean;
  /** Populated for `kind === "booking"` events. Optional otherwise. */
  booking?: WeekEventBooking;
}

/** Id prefix for a placeholder block shown while an optimistic block syncs. */
export const OPTIMISTIC_BUSY_PREFIX = "optimistic-busy-";

/**
 * Placeholder all-day "Busy" event for a day the operator just blocked, shown
 * instantly before the real Google Calendar event exists. Its id carries
 * {@link OPTIMISTIC_BUSY_PREFIX} so real-event lookups (e.g. the block button's
 * unblock target) can exclude it.
 * @param dayKey - NZ YYYY-MM-DD for the blocked day.
 * @returns A synthetic all-day booking-kind event covering that day.
 */
export function optimisticBusyEvent(dayKey: string): WeekEvent {
  return {
    id: `${OPTIMISTIC_BUSY_PREFIX}${dayKey}`,
    kind: "booking",
    title: "Busy",
    startAt: `${dayKey}T00:00:00.000Z`,
    endAt: `${dayKey}T23:59:59.999Z`,
    location: null,
    isAllDay: true,
  };
}

/**
 * Returns the YYYY-MM-DD key for the Monday of the NZ week containing the
 * given NZ date key. Pure UTC date-part math so DST + offset edges can't
 * shift the result.
 * @param dayKey - Any NZ YYYY-MM-DD.
 * @returns Monday-of-week NZ date key.
 */
export function mondayOf(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const back = (utc.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - back));
  const my = monday.getUTCFullYear();
  const mm = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const md = String(monday.getUTCDate()).padStart(2, "0");
  return `${my}-${mm}-${md}`;
}

/** Tailwind classes per event kind. Keep colours in sync with the legend. */
export const KIND_STYLES: Record<WeekViewKind, string> = {
  booking: "bg-russian-violet/90 text-white border-russian-violet ring-1 ring-white/10",
  car: "bg-red-100 text-red-900 border-red-300",
  personal: "bg-slate-200 text-slate-700 border-slate-300",
  travel: "bg-amber-100 text-amber-900 border-amber-300",
};

/** Solid background colour for the left accent bar on agenda cards. */
export const KIND_BAR_BG: Record<WeekViewKind, string> = {
  booking: "bg-russian-violet",
  car: "bg-red-400",
  personal: "bg-slate-400",
  travel: "bg-amber-400",
};

interface LegendDotProps {
  kind: WeekViewKind;
  label: string;
}

/**
 * Small coloured swatch + label for the schedule legend.
 * @param props - Component props.
 * @param props.kind - Calendar kind controlling the swatch colour.
 * @param props.label - Visible legend text.
 * @returns Legend dot element.
 */
export function LegendDot({ kind, label }: LegendDotProps): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded-sm border", KIND_STYLES[kind])} />
      {label}
    </span>
  );
}

/**
 * Formats an hour-of-day as a 12h label with am/pm.
 * @param hour - Hour-of-day 0-23.
 * @returns Display label like "9am", "12pm", "5pm".
 */
export function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

/**
 * Builds a short "9:00am - 10:30am" range label from two ISO timestamps.
 * @param startIso - ISO 8601 timestamp of the range start.
 * @param endIso - ISO 8601 timestamp of the range end.
 * @returns Range label in NZ time.
 */
export function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${fmt.format(new Date(startIso))} - ${fmt.format(new Date(endIso))}`;
}
