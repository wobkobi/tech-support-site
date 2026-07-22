// src/app/api/business/invoices/route.ts
/**
 * @description Admin invoices collection endpoint. GET lists every invoice
 * (newest issue date first). POST creates one: validates line items, allocates
 * the next TTP-YYYY-XXXX number (or Q-YYYY-XXXX from the quote counter when
 * `isQuote`), computes totals via {@link calcInvoiceTotals} (promo +
 * unsuccessful-work discounts reduce the taxable amount), writes back the
 * matching Sheets counter, then renders the PDF and uploads it to Drive.
 */

import { calcInvoiceTotals, isValidLineItem } from "@/features/business/lib/business";
import { syncInvoicePdfToDrive } from "@/features/business/lib/invoice-drive-sync";
import {
  getNextInvoiceNumber,
  getNextQuoteNumber,
  writeBackInvoiceCounter,
  writeBackQuoteCounter,
} from "@/features/business/lib/invoice-numbering";
import { generateInvoicePdf, serializeInvoice } from "@/features/business/lib/invoice-pdf";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { parseAmount } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/business/invoices - Returns all invoices ordered by creation date descending.
 * @param request - Incoming Next.js request
 * @returns JSON with invoices array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const invoices = await prisma.invoice.findMany({ orderBy: { issueDate: "desc" } });
  return NextResponse.json({ ok: true, invoices });
}

/**
 * POST /api/business/invoices - Creates a new invoice with auto-numbered TTP-YYYY-XXXX number.
 * @param request - Incoming Next.js request with invoice data in body
 * @returns JSON with the created invoice and optional sheet sync warning
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = await request.json();
  const {
    clientName,
    clientEmail,
    issueDate,
    dueDate,
    lineItems,
    notes,
    contactId,
    // Optional promo snapshot from the calculator (persisted for history).
    promoTitle,
    promoDiscount,
    // Optional unsuccessful-work flag + discount snapshot. Audit trail so
    // the admin dashboard can count how often the half-price clause fires.
    unsuccessful,
    unsuccessfulDiscount,
    // Optional match back to the billed job (calculator event-prefill flow).
    bookingId,
    calendarEventId,
    // Quote mode: Q- number from the quote counter, QUOTE PDF, no payment
    // until converted to a real invoice.
    isQuote,
    quoteValidUntil,
  } = body as {
    clientName?: string;
    clientEmail?: string;
    issueDate?: string;
    dueDate?: string;
    lineItems?: { qty: number; unitPrice: number; description: string; lineTotal: number }[];
    notes?: string | null;
    contactId?: string | null;
    promoTitle?: string | null;
    promoDiscount?: number | null;
    unsuccessful?: boolean;
    unsuccessfulDiscount?: number | null;
    bookingId?: string | null;
    calendarEventId?: string | null;
    isQuote?: boolean;
    quoteValidUntil?: string | null;
  };

  if (!clientName || !clientEmail || !Array.isArray(lineItems)) {
    return errorResponse("Missing required fields", 400);
  }
  // Guard each item before it reaches calcInvoiceTotals / prisma.create - a
  // non-finite qty/unitPrice/lineTotal would persist NaN totals.
  if (!lineItems.every(isValidLineItem)) {
    return errorResponse("Invalid line item", 400);
  }

  // Default issue + due dates server-side so the calculator's direct-save path
  // doesn't need to send them. Operators can still override either by sending
  // explicit issueDate / dueDate values.
  const issueDateValue = issueDate ? new Date(issueDate) : new Date();
  const identity = await getIdentity();
  const dueDateValue = dueDate
    ? new Date(dueDate)
    : new Date(Date.now() + identity.paymentTermsDays * 24 * 60 * 60 * 1000);
  // Quote validity: explicit date wins; default 30 days out. dueDate still
  // gets a value (schema requires one) but quotes never render or enforce it.
  const quoteValidValue = isQuote
    ? quoteValidUntil
      ? new Date(quoteValidUntil)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    : null;
  if (quoteValidValue && Number.isNaN(quoteValidValue.getTime())) {
    return errorResponse("Invalid quote validity date", 400);
  }

  // Validate the optional discount snapshots through the shared money parser so
  // a non-finite or absurd magnitude (e.g. Infinity, 1e12) can't reach the
  // persisted promoDiscount / unsuccessfulDiscount fields and print on the PDF.
  let discount = 0;
  if (promoDiscount != null) {
    const parsed = parseAmount(promoDiscount);
    if (parsed === null) return errorResponse("Invalid promo discount", 400);
    discount = parsed;
  }
  let unsuccessfulDiscountValue = 0;
  if (unsuccessfulDiscount != null) {
    const parsed = parseAmount(unsuccessfulDiscount);
    if (parsed === null) return errorResponse("Invalid unsuccessful-work discount", 400);
    unsuccessfulDiscountValue = parsed;
  }

  // GST mode is driven by the live pricing settings (gstRegistered); the
  // request body does not carry gst. Promo + unsuccessful both reduce the
  // taxable amount before GST (per IRD treatment of price reductions); they
  // sum into one discount argument for calcInvoiceTotals but persist as
  // separate audit fields. Totals are independent of the invoice number.
  const { GST_REGISTERED } = await getPolicy();
  const { subtotal, gstAmount, total } = calcInvoiceTotals(
    lineItems,
    discount + unsuccessfulDiscountValue,
    GST_REGISTERED,
  );

  // Allocate a number and create the invoice, retrying on a unique-number
  // collision. Concurrent creates or a stale sheet counter can mint the same
  // number; the unique index rejects the loser, and getNextInvoiceNumber
  // re-allocates above the new DB max on the next pass rather than 500ing.
  let invoice: Awaited<ReturnType<typeof prisma.invoice.create>> | null = null;
  let sheetNextCount: number | null = null;
  let sheetSyncWarning = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const alloc = isQuote ? await getNextQuoteNumber() : await getNextInvoiceNumber();
    sheetNextCount = alloc.sheetNextCount;
    sheetSyncWarning = alloc.sheetSyncWarning;
    try {
      invoice = await prisma.invoice.create({
        data: {
          number: alloc.number,
          isQuote: isQuote === true ? true : null,
          quoteValidUntil: quoteValidValue,
          clientName,
          clientEmail,
          issueDate: issueDateValue,
          dueDate: dueDateValue,
          lineItems,
          gst: gstAmount > 0,
          subtotal,
          gstAmount,
          total,
          promoTitle: discount > 0 && promoTitle ? promoTitle : null,
          promoDiscount: discount > 0 ? discount : null,
          unsuccessful: unsuccessful === true,
          unsuccessfulDiscount: unsuccessfulDiscountValue > 0 ? unsuccessfulDiscountValue : null,
          notes: notes ?? null,
          contactId: contactId ?? null,
          // ObjectId shape enforced here (Prisma throws on malformed ids at read
          // time otherwise); calendarEventId is a free-form Google id.
          bookingId: bookingId && /^[a-f0-9]{24}$/i.test(bookingId) ? bookingId : null,
          calendarEventId:
            typeof calendarEventId === "string" && calendarEventId ? calendarEventId : null,
        },
      });
      break;
    } catch (err) {
      // P2002 = unique constraint (the number index): re-allocate and retry.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempt < 4
      ) {
        console.warn(`[invoices] Invoice number ${alloc.number} collided; re-allocating.`);
        continue;
      }
      throw err;
    }
  }
  if (!invoice) {
    return errorResponse("Could not allocate a unique invoice number", 500);
  }

  // Keep the Sheets counter in sync; the helper swallows + logs failures so the
  // just-saved invoice isn't compromised by a transient Sheets hiccup. Quotes
  // write back their own counter (SETTINGS!B12), invoices B19.
  if (isQuote) {
    await writeBackQuoteCounter(sheetNextCount);
  } else {
    await writeBackInvoiceCounter(sheetNextCount);
  }

  // Generate the PDF and sync it to Drive. Awaited (not fire-and-forget) so it
  // completes before the response - Vercel freezes the instance once the
  // response is sent, so a detached promise may never run. Failures are
  // swallowed so a Drive hiccup never blocks invoice creation.
  try {
    const pdfBuffer = await generateInvoicePdf(serializeInvoice(invoice));
    await syncInvoicePdfToDrive(invoice, pdfBuffer, "[invoices]");
  } catch (err) {
    console.error("[invoices] Drive PDF upload failed:", err);
  }

  return NextResponse.json({ ok: true, invoice, sheetSyncWarning }, { status: 201 });
}
