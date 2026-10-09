// src/features/admin/components/ui/AdminCheckbox.tsx
// Single-line admin checkbox with its label. Used for the "do this too?" opt-outs an
// action carries with it - the review email on completing a booking, the reschedule email
// on a time edit, the draft invoice on a no-show - inside confirm-dialog bodies and admin
// forms alike.

"use client";

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link AdminCheckbox}. */
interface AdminCheckboxProps {
  /** Whether the box is ticked. */
  checked: boolean;
  /** Called with the new value on toggle. */
  onChange: (checked: boolean) => void;
  /** Label text sitting beside the box. */
  label: string;
  /** Greys the control out while an action is in flight. */
  disabled?: boolean;
  /** Extra classes merged onto the outer label, e.g. `items-start` for a wrapping label. */
  className?: string;
}

/**
 * Checkbox + label pair styled for the admin surfaces.
 * @param props - Component props.
 * @param props.checked - Whether the box is ticked.
 * @param props.onChange - Called with the new value on toggle.
 * @param props.label - Label text beside the box.
 * @param props.disabled - Greys the control out while busy.
 * @param props.className - Extra classes merged onto the outer label.
 * @returns The checkbox element.
 */
export function AdminCheckbox({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}: AdminCheckboxProps): React.ReactElement {
  return (
    <label className={cn("flex items-center gap-2 text-sm text-admin-text", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 accent-russian-violet"
      />
      {label}
    </label>
  );
}
