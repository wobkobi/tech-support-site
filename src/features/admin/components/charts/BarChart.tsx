"use client";
// src/features/admin/components/charts/BarChart.tsx
// Grouped column chart for money series (income vs expenses by month or by FY). Plain
// HTML columns, no chart library: each group is a button, so hover, tap and keyboard focus
// all show one readout listing every series. A "Show as table" twin holds every value.

import { formatAxisDollars, niceScale } from "@/features/admin/components/charts/chart-scale";
import type { ChartSeries } from "@/features/admin/components/charts/series";
import {
  TABLE_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { formatNZD } from "@/features/business/lib/business-format";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";

/** One cluster of columns, e.g. a month. */
export interface BarGroup {
  key: string;
  /** Axis label, e.g. "Oct". */
  shortLabel: string;
  /** Readout and table label, e.g. "October 2026 (to date)". */
  label: string;
  /** One value per series, in series order. */
  values: readonly number[];
}

/** Props for {@link BarChart}. */
interface BarChartProps {
  /** Chart heading. */
  title: string;
  /** Optional line under the heading (the period, a "to date" note). */
  description?: React.ReactNode;
  series: readonly ChartSeries[];
  groups: readonly BarGroup[];
  /** Heading for the table's label column, e.g. "Month". */
  groupHeading: string;
  /** When set, the readout and table add first-minus-second under this label ("Profit"). */
  differenceLabel?: string;
  /** Shown in place of the plot when every value is zero. */
  emptyText: string;
  className?: string;
}

/** Plot height; the axis band sits below it, outside this box. */
const PLOT_H = "h-56";

/**
 * Renders the chart card: heading, legend with series totals, plot, axis and table view.
 *
 * Columns follow the dataviz mark spec: at most 24px wide, 4px rounded tops, square on
 * the baseline, a 2px surface gap between neighbours. A non-zero value too small to see
 * still gets a 2px column so it doesn't read as nothing; negative values plot as 0 (the
 * readout and table show the real figure).
 * @param props - Component props.
 * @param props.title - Chart heading.
 * @param props.description - Optional line under the heading.
 * @param props.series - Series in display order.
 * @param props.groups - Groups oldest first.
 * @param props.groupHeading - Table heading for the group column.
 * @param props.differenceLabel - Label for the first-minus-second row, when wanted.
 * @param props.emptyText - Text shown when every value is zero.
 * @param props.className - Extra classes on the card.
 * @returns The chart card.
 */
export function BarChart({
  title,
  description,
  series,
  groups,
  groupHeading,
  differenceLabel,
  emptyText,
  className,
}: BarChartProps): React.ReactElement {
  const titleId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  // Pointer type behind `hovered`: a touch or pen readout has no pointerleave to clear it.
  const pointerType = useRef<string>("mouse");
  // Roving tabindex: one Tab stop for the whole plot, starting on the latest group.
  const [tabStop, setTabStop] = useState(Math.max(0, groups.length - 1));
  // Clamped: a scope change can swap in fewer groups while this state survives.
  const stop = Math.min(tabStop, groups.length - 1);
  const active = hovered ?? focused;

  // A tapped readout stays up until a tap lands outside the plot (Safari never focuses a
  // tapped button, so blur alone can't dismiss it).
  useEffect(() => {
    if (hovered === null || pointerType.current === "mouse") return;
    /**
     * Clears the tapped readout when a press lands outside the plot.
     * @param e - The document pointerdown.
     */
    const onOutside = (e: PointerEvent): void => {
      if (!plotRef.current?.contains(e.target as Node)) setHovered(null);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [hovered]);

  const totals = series.map((_, si) => groups.reduce((sum, g) => sum + (g.values[si] ?? 0), 0));
  const max = Math.max(0, ...groups.flatMap((g) => g.values));
  const scale = niceScale(max);
  const isEmpty = groups.every((g) => g.values.every((v) => v === 0));
  const widestTick = formatAxisDollars(scale.top);

  /**
   * First series minus second, for the difference row.
   * @param values - One group's values.
   * @returns The difference.
   */
  const difference = (values: readonly number[]): number => (values[0] ?? 0) - (values[1] ?? 0);

  /**
   * Spoken readout for one group, e.g. "October 2026: Income $1,200.00, ...".
   * @param g - The group.
   * @returns The readout text.
   */
  const readout = (g: BarGroup): string => {
    const parts = series.map((s, si) => `${s.label} ${formatNZD(g.values[si] ?? 0)}`);
    if (differenceLabel) parts.push(`${differenceLabel} ${formatNZD(difference(g.values))}`);
    return `${g.label}: ${parts.join(", ")}`;
  };

  /**
   * Arrow / Home / End move focus between groups; Escape hides the readout.
   * @param e - Key event from a group button.
   * @param index - Index of the focused group.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (e.key === "Escape") {
      setHovered(null);
      setFocused(null);
      return;
    }
    const last = groups.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(last, index + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    const buttons = e.currentTarget.parentElement?.querySelectorAll("button");
    buttons?.[next]?.focus();
  };

  const activeGroup = active === null ? null : groups[active];

  return (
    <figure
      aria-labelledby={titleId}
      className={cn("rounded-lg border border-admin-border bg-admin-surface p-4 sm:p-5", className)}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-admin-text">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-admin-text-secondary">{description}</p>}
        </div>
        {!isEmpty && (
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {series.map((s, si) => (
              <li key={s.key} className="flex items-center gap-2 text-sm text-admin-text-secondary">
                <span
                  aria-hidden="true"
                  className={cn("h-3 w-3 shrink-0 rounded-sm", s.fillClass)}
                />
                {s.label}
                <span className="font-bold text-admin-text">{formatNZD(totals[si] ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isEmpty ? (
        <p className="py-10 text-center text-sm text-admin-muted">{emptyText}</p>
      ) : (
        <div className="flex gap-2">
          {/* Y axis. The invisible widest label sizes the column; the real labels sit
              absolutely on their gridlines. */}
          <div aria-hidden="true" className={cn("relative shrink-0", PLOT_H)}>
            <span className="invisible block text-sm tabular-nums">{widestTick}</span>
            {scale.ticks.map((t, ti) => (
              <span
                key={ti}
                className="absolute right-0 translate-y-1/2 text-sm whitespace-nowrap text-admin-muted tabular-nums"
                style={{ bottom: `${(t / scale.top) * 100}%` }}
              >
                {formatAxisDollars(t)}
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className={cn("relative", PLOT_H)}>
              {/* Gridlines: solid hairlines, the baseline one step darker. */}
              {scale.ticks.map((t, ti) => (
                <div
                  key={ti}
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-0 h-px",
                    t === 0 ? "bg-admin-border-strong" : "bg-admin-border",
                  )}
                  style={{ bottom: `${(t / scale.top) * 100}%` }}
                />
              ))}

              <div
                ref={plotRef}
                role="group"
                aria-labelledby={titleId}
                className="absolute inset-0 flex"
              >
                {groups.map((g, gi) => (
                  <button
                    key={g.key}
                    type="button"
                    tabIndex={gi === stop ? 0 : -1}
                    aria-label={readout(g)}
                    onPointerEnter={(e) => {
                      pointerType.current = e.pointerType;
                      setHovered(gi);
                    }}
                    onPointerLeave={(e) => {
                      // A tap fires pointerleave straight after; keep its readout up.
                      if (e.pointerType === "mouse") setHovered(null);
                    }}
                    onFocus={() => {
                      // The latest interaction wins: a parked mouse can't pin the readout
                      // while the arrow keys move on.
                      setHovered(null);
                      setFocused(gi);
                      setTabStop(gi);
                    }}
                    onBlur={() => setFocused(null)}
                    onKeyDown={(e) => onKeyDown(e, gi)}
                    className={cn(
                      "flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 px-0.5 transition-colors sm:px-1",
                      active === gi && "bg-russian-violet/5",
                    )}
                  >
                    {series.map((s, si) => {
                      const v = Math.max(0, g.values[si] ?? 0);
                      return (
                        <span
                          key={s.key}
                          aria-hidden="true"
                          className={cn("max-w-6 min-w-0 flex-1 rounded-t", s.fillClass)}
                          style={{
                            height: `${(v / scale.top) * 100}%`,
                            minHeight: v > 0 ? 2 : 0,
                          }}
                        />
                      );
                    })}
                  </button>
                ))}
              </div>

              {/* Readout: spans the plot on phones, where the plot is narrower than the
                  readout; from sm it anchors to the active group's near edge so it never
                  runs off the card. Hidden from screen readers, which get each button's
                  label. */}
              {activeGroup && active !== null && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 z-10 rounded-md border border-admin-border bg-admin-surface px-3 py-2 shadow-md sm:right-(--ro-r) sm:left-(--ro-l) sm:w-max sm:max-w-64"
                  style={
                    (active < groups.length / 2
                      ? { "--ro-l": `${(active / groups.length) * 100}%`, "--ro-r": "auto" }
                      : {
                          "--ro-l": "auto",
                          "--ro-r": `${((groups.length - active - 1) / groups.length) * 100}%`,
                        }) as React.CSSProperties
                  }
                >
                  <p className="text-sm font-bold text-admin-text">{activeGroup.label}</p>
                  <ul className="mt-1 space-y-0.5">
                    {series.map((s, si) => (
                      <li key={s.key} className="flex items-center gap-2 text-sm">
                        <span
                          aria-hidden="true"
                          className={cn("h-0.5 w-3 shrink-0 rounded-full", s.fillClass)}
                        />
                        <span className="font-bold text-admin-text tabular-nums">
                          {formatNZD(activeGroup.values[si] ?? 0)}
                        </span>
                        <span className="text-admin-text-secondary">{s.label}</span>
                      </li>
                    ))}
                    {differenceLabel && (
                      <li className="mt-1 flex items-center gap-2 border-t border-admin-border pt-1 text-sm">
                        <span aria-hidden="true" className="w-3 shrink-0" />
                        <span className="font-bold text-admin-text tabular-nums">
                          {formatNZD(difference(activeGroup.values))}
                        </span>
                        <span className="text-admin-text-secondary">{differenceLabel}</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* X axis. Past six groups, phones label every other one (the latest always). */}
            <div aria-hidden="true" className="mt-2 flex">
              {groups.map((g, gi) => (
                <span
                  key={g.key}
                  className={cn(
                    "min-w-0 flex-1 text-center text-sm whitespace-nowrap text-admin-muted",
                    groups.length > 6 && (groups.length - 1 - gi) % 2 === 1 && "max-sm:invisible",
                  )}
                >
                  {g.shortLabel}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {!isEmpty && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-bold text-russian-violet select-none">
            Show as table
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className={TABLE_CLS}>
              <thead className={THEAD_CLS}>
                <tr>
                  <th scope="col" className={TH_CLS}>
                    {groupHeading}
                  </th>
                  {series.map((s) => (
                    <th key={s.key} scope="col" className={cn(TH_CLS, "text-right")}>
                      {s.label}
                    </th>
                  ))}
                  {differenceLabel && (
                    <th scope="col" className={cn(TH_CLS, "text-right")}>
                      {differenceLabel}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className={TBODY_CLS}>
                {groups.map((g) => (
                  <tr key={g.key}>
                    <th scope="row" className={cn(TD_CLS, "text-left font-normal text-admin-text")}>
                      {g.label}
                    </th>
                    {series.map((s, si) => (
                      <td key={s.key} className={cn(TD_CLS, "text-right tabular-nums")}>
                        {formatNZD(g.values[si] ?? 0)}
                      </td>
                    ))}
                    {differenceLabel && (
                      <td className={cn(TD_CLS, "text-right tabular-nums")}>
                        {formatNZD(difference(g.values))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-admin-border-strong">
                <tr>
                  <th scope="row" className={cn(TD_CLS, "text-left font-bold text-admin-text")}>
                    Total
                  </th>
                  {series.map((s, si) => (
                    <td key={s.key} className={cn(TD_CLS, "text-right font-bold tabular-nums")}>
                      {formatNZD(totals[si] ?? 0)}
                    </td>
                  ))}
                  {differenceLabel && (
                    <td className={cn(TD_CLS, "text-right font-bold tabular-nums")}>
                      {formatNZD((totals[0] ?? 0) - (totals[1] ?? 0))}
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
