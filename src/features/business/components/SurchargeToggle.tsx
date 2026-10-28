"use client";
// src/features/business/components/SurchargeToggle.tsx
// Tick that turns the weekend, public-holiday or (on a weekday) after-hours labour surcharge on
// or off for one job.

import { upliftPercent, type DateSurcharge } from "@/features/business/lib/pricing-policy";
import { cn } from "@/shared/lib/cn";
import type React from "react";

interface Props {
  /** The surcharge the tick switches, from surchargeOption. */
  option: DateSurcharge;
  /** Whether the job bills it. */
  on: boolean;
  /** Whether the job bills it by default (a weekend, public holiday or after-hours start). */
  fromDate: boolean;
  /** Called with the new tick. */
  onChange: (on: boolean) => void;
}

/**
 * Surcharge tick in a pill: amber while it bills, grey when off, with a note whenever the
 * tick differs from what the date and start would bill.
 * @param props - Component props.
 * @param props.option - The surcharge the tick switches.
 * @param props.on - Whether the job bills it.
 * @param props.fromDate - Whether the date and start bill it by default.
 * @param props.onChange - Called with the new tick.
 * @returns The toggle element.
 */
export function SurchargeToggle({ option, on, fromDate, onChange }: Props): React.ReactElement {
  const pct = upliftPercent(option.uplift);
  const name = option.reason === "After hours" ? "After-hours rates" : `${option.reason} rates`;
  let note: string | null = null;
  if (fromDate && !on) note = "off for this job";
  else if (!fromDate && on) note = "added for this job";
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-full px-3 py-1 text-sm font-medium",
        on
          ? "bg-amber-100 text-amber-800"
          : "bg-admin-bg text-admin-text-secondary ring-1 ring-admin-border",
      )}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-russian-violet"
      />
      {name} (labour +{pct}%)
      {note && <span className="font-normal italic">- {note}</span>}
    </label>
  );
}
