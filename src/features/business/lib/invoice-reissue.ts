// src/features/business/lib/invoice-reissue.ts
// Re-issuing a voided invoice: the calculator link and prefill. The job is rebuilt, not
// copied, so the promo re-prices for the job date.

import { formatNZD } from "@/features/business/lib/business-format";
import { isSurchargeLine } from "@/features/business/lib/surcharge-line";
import { nzDateKey } from "@/shared/lib/timezone-utils";

/** What the calculator carries over from a voided invoice it is re-issuing. */
export interface ReissuePrefill {
  /** Voided invoice's id, sent with the save so its already-paid entry moves across. */
  invoiceId: string;
  /** Voided invoice's number, named in the calculator banner. */
  invoiceNumber: string;
  /** Client details, used when no calendar event backs the job. */
  clientName: string;
  clientEmail: string;
  /**
   * NZ date (YYYY-MM-DD) of the voided invoice's job, else the day it was issued; the job date
   * when no event backs it, so a Saturday job invoiced on Monday keeps its weekend rates.
   */
  jobDate: string;
  /** The voided invoice's lines, one per row, seeded into "Describe the job". */
  jobText: string;
  /** Invoice notes, carried into the calculator's notes. */
  notes: string;
  /** Amount paid on the day, carried into the Already paid box; null when none. */
  alreadyPaid: number | null;
  /** How that amount came in, or null. */
  alreadyPaidMethod: string | null;
  /** The voided invoice was for a Gold Card holder, so the box starts ticked. */
  goldCard: boolean;
  /** The voided invoice billed a surcharge line; the calculator's tick starts on or off to match. */
  surcharge: boolean;
  /** Code of the promo the voided invoice took, re-applied so a typed code isn't lost. */
  promoCode: string | null;
}

/** The invoice fields a re-issue reads. */
interface ReissueSource {
  id: string;
  number: string;
  clientName: string;
  clientEmail: string;
  issueDate: Date;
  jobDate: string | null;
  lineItems: readonly {
    description: string;
    qty: number;
    unitPrice: number;
    minutes?: number | null;
  }[];
  notes: string | null;
  alreadyPaid: number | null;
  alreadyPaidMethod: string | null;
  goldCardPercent: number | null;
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
 * Calendar events the voided invoice billed, earliest first (empty when it had none).
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
 * One "Describe the job" row per line: "TV setup: 35 min" when timed, else "Travel: $15.00".
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
 * Builds the calculator prefill for re-issuing a voided invoice. The surcharge line stays out
 * of the job text: the calculator adds it back from the date, so parsed as a part it bills twice.
 * @param invoice - The voided invoice.
 * @param promoCode - Code of the promo it took, or null for an automatic one or none.
 * @returns What the calculator seeds from it.
 */
export function reissuePrefill(
  invoice: ReissueSource,
  promoCode: string | null = null,
): ReissuePrefill {
  /**
   * Whether a line is the weekend, public-holiday or after-hours surcharge.
   * @param l - An invoice line.
   * @returns True for the surcharge line.
   */
  const isSurcharge = (l: ReissueSource["lineItems"][number]): boolean =>
    isSurchargeLine(l.description);
  const alreadyPaid = invoice.alreadyPaid && invoice.alreadyPaid > 0 ? invoice.alreadyPaid : null;
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    jobDate: invoice.jobDate ?? nzDateKey(invoice.issueDate),
    jobText: invoice.lineItems
      .filter((l) => !isSurcharge(l))
      .map(lineText)
      .join("\n"),
    notes: invoice.notes ?? "",
    alreadyPaid,
    alreadyPaidMethod: alreadyPaid === null ? null : invoice.alreadyPaidMethod,
    goldCard: (invoice.goldCardPercent ?? 0) > 0,
    surcharge: invoice.lineItems.some(isSurcharge),
    promoCode,
  };
}
