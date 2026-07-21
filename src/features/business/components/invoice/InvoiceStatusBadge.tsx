// src/features/business/components/invoice/InvoiceStatusBadge.tsx
/**
 * @description Renders an invoice's DISPLAY status (a SENT invoice past due
 * surfaces as OVERDUE) as a tone-mapped {@link StatusPill}. Shared by the
 * invoices list and the detail page so the badge can't drift. Server-safe.
 */

import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import {
  deriveInvoiceDisplayStatus,
  type OverdueCheckInput,
} from "@/features/business/lib/invoice-status";
import type React from "react";

/** Display status > pill tone. */
const TONE: Record<string, StatusTone> = {
  DRAFT: "neutral",
  SENT: "info",
  PAID: "success",
  OVERDUE: "critical",
  VOIDED: "violet",
};

/** Props for {@link InvoiceStatusBadge}. */
interface InvoiceStatusBadgeProps {
  /** Invoice with `status` + `dueDate` (the display status is derived from these). */
  invoice: OverdueCheckInput;
}

/**
 * Renders the invoice's derived display status as a coloured pill.
 * @param props - Component props.
 * @param props.invoice - Invoice with status + due date.
 * @returns The status pill.
 */
export function InvoiceStatusBadge({ invoice }: InvoiceStatusBadgeProps): React.ReactElement {
  const status = deriveInvoiceDisplayStatus(invoice);
  return <StatusPill tone={TONE[status] ?? "neutral"}>{status}</StatusPill>;
}
