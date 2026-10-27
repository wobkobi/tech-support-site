// src/features/business/lib/invoice-email-request.ts
// Request-side helpers for the invoice email routes: override parsing and the email payload.

import { invoiceRecipient } from "@/features/business/lib/invoice-recipient";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import type { Invoice } from "@prisma/client";
import type { NextRequest } from "next/server";

/** Operator overrides accepted by the invoice email routes. */
export interface InvoiceEmailOverrides {
  /** Targets a person inside a company invoice. */
  greetingName?: string;
  /** Replaces the intro paragraph. */
  customBody?: string;
  /** Send route only: false cancels this invoice's automatic review ask. */
  reviewAsk?: boolean;
  /** Send route only: normalised recipient replacing Invoice.clientEmail (e.g. a bounce). */
  toEmail?: string;
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
  | "alreadyPaid"
  | "driveWebUrl"
  | "isQuote"
  | "quoteValidUntil"
  | "replacesNumber"
> & {
  /** Who the email greets by default - the person behind a company invoice. */
  defaultGreeting: string;
};

/**
 * Reads every operator override from a request body in one pass (it can only be consumed
 * once), tolerating a missing or malformed body.
 * @param request - The incoming request.
 * @returns The parsed overrides, with unset or wrongly-typed fields left undefined.
 */
export async function parseInvoiceEmailOverrides(
  request: NextRequest,
): Promise<InvoiceEmailOverrides> {
  const body = (await request.json().catch(() => ({}))) as {
    greetingName?: unknown;
    customBody?: unknown;
    reviewAsk?: unknown;
    toEmail?: unknown;
    sendNotification?: unknown;
  };
  return {
    greetingName: typeof body.greetingName === "string" ? body.greetingName : undefined,
    customBody: typeof body.customBody === "string" ? body.customBody : undefined,
    reviewAsk: typeof body.reviewAsk === "boolean" ? body.reviewAsk : undefined,
    toEmail:
      typeof body.toEmail === "string" ? normaliseEmail(body.toEmail) || undefined : undefined,
    sendNotification: body.sendNotification === true,
  };
}

/**
 * Projects an invoice down to the fields the email builders read. Looks up the
 * linked contact so an invoice addressed to "68 Ltd" greets Michael, not "68".
 * @param invoice - The full invoice row.
 * @returns The email payload subset.
 */
export async function toInvoiceEmailPayload(invoice: Invoice): Promise<InvoiceEmailPayload> {
  const contact = invoice.contactId
    ? await prisma.contact.findUnique({
        where: { id: invoice.contactId },
        select: { name: true, company: true },
      })
    : null;
  return {
    number: invoice.number,
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    total: invoice.total,
    alreadyPaid: invoice.alreadyPaid,
    driveWebUrl: invoice.driveWebUrl,
    isQuote: invoice.isQuote,
    quoteValidUntil: invoice.quoteValidUntil,
    replacesNumber: invoice.replacesNumber,
    defaultGreeting: invoiceRecipient(invoice.clientName, contact).greetingName,
  };
}
