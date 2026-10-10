// src/features/admin/components/ui/chip-classes.ts
// Class strings for the admin's single-choice controls: the rounded filter / option chip
// and the violet segmented toggle (Short/Long, Cash/Bank, Desktop/Phone). Callers keep
// their own button markup, aria-pressed and handlers; only the look is shared.

import { cn } from "@/shared/lib/cn";

/**
 * Classes for a filter or option chip button (list filters, fee reason, meeting type).
 * @param active - Whether the chip is selected.
 * @returns Class string.
 */
export function adminChipClass(active: boolean): string {
  return cn(
    "h-9 rounded-full border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-11",
    active
      ? "border-russian-violet bg-russian-violet text-white"
      : "border-admin-border-strong bg-admin-surface text-admin-text-secondary hover:border-russian-violet",
  );
}

/** The grey track a segmented toggle's buttons sit in. */
export const SEGMENTED_GROUP_CLS =
  "inline-flex rounded-lg border border-admin-border bg-admin-bg p-0.5";

/**
 * Classes for one button of a segmented toggle: solid violet when selected, so the choice
 * never reads as a second coquelicot primary beside a Save button.
 * @param active - Whether this option is selected.
 * @returns Class string.
 */
export function segmentedButtonClass(active: boolean): string {
  return cn(
    "h-9 rounded-md px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11",
    active ? "bg-russian-violet text-white" : "text-admin-text-secondary hover:bg-admin-surface",
  );
}
