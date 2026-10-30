// src/features/admin/components/ui/AdminDateTimeInput.tsx
// NZ date and time picker in 15-minute steps: a date input plus a time select, since Firefox's
// datetime-local ignores `step`. Takes and gives the same "YYYY-MM-DDTHH:mm" value. Server-safe.

import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTimeSelect } from "@/features/admin/components/ui/AdminTimeSelect";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link AdminDateTimeInput}. */
interface AdminDateTimeInputProps {
  /** Id on the date input, which the field label points at. */
  id: string;
  /** Accessible name for the time select ("Start time"), which the field label doesn't reach. */
  timeLabel: string;
  /** NZ wall-clock "YYYY-MM-DDTHH:mm", or "" when unset. */
  value: string;
  /** Called with the new value, or "" when the date is cleared. */
  onChange: (value: string) => void;
  /** Disables both controls. */
  disabled?: boolean;
  /** Marks both controls required for native form validation. */
  required?: boolean;
  /** Extra classes on the wrapper (e.g. a max width). */
  className?: string;
}

/**
 * Date input and quarter-hour time select acting as one datetime field. A time off the
 * 15-minute grid (a finish recorded at 7:47) stays listed, so it never snaps without a pick.
 * @param props - Component props.
 * @param props.id - Id on the date input.
 * @param props.timeLabel - Accessible name for the time select.
 * @param props.value - NZ wall-clock "YYYY-MM-DDTHH:mm", or "".
 * @param props.onChange - Called with the new value.
 * @param props.disabled - Disables both controls.
 * @param props.required - Marks both controls required.
 * @param props.className - Extra classes on the wrapper.
 * @returns The paired controls.
 */
export function AdminDateTimeInput({
  id,
  timeLabel,
  value,
  onChange,
  disabled = false,
  required = false,
  className,
}: AdminDateTimeInputProps): React.ReactElement {
  const [date = "", time = ""] = value.split("T");

  return (
    // Wraps the time under the date when the column is too narrow for both.
    <div className={cn("flex flex-wrap gap-2", className)}>
      <AdminInput
        id={id}
        type="date"
        value={date}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}T${time || "09:00"}` : "")}
        disabled={disabled}
        required={required}
        className="min-w-40 flex-1"
      />
      <AdminTimeSelect
        aria-label={timeLabel}
        value={time}
        onChange={(t) => onChange(`${date}T${t}`)}
        disabled={disabled || !date}
        required={required}
        className="w-auto"
      />
    </div>
  );
}
