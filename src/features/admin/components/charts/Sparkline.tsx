// src/features/admin/components/charts/Sparkline.tsx
// Small trend line for a stat card: the series in de-emphasis grey with the latest point
// as an accent dot. Decorative (aria-hidden) - the same values sit in a full chart with a
// table view elsewhere on the page. Server-safe.

import {
  SPARKLINE_DOT_CLASS,
  SPARKLINE_LINE_CLASS,
} from "@/features/admin/components/charts/series";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** viewBox width; the SVG stretches to the card, so only the ratio to height matters. */
const VIEW_W = 100;
/** viewBox height. */
const VIEW_H = 28;
/** Vertical inset so the 2px line and the end dot never clip at the top or bottom. */
const INSET = 4;

/** Props for {@link Sparkline}. */
interface SparklineProps {
  /** Values oldest first; the last one gets the accent dot. */
  values: readonly number[];
  className?: string;
}

/**
 * Renders the sparkline, or nothing with fewer than two points.
 *
 * The SVG stretches non-uniformly to fill the card (`preserveAspectRatio="none"`), so
 * the line uses a non-scaling stroke to stay 2px and the end dot is an HTML span placed
 * by percentage; an SVG circle would squash into an ellipse.
 * @param props - Component props.
 * @param props.values - Values oldest first.
 * @param props.className - Extra classes on the wrapper.
 * @returns The sparkline, or null.
 */
export function Sparkline({ values, className }: SparklineProps): React.ReactElement | null {
  if (values.length < 2) return null;
  // Anchor the floor at 0 so a flat run of small months doesn't read as a cliff.
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  /**
   * Horizontal position of a point in viewBox units.
   * @param i - Point index.
   * @returns The x coordinate.
   */
  const x = (i: number): number => (i / (values.length - 1)) * VIEW_W;
  /**
   * Vertical position of a value in viewBox units (0 is the top).
   * @param v - The value.
   * @returns The y coordinate.
   */
  const y = (v: number): number => INSET + (1 - (v - min) / span) * (VIEW_H - 2 * INSET);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const lastY = y(values[values.length - 1] ?? 0);

  return (
    <span aria-hidden="true" className={cn("relative mt-2 block h-7 w-full", className)}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className={cn("absolute inset-0 h-full w-full overflow-visible", SPARKLINE_LINE_CLASS)}
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className={cn(
          "absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-admin-surface",
          SPARKLINE_DOT_CLASS,
        )}
        style={{ left: "100%", top: `${(lastY / VIEW_H) * 100}%` }}
      />
    </span>
  );
}
