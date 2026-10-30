// src/features/admin/components/ui/AdminTimeSelect.tsx
// Time-of-day select in fixed steps (15 minutes by default), standing in for a time input,
// whose `step` Firefox ignores. Takes and gives a zero-padded "HH:mm". Server-safe.

import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import type React from "react";

/**
 * Minutes after midnight as a zero-padded "HH:mm".
 * @param mins - Minutes after midnight.
 * @returns The clock string.
 */
function clock(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * "14:30" as "2:30 pm", the way the admin shows times elsewhere.
 * @param hhmm - Zero-padded 24-hour clock string.
 * @returns The 12-hour label.
 */
function clockLabel(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Props for {@link AdminTimeSelect}: native select props plus the value and step. */
type AdminTimeSelectProps = Omit<React.ComponentProps<"select">, "value" | "onChange"> & {
  /** Zero-padded "HH:mm", or "" when unset. */
  value: string;
  /** Called with the picked "HH:mm". */
  onChange: (value: string) => void;
  /** Minutes between listed times; should divide 60. */
  stepMins?: number;
};

/**
 * Time select listing every step of the day. A time off the grid (a "Now" of 2:37 pm, a
 * recorded finish of 7:47) stays listed, so it never snaps without a pick.
 * @param props - Native select props plus the fields below.
 * @param props.value - Zero-padded "HH:mm", or "".
 * @param props.onChange - Called with the picked "HH:mm".
 * @param props.stepMins - Minutes between listed times.
 * @returns The select element.
 */
export function AdminTimeSelect({
  value,
  onChange,
  stepMins = 15,
  ...rest
}: AdminTimeSelectProps): React.ReactElement {
  const grid = Array.from({ length: Math.ceil(1440 / stepMins) }, (_, i) => clock(i * stepMins));
  // Zero-padded "HH:mm" sorts correctly as plain strings.
  const times = value && !grid.includes(value) ? [...grid, value].sort() : grid;

  return (
    <AdminSelect {...rest} value={value} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">Time</option>}
      {times.map((t) => (
        <option key={t} value={t}>
          {clockLabel(t)}
        </option>
      ))}
    </AdminSelect>
  );
}
