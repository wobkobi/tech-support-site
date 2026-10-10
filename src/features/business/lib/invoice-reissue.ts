// src/features/business/lib/invoice-reissue.ts
// Re-issuing a voided invoice: the calculator link that starts it, and the prefill the
// calculator page builds from the voided invoice. The job is rebuilt in the calculator
// rather than copied, so the promo is priced again for the job date instead of keeping
// the voided invoice's stored figure.

import { formatNZD } from "@/features/business/lib/business-format";
import { nzDateKey } from "@/shared/lib/timezone-utils";

/** What the calculator carries over from a voided invoice it is re-issuing. */
export interface ReissuePrefill {
  /** Voided invoice's number, named in the calculator banner. */
  invoiceNumber: string;
  /** Client details, used when no calendar event backs the job. */
  clientName: string;
  clientEmail: string;
  /** NZ date (YYYY-MM-DD) the voided invoice was issued, the job date when no event backs it. */
  issueDate: string;
  /** The voided invoice's lines, one per row, seeded into "Describe the job". */
  jobText: string;
  /** Invoice notes, carried into the calculator's notes. */
  notes: string;
  /** Amount paid on the day, which stays on the voided invoice; null when none. */
  alreadyPaid: number | null;
}

/** The invoice fields a re-issue reads. */
interface ReissueSource {
  number: string;
  clientName: string;
  clientEmail: string;
  issueDate: Date;
  lineItems: readonly {
    description: string;
    qty: number;
    unitPrice: number;
    minutes?: number | null;
  }[];
  notes: string | null;
  alreadyPaid: number | null;
}

/**
 * Calculator URL that re-issues a voided invoice.
 * @param invoiceId - The voided invoice's id.
 * @returns Path with the `reissue` param.
 */
export function reissueHref(invoiceId: string): string {
  return `/admin/business/calculator?reissue=${encodeURIComponent(invoiceId)}`;
}

/**
 * Calendar events the voided invoice billed, earliest first: every merged event, or the
 * single one, or none for an invoice made without an event.
 * @param invoice - Invoice event links.
 * @param invoice.calendarEventId - The first (or only) billed event.
 * @param invoice.calendarEventIds - Every merged event; empty below two.
 * @returns Event ids for the calculator's event prefill.
 */
export function reissueEventIds(invoice: {
  calendarEventId: string | null;
  calendarEventIds: readonly string[];
}): string[] {
  if (invoice.calendarEventIds.length > 0) return [...invoice.calendarEventIds];
  return invoice.calendarEventId ? [invoice.calendarEventId] : [];
}

/**
 * One "Describe the job" row per invoice line: a timed line as "TV setup: 35 min", any
 * other line with its amount ("Round-trip travel (21 min drive): $15.00"), so the job
 * can be parsed again or rebuilt by hand.
 * @param line - An invoice line.
 * @param line.description - Line text.
 * @param line.qty - Quantity.
 * @param line.unitPrice - Price per unit.
 * @param line.minutes - Billed minutes on a timed line.
 * @returns The row text.
 */
function lineText(line: ReissueSource["lineItems"][number]): string {
  if (line.minutes != null && line.minutes > 0) return `${line.description}: ${line.minutes} min`;
  return `${line.description}: ${formatNZD(line.qty * line.unitPrice)}`;
}

/**
 * Builds the calculator prefill for re-issuing a voided invoice.
 * @param invoice - The voided invoice.
 * @returns What the calculator seeds from it.
 */
export function reissuePrefill(invoice: ReissueSource): ReissuePrefill {
  return {
    invoiceNumber: invoice.number,
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    issueDate: nzDateKey(invoice.issueDate),
    jobText: invoice.lineItems.map(lineText).join("\n"),
    notes: invoice.notes ?? "",
    alreadyPaid: invoice.alreadyPaid && invoice.alreadyPaid > 0 ? invoice.alreadyPaid : null,
  };
}
