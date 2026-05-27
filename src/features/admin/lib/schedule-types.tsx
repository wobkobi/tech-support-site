// src/features/admin/lib/schedule-types.tsx
/**
 * @file schedule-types.tsx
 * @description Shared types, styles, and formatters used by both the desktop
 * week grid and the mobile day-agenda view.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";

export const NZ_TZ = "Pacific/Auckland";

export type WeekViewKind = "booking" | "car" | "personal" | "travel";

export interface WeekEvent {
  id: string;
  kind: WeekViewKind;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
  isAllDay: boolean;
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
    <span className={cn("inline-flex items-center gap-1.5")}>
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
