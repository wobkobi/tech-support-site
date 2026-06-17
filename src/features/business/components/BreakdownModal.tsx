"use client";
// src/features/business/components/BreakdownModal.tsx
/**
 * @file BreakdownModal.tsx
 * @description Modal that explains how a dashboard total was computed - either by
 * listing the entries that summed to it, or by showing the calculation steps.
 */

import { formatNZD } from "@/features/business/lib/business";
import Link from "next/link";
import type React from "react";
import { useEffect } from "react";
import { FaCaretRight } from "react-icons/fa6";

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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-12 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={data.title}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-bold text-russian-violet">{data.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-slate-400 transition-colors hover:text-slate-700"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {data.calculation && data.calculation.length > 0 && (
            <ul className="flex flex-col gap-2 text-sm">
              {data.calculation.map((step, i) => (
                <li
                  key={`${step.label}-${i}`}
                  className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 last:border-0"
                >
                  <span className="text-slate-600">
                    {step.subtract ? "Less " : ""}
                    {step.label}
                  </span>
                  <span className="font-mono text-slate-800">
                    {step.subtract ? "-" : ""}
                    {step.value}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {data.rows && data.rows.length > 0 && (
            <ul className="flex flex-col text-sm">
              {data.rows.map((row, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-3 border-b border-slate-100 py-2 last:border-0"
                >
                  {row.date && (
                    <span className="w-24 shrink-0 text-xs text-slate-400">{row.date}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{row.label}</p>
                    {row.sublabel && (
                      <p className="truncate text-xs text-slate-500">{row.sublabel}</p>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-slate-800">
                    {data.amountAsCount ? String(row.amount) : formatNZD(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {data.rows && data.rows.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">No entries.</p>
          )}
        </div>

        {(data.total || data.viewAll || (data.rows && data.rows.length > 0)) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
            {data.total ? (
              <div className="flex items-baseline gap-3">
                <span className="text-sm font-semibold text-slate-600">{data.total.label}</span>
                <span className="font-mono text-base font-bold text-russian-violet">
                  {data.total.value}
                </span>
              </div>
            ) : data.rows && !data.amountAsCount ? (
              <div className="flex items-baseline gap-3">
                <span className="text-sm font-semibold text-slate-600">Total</span>
                <span className="font-mono text-base font-bold text-russian-violet">
                  {formatNZD(rowsTotal)}
                </span>
              </div>
            ) : (
              <span />
            )}

            {data.viewAll && (
              <Link
                href={data.viewAll.href}
                className="inline-flex items-center gap-1 text-sm font-semibold text-russian-violet hover:underline"
              >
                {data.viewAll.label}
                <FaCaretRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
