"use client";
// src/features/business/components/BreakdownModal.tsx
/**
 * @file BreakdownModal.tsx
 * @description Modal that explains how a dashboard total was computed - either by
 * listing the entries that summed to it, or by showing the calculation steps.
 */

import { useEffect } from "react";
import type React from "react";
import Link from "next/link";
import { cn } from "@/shared/lib/cn";
import { formatNZD } from "@/features/business/lib/business";

/**
 * One contributing row in a breakdown that lists entries.
 */
export interface BreakdownRow {
  /** Pre-formatted date label (left). */
  date?: string;
  /** Primary label (e.g. customer or supplier). */
  label: string;
  /** Optional secondary text (e.g. description). */
  sublabel?: string;
  /** Numeric amount; positive contributes to total, negative subtracts. */
  amount: number;
}

/**
 * One step in a breakdown that walks through a calculation rather than listing rows.
 */
export interface BreakdownCalcStep {
  label: string;
  value: string;
  /** Set true to render this step as a subtraction (e.g. "less expenses"). */
  subtract?: boolean;
}

/**
 * Full payload describing a breakdown the modal should render.
 */
export interface BreakdownData {
  title: string;
  /** When set, the modal shows a scrollable list of these rows. */
  rows?: BreakdownRow[];
  /** When set (and `rows` is not), the modal shows a calculation walk-through. */
  calculation?: BreakdownCalcStep[];
  /** Footer total line (always shown when present). */
  total?: { label: string; value: string };
  /** Optional inline link, e.g. to the full income/expense/invoice page. */
  viewAll?: { label: string; href: string };
  /** When true, format `rows[].amount` as a count (string) instead of NZD. */
  amountAsCount?: boolean;
}

interface BreakdownModalProps {
  data: BreakdownData;
  onClose: () => void;
}

/**
 * Modal that visualises the contributors to a dashboard total. Closes on
 * Escape, on backdrop click, or via the close button. Body scrolls when the
 * row list is long.
 * @param props - Component props.
 * @param props.data - The breakdown payload to render.
 * @param props.onClose - Called when the user dismisses the modal.
 * @returns Rendered modal element.
 */
export function BreakdownModal({ data, onClose }: BreakdownModalProps): React.ReactElement {
  useEffect(() => {
    /**
     * Closes the modal on Escape.
     * @param e - The keyboard event.
     */
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const rowsTotal = data.rows?.reduce((s, r) => s + r.amount, 0) ?? 0;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-12 backdrop-blur-sm",
      )}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={data.title}
    >
      <div
        className={cn(
          "w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn("flex items-center justify-between border-b border-slate-200 px-5 py-4")}
        >
          <h2 className={cn("text-russian-violet text-lg font-bold")}>{data.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "text-2xl leading-none text-slate-400 transition-colors hover:text-slate-700",
            )}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={cn("max-h-[60vh] overflow-y-auto px-5 py-4")}>
          {data.calculation && data.calculation.length > 0 && (
            <ul className={cn("flex flex-col gap-2 text-sm")}>
              {data.calculation.map((step, i) => (
                <li
                  key={`${step.label}-${i}`}
                  className={cn(
                    "flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 last:border-0",
                  )}
                >
                  <span className={cn("text-slate-600")}>
                    {step.subtract ? "Less " : ""}
                    {step.label}
                  </span>
                  <span className={cn("font-mono text-slate-800")}>
                    {step.subtract ? "-" : ""}
                    {step.value}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {data.rows && data.rows.length > 0 && (
            <ul className={cn("flex flex-col text-sm")}>
              {data.rows.map((row, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex items-baseline gap-3 border-b border-slate-100 py-2 last:border-0",
                  )}
                >
                  {row.date && (
                    <span className={cn("w-24 shrink-0 text-xs text-slate-400")}>{row.date}</span>
                  )}
                  <div className={cn("min-w-0 flex-1")}>
                    <p className={cn("truncate font-medium text-slate-800")}>{row.label}</p>
                    {row.sublabel && (
                      <p className={cn("truncate text-xs text-slate-500")}>{row.sublabel}</p>
                    )}
                  </div>
                  <span className={cn("shrink-0 font-mono text-slate-800")}>
                    {data.amountAsCount ? String(row.amount) : formatNZD(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {data.rows && data.rows.length === 0 && (
            <p className={cn("py-4 text-center text-sm text-slate-400")}>No entries.</p>
          )}
        </div>

        {(data.total || data.viewAll || (data.rows && data.rows.length > 0)) && (
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3",
            )}
          >
            {data.total ? (
              <div className={cn("flex items-baseline gap-3")}>
                <span className={cn("text-sm font-semibold text-slate-600")}>
                  {data.total.label}
                </span>
                <span className={cn("text-russian-violet font-mono text-base font-bold")}>
                  {data.total.value}
                </span>
              </div>
            ) : data.rows && !data.amountAsCount ? (
              <div className={cn("flex items-baseline gap-3")}>
                <span className={cn("text-sm font-semibold text-slate-600")}>Total</span>
                <span className={cn("text-russian-violet font-mono text-base font-bold")}>
                  {formatNZD(rowsTotal)}
                </span>
              </div>
            ) : (
              <span />
            )}

            {data.viewAll && (
              <Link
                href={data.viewAll.href}
                className={cn("text-russian-violet text-sm font-semibold hover:underline")}
              >
                {data.viewAll.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
