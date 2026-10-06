// src/features/business/lib/invoice-email-request.ts
// Shared request-side helpers for the invoice emails (preview / send / void / void-preview
// routes and the overdue reminders): operator override parsing and the invoice > email
// payload projection.

import { invoiceRecipient } from "@/features/business/lib/invoice-recipient";
import { prisma } from "@/shared/lib/prisma";
import type { Invoice } from "@prisma/client";
import type { NextRequest } from "next/server";

/** Operator overrides accepted by the invoice email routes. */
export interface InvoiceEmailOverrides {
  /** Targets a person inside a company invoice. */
  greetingName?: string;
  /** Replaces the intro paragraph. */
  customBody?: string;
  /**
   * Send route only: false cancels this invoice's automatic review ask (the operator
   * unticked it). Undefined or true leaves the ask to go out on schedule.
   */
  reviewAsk?: boolean;
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
> & {
  /** Who the email greets by default - the person behind a company invoice. */
  defaultGreeting: string;
};

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
    reviewAsk?: unknown;
    sendNotification?: unknown;
  };
  return {
    greetingName: typeof body.greetingName === "string" ? body.greetingName : undefined,
    customBody: typeof body.customBody === "string" ? body.customBody : undefined,
    reviewAsk: typeof body.reviewAsk === "boolean" ? body.reviewAsk : undefined,
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
    defaultGreeting: invoiceRecipient(invoice.clientName, contact).greetingName,
  };
}
