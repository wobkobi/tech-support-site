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
import { generateInvoicePdf, serialiseInvoice } from "@/features/business/lib/invoice-pdf";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { parseAmount, parseObjectId } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { normaliseEmail } from "@/shared/lib/normalise-email";
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
    calendarEventIds,
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
    calendarEventIds?: string[];
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
  // Guarded like quoteValidUntil below: an unparseable date ("14/09/2026") reaches
  // prisma.create as an Invalid Date and throws outside any try/catch, 500ing with no
  // message - after getNextInvoiceNumber has already burnt a number off the counter.
  if (Number.isNaN(issueDateValue.getTime()) || Number.isNaN(dueDateValue.getTime())) {
    return errorResponse("Enter a valid issue date and due date", 400);
  }
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

  // De-duplicated so a repeated id cannot make a single-event job look merged.
  const mergedEventIds = Array.from(
    new Set(
      (Array.isArray(calendarEventIds) ? calendarEventIds : []).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  );
  // GST mode comes from the live pricing settings, never the request body. Promo and
  // unsuccessful discounts both reduce the taxable amount before GST (IRD treatment of
  // price reductions), so they sum into one argument but persist as separate fields.
  const { GST_REGISTERED } = await getPolicy();
  const { subtotal, gstAmount, total } = calcInvoiceTotals(
    lineItems,
    discount + unsuccessfulDiscountValue,
    GST_REGISTERED,
  );

  // Retry on a unique-number collision: concurrent creates or a stale sheet counter can
  // mint the same number, and the index rejects the loser. getNextInvoiceNumber then
  // re-allocates above the new DB max rather than 500ing.
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
          clientEmail: normaliseEmail(clientEmail),
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
          // Prisma throws on a malformed ObjectId, so check the shape here rather than
          // 500 the create; calendarEventId is a free-form Google id, not an ObjectId.
          contactId: parseObjectId(contactId),
          bookingId: parseObjectId(bookingId),
          calendarEventId:
            typeof calendarEventId === "string" && calendarEventId ? calendarEventId : null,
          // Merged jobs bill several events; calendarEventId above is the earliest.
          // Left empty below 2 so readers can treat "empty" as "see calendarEventId"
          // rather than as a second copy of it.
          calendarEventIds: mergedEventIds.length > 1 ? mergedEventIds : [],
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

  // Awaited, not fire-and-forget: Vercel freezes the instance once the response is sent,
  // so a detached promise may never run. Failures are swallowed so a Drive hiccup never
  // blocks invoice creation.
  try {
    const pdfBuffer = await generateInvoicePdf(serialiseInvoice(invoice));
    await syncInvoicePdfToDrive(invoice, pdfBuffer, "[invoices]");
  } catch (err) {
    console.error("[invoices] Drive PDF upload failed:", err);
  }

  return NextResponse.json({ ok: true, invoice, sheetSyncWarning }, { status: 201 });
}
