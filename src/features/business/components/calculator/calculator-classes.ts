// src/features/business/components/calculator/calculator-classes.ts
// Class strings shared by the calculator cards, so their row remove buttons, task-row
// rate chips and in-card text actions match each other.

import { cn } from "@/shared/lib/cn";

/** Underlined violet text action inside a card ("Manage tags", "+ Add task"). */
export const TEXT_ACTION_CLS =
  "text-sm font-medium text-russian-violet underline underline-offset-2 hover:text-russian-violet/80";

/** Square remove button for a row (the "×" beside a slot, part or travel entry). */
export const REMOVE_ROW_CLS =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-admin-border-strong bg-admin-surface text-lg leading-none text-coquelicot-700 transition-colors hover:border-coquelicot-600 hover:bg-coquelicot-50 disabled:cursor-not-allowed disabled:border-admin-border disabled:text-admin-muted disabled:hover:bg-admin-surface pointer-coarse:size-11";

/**
 * Classes for an on/off rate chip on a task row (a modifier or "Didn't finish"). Lighter
 * than the kit's single-choice chip because a row carries several of them at once.
 * @param active - Whether the chip is switched on.
 * @param activeCls - Colour classes for the on state.
 * @returns Class string.
 */
export function toggleChipClass(
  active: boolean,
  activeCls = "border-russian-violet/40 bg-russian-violet/10 text-russian-violet",
): string {
  return cn(
    "h-8 rounded-full border px-2.5 text-sm font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3.5",
    active
      ? activeCls
      : "border-admin-border bg-admin-surface text-admin-text-secondary hover:border-admin-border-strong",
  );
}
