"use client";
// src/features/business/components/BreakdownModal.tsx
/**
 * @description Modal that explains how a dashboard total was computed - either by
 * listing the entries that summed to it, or by showing the calculation steps.
 */

import { Modal } from "@/features/admin/components/ui/Modal";
import { formatNZD } from "@/features/business/lib/business";
import Link from "next/link";
import type React from "react";
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
interface BreakdownCalcStep {
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
 * Modal that visualises the contributors to a dashboard total. Body scrolls
 * when the row list is long; the shared {@link Modal} shell supplies the
 * backdrop, Escape handling and focus management.
 * @param props - Component props.
 * @param props.data - The breakdown payload to render.
 * @param props.onClose - Called when the user dismisses the modal.
 * @returns Rendered modal element.
 */
export function BreakdownModal({ data, onClose }: BreakdownModalProps): React.ReactElement {
  const rowsTotal = data.rows?.reduce((s, r) => s + r.amount, 0) ?? 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={data.title}
      size="lg"
      footer={
        (data.total || data.viewAll || (data.rows && data.rows.length > 0)) && (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {data.total ? (
              <div className="flex items-baseline gap-3">
                <span className="text-sm font-semibold text-admin-text-secondary">
                  {data.total.label}
                </span>
                <span className="font-mono text-base font-bold text-russian-violet">
                  {data.total.value}
                </span>
              </div>
            ) : data.rows && !data.amountAsCount ? (
              <div className="flex items-baseline gap-3">
                <span className="text-sm font-semibold text-admin-text-secondary">Total</span>
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
        )
      }
    >
      <div>
        {data.calculation && data.calculation.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm">
            {data.calculation.map((step, i) => (
              <li
                key={`${step.label}-${i}`}
                className="flex items-baseline justify-between gap-3 border-b border-admin-border pb-2 last:border-0"
              >
                <span className="text-admin-text-secondary">
                  {step.subtract ? "Less " : ""}
                  {step.label}
                </span>
                <span className="font-mono text-admin-text">
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
                className="flex items-baseline gap-3 border-b border-admin-border py-2 last:border-0"
              >
                {row.date && (
                  <span className="w-24 shrink-0 text-xs text-admin-faint">{row.date}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-admin-text">{row.label}</p>
                  {row.sublabel && (
                    <p className="truncate text-xs text-admin-muted">{row.sublabel}</p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-admin-text">
                  {data.amountAsCount ? String(row.amount) : formatNZD(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {data.rows && data.rows.length === 0 && (
          <p className="py-4 text-center text-sm text-admin-faint">No entries.</p>
        )}
      </div>
    </Modal>
  );
}
