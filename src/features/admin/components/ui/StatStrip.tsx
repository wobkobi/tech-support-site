// src/features/admin/components/ui/StatStrip.tsx
// One bordered panel holding a row of StatCards, split by hairlines, so a page's summary
// figures read as one set. Server-safe.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link StatStrip}. */
interface StatStripProps {
  children: React.ReactNode;
  /** Grid columns per breakpoint, e.g. "grid-cols-2 lg:grid-cols-4", plus any margin. */
  className?: string;
  /** Accessible name for the group, e.g. "This month". */
  label?: string;
}

/** Column counts per breakpoint, matching the strip's grid-cols classes. */
export interface StripColumns {
  base: number;
  sm?: number;
  lg?: number;
}

// Literal class lists so Tailwind sees every span it may need (index = span).
const BASE_SPAN = ["", "col-span-1", "col-span-2", "col-span-3", "col-span-4", "col-span-5"];
const SM_SPAN = [
  "",
  "sm:col-span-1",
  "sm:col-span-2",
  "sm:col-span-3",
  "sm:col-span-4",
  "sm:col-span-5",
];
const LG_SPAN = [
  "",
  "lg:col-span-1",
  "lg:col-span-2",
  "lg:col-span-3",
  "lg:col-span-4",
  "lg:col-span-5",
];

/**
 * Span classes that stretch the last card across its row's gap at each breakpoint
 * (5 cards in 2 columns: `col-span-2`). Max 5 columns.
 * @param count - Number of cards in the strip.
 * @param cols - Column count at each breakpoint the strip sets.
 * @returns Classes for the last card.
 */
export function lastCardSpan(count: number, cols: StripColumns): string {
  /**
   * Span that fills the last row at one column count.
   * @param c - Columns.
   * @returns Span, 1 when the row is already full.
   */
  function span(c: number): number {
    const left = count % c;
    return left === 0 ? 1 : c - left + 1;
  }
  return cn(
    BASE_SPAN[span(cols.base)],
    cols.sm && SM_SPAN[span(cols.sm)],
    cols.lg && LG_SPAN[span(cols.lg)],
  );
}

/**
 * Renders the strip; dividers are 1px grid gaps over the border-coloured background.
 * An unfilled row shows that background, so use even column counts or {@link lastCardSpan}.
 * @param props - Component props.
 * @param props.children - The StatCards.
 * @param props.className - Grid column classes, plus any margin.
 * @param props.label - Accessible name for the group.
 * @returns The strip element.
 */
export function StatStrip({ children, className, label }: StatStripProps): React.ReactElement {
  return (
    <section
      aria-label={label}
      className={cn(
        "admin-stat-strip grid gap-px overflow-hidden rounded-lg border border-admin-border bg-admin-border",
        className,
      )}
    >
      {children}
    </section>
  );
}
