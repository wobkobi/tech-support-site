// src/features/business/components/InvoicesSummaryCards.tsx
// The five summary cards above the invoices list. Each card doubles as a one-click status
// filter; InvoicesListView owns the figures and the filter state.

import { StatCard } from "@/features/admin/components/ui/StatCard";
import { lastCardSpan, StatStrip } from "@/features/admin/components/ui/StatStrip";
import type { FilterKey } from "@/features/business/components/invoices-list-options";
import { formatNZD } from "@/features/business/lib/business";
import type React from "react";

/** Totals across every invoice (not the filtered view). */
export interface InvoicesSummary {
  outstanding: number;
  overdue: number;
  overdueCount: number;
  paidThisMonth: number;
  paidCount: number;
  draftCount: number;
  draftSum: number;
  quoteCount: number;
  quoteSum: number;
}

/**
 * Renders the summary cards.
 * @param props - Component props.
 * @param props.summary - Totals across every invoice.
 * @param props.statusFilter - Active status bucket; its card shows as active.
 * @param props.onToggle - Toggles a status bucket (clicking the active one clears it).
 * @returns The summary strip.
 */
export function InvoicesSummaryCards({
  summary,
  statusFilter,
  onToggle,
}: {
  summary: InvoicesSummary;
  statusFilter: FilterKey;
  onToggle: (key: FilterKey) => void;
}): React.ReactElement {
  return (
    <StatStrip label="Invoice totals" className="mb-5 grid-cols-2 lg:grid-cols-5">
      <StatCard
        label="Outstanding"
        value={formatNZD(summary.outstanding)}
        sub="Sent, awaiting payment"
        tone="violet"
        onClick={() => onToggle("SENT")}
        active={statusFilter === "SENT"}
      />
      <StatCard
        label="Overdue"
        value={formatNZD(summary.overdue)}
        sub={`${summary.overdueCount} invoice${summary.overdueCount !== 1 ? "s" : ""} past due`}
        tone="critical"
        onClick={() => onToggle("OVERDUE")}
        active={statusFilter === "OVERDUE"}
      />
      <StatCard
        label="Paid this month"
        value={formatNZD(summary.paidThisMonth)}
        sub={`${summary.paidCount} invoice${summary.paidCount !== 1 ? "s" : ""}`}
        tone="success"
        onClick={() => onToggle("PAID")}
        active={statusFilter === "PAID"}
      />
      <StatCard
        label="Drafts"
        value={summary.draftCount}
        sub={formatNZD(summary.draftSum)}
        onClick={() => onToggle("DRAFT")}
        active={statusFilter === "DRAFT"}
      />
      <StatCard
        label="Quotes"
        value={summary.quoteCount}
        sub={`${formatNZD(summary.quoteSum)} quoted`}
        onClick={() => onToggle("QUOTE")}
        active={statusFilter === "QUOTE"}
        className={lastCardSpan(5, { base: 2, lg: 5 })}
      />
    </StatStrip>
  );
}
