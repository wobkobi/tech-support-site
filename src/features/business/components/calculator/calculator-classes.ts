// src/features/business/components/calculator/calculator-classes.ts
// Class strings shared by the calculator cards, so their compact buttons, chips and
// in-card text actions match each other.

import { cn } from "@/shared/lib/cn";

/**
 * Compact button, laid over AdminButton's default size: the kit's `xs` height and
 * padding, but 14px text because `xs` drops to 12px, below the admin minimum. The
 * default size already lifts touch screens to 44px.
 */
export const COMPACT_BUTTON_CLS = "h-8 px-2.5 text-sm";

/** Underlined violet text action inside a card ("Manage tags", "+ Add task"). */
export const TEXT_ACTION_CLS =
  "text-sm font-medium text-russian-violet underline underline-offset-2 hover:text-russian-violet/80";

/** Square remove button for a row (the "×" beside a slot, part or travel entry). */
export const REMOVE_ROW_CLS =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-admin-border-strong bg-admin-surface text-lg leading-none text-coquelicot-700 transition-colors hover:border-coquelicot-600 hover:bg-coquelicot-50 disabled:cursor-not-allowed disabled:border-admin-border disabled:text-admin-muted disabled:hover:bg-admin-surface pointer-coarse:size-11";

/**
 * Classes for a single-choice chip (fee reason, meeting type, address-to mode).
 * @param active - Whether the chip is selected.
 * @returns Class string.
 */
export function chipClass(active: boolean): string {
  return cn(
    "h-9 rounded-full border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
    active
      ? "border-russian-violet bg-russian-violet text-white"
      : "border-admin-border-strong bg-admin-surface text-admin-text-secondary hover:border-russian-violet",
  );
}

/**
 * Classes for an on/off rate chip on a task row (a modifier or "Didn't finish"). Lighter
 * than {@link chipClass} because a row carries several of them at once.
 * @param active - Whether the chip is switched on.
 * @param activeCls - Colour classes for the on state.
 * @returns Class string.
 */
export function toggleChipClass(
  active: boolean,
  activeCls = "border-russian-violet/40 bg-russian-violet/10 text-russian-violet",
): string {
  return cn(
    "h-8 rounded-full border px-2.5 text-sm font-medium transition-colors",
    active
      ? activeCls
      : "border-admin-border bg-admin-surface text-admin-text-secondary hover:border-admin-border-strong",
  );
}
