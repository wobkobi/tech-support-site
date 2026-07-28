// src/features/business/lib/invoice-email-request.ts
/**
 * @description Shared request-side helpers for the four invoice email routes
 * (preview / send / void / void-preview): operator override parsing, the
 * invoice > email payload projection, and the review-link inclusion rule that
 * preview and send had drifted apart on.
 */

import type { InvoiceReviewEligibility } from "@/features/business/lib/contact-review-token";
import type { Invoice } from "@prisma/client";
import type { NextRequest } from "next/server";

/** Operator overrides accepted by the invoice email routes. */
export interface InvoiceEmailOverrides {
  /** Targets a person inside a company invoice. */
  greetingName?: string;
  /** Replaces the intro paragraph. */
  customBody?: string;
  /** Forces the review link on/off; undefined defers to eligibility. */
  includeReview?: boolean;
  /** Void route only: whether to email the customer about the void. */
  sendNotification: boolean;
}

/** The invoice fields the email builders read. */
export type InvoiceEmailPayload = Pick<
  Invoice,
  | "number"
  | "clientName"
  | "clientEmail"
  | "issueDate"
  | "dueDate"
  | "total"
  | "driveWebUrl"
  | "isQuote"
  | "quoteValidUntil"
>;

/**
 * Reads the operator overrides from a request body, tolerating a missing or
 * malformed body. Every field is parsed here rather than per-route because the
 * body can only be consumed once, so a route needing `sendNotification` could
 * not also call a narrower helper.
 * @param request - The incoming request.
 * @returns The parsed overrides, with unset or wrongly-typed fields left undefined.
 */
export async function parseInvoiceEmailOverrides(
  request: NextRequest,
): Promise<InvoiceEmailOverrides> {
  const body = (await request.json().catch(() => ({}))) as {
    greetingName?: unknown;
    customBody?: unknown;
    includeReview?: unknown;
    sendNotification?: unknown;
  };
  return {
    greetingName: typeof body.greetingName === "string" ? body.greetingName : undefined,
    customBody: typeof body.customBody === "string" ? body.customBody : undefined,
    includeReview: typeof body.includeReview === "boolean" ? body.includeReview : undefined,
    sendNotification: body.sendNotification === true,
  };
}

/**
 * Projects an invoice down to the fields the email builders read.
 * @param invoice - The full invoice row.
 * @returns The email payload subset.
 */
export function toInvoiceEmailPayload(invoice: Invoice): InvoiceEmailPayload {
  return {
    number: invoice.number,
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    total: invoice.total,
    driveWebUrl: invoice.driveWebUrl,
    isQuote: invoice.isQuote,
    quoteValidUntil: invoice.quoteValidUntil,
  };
}

/**
 * Decides whether an invoice email carries a review ask, and with which URL.
 *
 * Unticking the box drops the link, but ticking it cannot force one on: an
 * explicit `true` from a stale client is ignored when eligibility says no. The
 * preview and send routes must apply this identically or the operator previews
 * a link the delivered email strips. Quotes never carry a review ask - the job
 * has not happened yet.
 * @param invoice - Invoice, narrowed to the quote flag.
 * @param eligibility - Result of the review-eligibility check.
 * @param override - The operator's explicit choice, when they made one.
 * @returns Whether to include the review ask, and the URL when included.
 */
export function resolveReviewInclusion(
  invoice: Pick<Invoice, "isQuote">,
  eligibility: InvoiceReviewEligibility,
  override: boolean | undefined,
): { includeReview: boolean; reviewUrl: string | null } {
  const includeReview =
    !invoice.isQuote && (override ?? eligibility.canSend) && eligibility.canSend;
  const reviewUrl =
    includeReview && "reviewUrl" in eligibility ? (eligibility.reviewUrl ?? null) : null;
  return { includeReview, reviewUrl };
}
