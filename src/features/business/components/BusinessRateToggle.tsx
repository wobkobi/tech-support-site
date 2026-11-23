"use client";
// src/features/business/components/BusinessRateToggle.tsx
// Job-wide tick that puts every hourly task on (or off) the Business rate, so it isn't set
// task by task. The per-task chips still work for a one-off exception.

import { formatMoneyCompact } from "@/features/business/lib/business-format";
import { cn } from "@/shared/lib/cn";
import type React from "react";

interface Props {
  /** How much of the labour carries the Business modifier. */
  state: "all" | "some" | "none";
  /** The modifier's +$/hr, for the label. */
  perHour: number;
  /** Called with the new tick; true puts every hourly task on the business rate. */
  onChange: (on: boolean) => void;
}

/**
 * Business-rate tick in a pill, styled like the surcharge tick. Shown part-ticked when only
 * some tasks carry it; clicking then puts them all on.
 * @param props - Component props.
 * @param props.state - How much of the labour carries the Business modifier.
 * @param props.perHour - The modifier's +$/hr.
 * @param props.onChange - Called with the new tick.
 * @returns The toggle element.
 */
export function BusinessRateToggle({ state, perHour, onChange }: Props): React.ReactElement {
  const on = state === "all";
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-full px-3 py-1 text-sm font-medium",
        state === "none"
          ? "bg-admin-bg text-admin-text-secondary ring-1 ring-admin-border"
          : "bg-moonstone-100 text-moonstone-800",
      )}
    >
      <input
        type="checkbox"
        checked={on}
        ref={(el) => {
          if (el) el.indeterminate = state === "some";
        }}
        onChange={() => onChange(!on)}
        className="h-4 w-4 accent-russian-violet"
      />
      Business rate (labour +{formatMoneyCompact(perHour)}/hr)
      {state === "some" && <span className="font-normal italic">- some tasks only</span>}
    </label>
  );
}
