// src/features/reviews/components/admin/review-admin-classes.ts
// Class strings shared by the review admin lists, so their row buttons and filter chips
// match each other.

import { cn } from "@/shared/lib/cn";

/**
 * Compact row button, laid over AdminButton's default size: the kit's `xs` height and
 * padding, but 14px text because `xs` drops to 12px, below the admin minimum. The
 * default size already lifts touch screens to 44px.
 */
export const ROW_BUTTON_CLS = "h-8 px-2.5 text-sm";

/**
 * Classes for a filter chip button.
 * @param active - Whether the chip is selected.
 * @returns Class string.
 */
export function chipClass(active: boolean): string {
  return cn(
    "h-9 rounded-full border px-3 text-sm font-semibold transition-colors",
    active
      ? "border-russian-violet bg-russian-violet text-white"
      : "border-admin-border-strong bg-admin-surface text-admin-text-secondary hover:border-russian-violet",
  );
}
