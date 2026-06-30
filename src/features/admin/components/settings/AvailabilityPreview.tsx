"use client";
// src/features/admin/components/settings/AvailabilityPreview.tsx
/**
 * @description Live preview for the availability tab. Shows the weekly pattern
 * the draft produces (open hours / break / day-off per weekday) and, by running
 * the same buildAvailableDays engine the booking page uses, the next day a
 * customer could actually book - so booking-window rules (notice, same-day
 * cutoff, caps) are reflected, not just the raw hours.
 */

import { buildAvailableDays, hourLabel } from "@/features/booking/lib/booking";
import { cn } from "@/shared/lib/cn";
import type { AvailabilitySettings } from "@/shared/lib/settings/types";
import type React from "react";
import { useMemo } from "react";

/** App timezone; the booking engine is NZ-only. */
const TIME_ZONE = "Pacific/Auckland";

/** Weekday order shown in the grid (Mon-Sun) with their getUTCDay() index. */
const DAY_ORDER: { index: number; name: string }[] = [
  { index: 1, name: "Mon" },
  { index: 2, name: "Tue" },
  { index: 3, name: "Wed" },
  { index: 4, name: "Thu" },
  { index: 5, name: "Fri" },
  { index: 6, name: "Sat" },
  { index: 0, name: "Sun" },
];

interface Props {
  config: AvailabilitySettings;
}

/**
 * Formats an open/close hour for the grid (24 = midnight, end of day).
 * @param h - Hour 0-24.
 * @returns Display label.
 */
function fmtHour(h: number): string {
  return h === 24 ? "12am" : hourLabel(h);
}

/**
 * Live availability preview: weekly pattern + next bookable day.
 * @param props - Component props.
 * @param props.config - The draft availability settings.
 * @returns Preview element.
 */
export function AvailabilityPreview({ config }: Props): React.ReactElement {
  const nextBookable = useMemo(() => {
    if (!config.acceptingBookings) return null;
    try {
      const { days } = buildAvailableDays([], [], new Date(), { ...config, timeZone: TIME_ZONE });
      return days.find((d) => d.hasAnySlots)?.fullLabel ?? null;
    } catch {
      return null;
    }
  }, [config]);

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-xs font-bold tracking-wide text-russian-violet uppercase">
        Live preview
      </h3>

      {!config.acceptingBookings && (
        <p className="mt-2 text-sm text-amber-700">
          Online booking is switched off - customers see the paused message instead of slots.
        </p>
      )}

      <div className="mt-3 grid grid-cols-7 gap-1">
        {DAY_ORDER.map(({ index, name }) => {
          const d = config.schedule[index];
          const open = d?.enabled === true;
          return (
            <div
              key={index}
              className={cn("rounded-md p-2 text-center", open ? "bg-emerald-50" : "bg-slate-100")}
            >
              <p className="text-xs font-semibold text-slate-700">{name}</p>
              {open ? (
                <>
                  <p className="text-[11px] text-emerald-700">
                    {fmtHour(d.open)}-{fmtHour(d.close)}
                  </p>
                  {d.break && (
                    <p className="text-[11px] text-slate-400">
                      break {fmtHour(d.break.start)}-{fmtHour(d.break.end)}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-slate-400">Closed</p>
              )}
            </div>
          );
        })}
      </div>

      {config.acceptingBookings && (
        <p className="mt-3 text-sm text-slate-600">
          {nextBookable
            ? `Next bookable day: ${nextBookable}`
            : `No bookable days in the next ${config.maxAdvanceDays} days with these settings.`}
        </p>
      )}
    </div>
  );
}
