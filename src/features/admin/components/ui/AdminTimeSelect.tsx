// src/features/admin/components/ui/AdminTimeSelect.tsx
// Time of day as three selects (hour, minutes, am/pm), so a phone shows each as its own wheel
// the way the iPhone clock does, and a time input's `step` (which Firefox ignores) isn't
// needed. Takes and gives a zero-padded "HH:mm". Server-safe.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Each select: the admin field look, sized to its contents. */
const PART_CLS =
  "w-auto min-w-0 rounded-md border border-admin-border-strong bg-admin-surface px-2 py-2 text-base text-admin-text sm:text-[0.9375rem] focus:border-russian-violet aria-[invalid=true]:border-amber-400 disabled:cursor-not-allowed disabled:bg-admin-bg disabled:text-admin-muted";

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Props for {@link AdminTimeSelect}. */
interface AdminTimeSelectProps {
  /** Zero-padded "HH:mm", or "" when unset. */
  value: string;
  /** Called with the picked "HH:mm". */
  onChange: (value: string) => void;
  /** Minutes between listed minutes; should divide 60. */
  stepMins?: number;
  /** Id on the hour select, which a field label points at. */
  id?: string;
  /** Accessible name for the group ("Start time") when no label reaches it. */
  "aria-label"?: string;
  /** Marks every part as needing attention. */
  "aria-invalid"?: boolean;
  /** Disables every part. */
  disabled?: boolean;
  /** Marks every part required for native form validation. */
  required?: boolean;
  /** Extra classes on the wrapper. */
  className?: string;
}

/**
 * Hour, minutes and am/pm selects acting as one time field. A minute off the step grid (a
 * finish recorded at 7:47) stays listed, so it never snaps without a pick. Picking any part of
 * an empty time fills the rest: minutes :00, and am for 7 to 11, otherwise pm (working hours).
 * @param props - Component props.
 * @param props.value - Zero-padded "HH:mm", or "".
 * @param props.onChange - Called with the picked "HH:mm".
 * @param props.stepMins - Minutes between listed minutes.
 * @param props.id - Id on the hour select.
 * @param props."aria-label" - Accessible name for the group.
 * @param props."aria-invalid" - Marks every part as needing attention.
 * @param props.disabled - Disables every part.
 * @param props.required - Marks every part required.
 * @param props.className - Extra classes on the wrapper.
 * @returns The grouped selects.
 */
export function AdminTimeSelect({
  value,
  onChange,
  stepMins = 15,
  id,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  disabled,
  required,
  className,
}: AdminTimeSelectProps): React.ReactElement {
  const [h24, minute] = value ? value.split(":").map(Number) : [];
  const hasValue = h24 !== undefined && minute !== undefined;
  const hour12 = hasValue ? ((h24 + 11) % 12) + 1 : null;
  const pm = hasValue ? h24 >= 12 : null;

  const minutes = Array.from({ length: Math.ceil(60 / stepMins) }, (_, i) => i * stepMins);
  if (hasValue && !minutes.includes(minute)) {
    minutes.push(minute);
    minutes.sort((a, b) => a - b);
  }

  /**
   * Builds the new value from the parts, filling any missing ones with the defaults.
   * @param next - The parts that changed.
   * @param next.hour - Hour on the 12-hour clock.
   * @param next.min - Minutes.
   * @param next.isPm - Whether it's pm.
   */
  function emit(next: { hour?: number; min?: number; isPm?: boolean }): void {
    const hour = next.hour ?? hour12 ?? 12;
    const min = next.min ?? minute ?? 0;
    const isPm = next.isPm ?? pm ?? !(hour >= 7 && hour <= 11);
    const h = (hour % 12) + (isPm ? 12 : 0);
    onChange(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }

  const shared = { disabled, required, "aria-invalid": ariaInvalid, className: PART_CLS };

  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex items-center gap-1", className)}>
      <select
        {...shared}
        id={id}
        aria-label="Hour"
        value={hour12 ?? ""}
        onChange={(e) => emit({ hour: Number(e.target.value) })}
      >
        {!hasValue && <option value="">Hour</option>}
        {HOURS.map((hr) => (
          <option key={hr} value={hr}>
            {hr}
          </option>
        ))}
      </select>
      <span aria-hidden className="font-semibold text-admin-text-secondary">
        :
      </span>
      <select
        {...shared}
        aria-label="Minutes"
        value={hasValue ? minute : ""}
        onChange={(e) => emit({ min: Number(e.target.value) })}
      >
        {!hasValue && <option value="">Min</option>}
        {minutes.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, "0")}
          </option>
        ))}
      </select>
      <select
        {...shared}
        aria-label="am or pm"
        value={pm === null ? "" : pm ? "pm" : "am"}
        onChange={(e) => emit({ isPm: e.target.value === "pm" })}
      >
        {!hasValue && <option value="">--</option>}
        <option value="am">am</option>
        <option value="pm">pm</option>
      </select>
    </div>
  );
}
