// src/features/business/components/invoices-list-options.ts
// Filter buckets, sortable columns and the row-level pay rule shared by InvoicesListView
// and the toolbar, phone cards and desktop table it renders.

import type { Invoice } from "@/features/business/types/business";

/** Status filter buckets (OVERDUE and QUOTE are derived, not stored statuses). */
export type FilterKey = "all" | "QUOTE" | "DRAFT" | "SENT" | "OVERDUE" | "PAID" | "VOIDED";
/** Sortable column keys. */
export type SortKey = "number" | "client" | "issued" | "due" | "total" | "status";
/** Sort direction. */
export type SortDir = "asc" | "desc";

/** Sortable columns, in table order. */
export const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "number", label: "Number" },
  { key: "client", label: "Client" },
  { key: "issued", label: "Issued" },
  { key: "due", label: "Due" },
  { key: "total", label: "Total" },
  { key: "status", label: "Status" },
];

/** Status-filter dropdown options. */
export const FILTER_OPTIONS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "QUOTE", label: "Quotes" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "PAID", label: "Paid" },
  { value: "VOIDED", label: "Voided" },
];

/**
 * Whether a payment can be recorded from the list: SENT only. A DRAFT row
 * offers "Send invoice" instead (send comes before payment; recording payment
 * on an unsent draft stays possible from the detail page), and PAID is already
 * settled, VOIDED can't be paid.
 * @param inv - The invoice.
 * @returns True when the Record-payment action should show.
 */
export function canPay(inv: Invoice): boolean {
  return inv.status === "SENT" && !inv.isQuote;
}
