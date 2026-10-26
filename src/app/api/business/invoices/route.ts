// src/app/api/business/invoices/route.ts
// Admin invoices collection. POST allocates a TTP- (or Q- quote) number, computes totals,
// logs the job's trip when driven, and uploads the PDF to Drive.

import { completeBilledBookings } from "@/features/booking/lib/complete-billed-bookings.server";
import {
  calcInvoiceTotals,
  isValidLineItem,
  withSplitLineTotals,
} from "@/features/business/lib/business";
import {
  parseAlreadyPaid,
  syncAlreadyPaidIncome,
} from "@/features/business/lib/invoice-already-paid";
import { syncInvoicePdfToDrive } from "@/features/business/lib/invoice-drive-sync";
import {
  getNextInvoiceNumber,
  getNextQuoteNumber,
  writeBackInvoiceCounter,
  writeBackQuoteCounter,
} from "@/features/business/lib/invoice-numbering";
import { generateInvoicePdf, serialiseInvoice } from "@/features/business/lib/invoice-pdf";
import { invoiceRecipient } from "@/features/business/lib/invoice-recipient";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import {
  releaseBookingRedemptions,
  settlePromoRedemption,
} from "@/features/business/lib/promo-redemption";
import type { AutoTripResult } from "@/features/business/lib/trips";
import { autoLogJobTrip } from "@/features/business/lib/trips.server";
import {
  parseAmount,
  parseDate,
  parseObjectId,
  parseRate,
} from "@/features/business/lib/validation";
import { attachEmailIfMissing } from "@/features/contacts/lib/find-or-create";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { parseDateKey } from "@/shared/lib/date-format";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

/** Same cap as the booking address field. */
const MAX_TRIP_ADDRESS_LEN = 250;

/**
 * GET /api/business/invoices - Returns all invoices ordered by creation date descending.
 * @param request - Incoming Next.js request
 * @returns JSON with invoices array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const rows = await prisma.invoice.findMany({ orderBy: { issueDate: "desc" } });

  // Linked contacts let the list search by the person behind a company invoice.
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((id) => id !== null))];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, name: true, company: true },
      })
    : [];
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const invoices = rows.map((inv) => {
    const contact = (inv.contactId && contactById.get(inv.contactId)) || null;
    return {
      ...inv,
      contactName: contact?.name ?? null,
      contactCompany: contact?.company ?? null,
      attention: invoiceRecipient(inv.clientName, contact).attention,
    };
  });
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
    promoId,
    // Unsuccessful-work snapshot, so the dashboard can count the half-price clause.
    unsuccessful,
    unsuccessfulDiscount,
    // Gold Card holder: the share off labour and the dollars it came to.
    goldCardPercent,
    goldCardDiscount,
    // Optional match back to the billed job (calculator event-prefill flow).
    bookingId,
    calendarEventId,
    calendarEventIds,
    // Quote mode: Q- number, QUOTE PDF, no payment until converted.
    isQuote,
    quoteValidUntil,
    // Money paid before the invoice; its income date defaults to the issue date.
    alreadyPaid,
    alreadyPaidMethod,
    alreadyPaidDate,
    // NZ day the job was done, kept so a draft edit prices the surcharge for that day.
    jobDate,
    // Sent when the job was driven to (travel charged or not), to log the trip.
    trip,
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
    promoId?: string | null;
    unsuccessful?: boolean;
    unsuccessfulDiscount?: number | null;
    goldCardPercent?: number | null;
    goldCardDiscount?: number | null;
    bookingId?: string | null;
    calendarEventId?: string | null;
    calendarEventIds?: string[];
    isQuote?: boolean;
    quoteValidUntil?: string | null;
    alreadyPaid?: number | null;
    alreadyPaidMethod?: string | null;
    alreadyPaidDate?: string | null;
    jobDate?: string | null;
    trip?: { address?: unknown; date?: unknown } | null;
  };

  if (!clientName || !clientEmail || !Array.isArray(lineItems)) {
    return errorResponse("Missing required fields", 400);
  }
  // A non-finite numeric would persist NaN totals.
  if (!lineItems.every(isValidLineItem)) {
    return errorResponse("Invalid line item", 400);
  }
  // Re-derive line totals so they always add up to the subtotal.
  const lines = withSplitLineTotals(lineItems);

  // Server-side date defaults for the calculator's direct-save path.
  const issueDateValue = issueDate ? new Date(issueDate) : new Date();
  const identity = await getIdentity();
  const dueDateValue = dueDate
    ? new Date(dueDate)
    : new Date(Date.now() + identity.paymentTermsDays * 24 * 60 * 60 * 1000);
  // An unparseable date ("14/09/2026") would 500 after burning an invoice number.
  if (Number.isNaN(issueDateValue.getTime()) || Number.isNaN(dueDateValue.getTime())) {
    return errorResponse("Enter a valid issue date and due date", 400);
  }
  // Quote validity defaults to 30 days. Quotes never render or enforce dueDate.
  const quoteValidValue = isQuote
    ? quoteValidUntil
      ? new Date(quoteValidUntil)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    : null;
  if (quoteValidValue && Number.isNaN(quoteValidValue.getTime())) {
    return errorResponse("Invalid quote validity date", 400);
  }

  // Reject non-finite or absurd discounts (Infinity, 1e12) before they print on the PDF.
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
  let goldCardDiscountValue = 0;
  if (goldCardDiscount != null) {
    const parsed = parseAmount(goldCardDiscount);
    if (parsed === null) return errorResponse("Invalid Gold Card discount", 400);
    goldCardDiscountValue = parsed;
  }
  // Kept whenever the box was ticked, even on a job with no labour to take it off, so a
  // re-parse or reissue still knows the client holds one.
  let goldCardPercentValue: number | null = null;
  if (goldCardPercent != null) {
    goldCardPercentValue = parseRate(goldCardPercent);
    if (goldCardPercentValue === null) return errorResponse("Invalid Gold Card percent", 400);
  }

  // A quote bills nothing yet, so it never carries a part payment.
  const prepaid = isQuote
    ? { ok: true as const, amount: null, method: null }
    : parseAlreadyPaid(alreadyPaid, alreadyPaidMethod);
  if (!prepaid.ok) return errorResponse(prepaid.error, 400);
  const prepaidDate = alreadyPaidDate ? parseDate(alreadyPaidDate) : undefined;
  if (prepaidDate === null) return errorResponse("Invalid already-paid date", 400);
  // A bad trip request only skips the trip; it never blocks the invoice.
  const tripAddress = typeof trip?.address === "string" ? trip.address.trim() : "";
  const tripDate = parseDateKey(trip?.date);
  const tripRequest =
    !isQuote && tripAddress && tripAddress.length <= MAX_TRIP_ADDRESS_LEN && tripDate
      ? { address: tripAddress, date: tripDate }
      : null;

  // De-duplicated so a repeated id cannot make a single-event job look merged.
  const mergedEventIds = Array.from(
    new Set(
      (Array.isArray(calendarEventIds) ? calendarEventIds : []).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  );
  // GST mode comes from live settings, never the body. Every discount reduces the taxable
  // amount before GST (IRD treatment of price reductions).
  const { GST_REGISTERED } = await getPolicy();
  const { subtotal, gstAmount, total } = calcInvoiceTotals(
    lines,
    discount + goldCardDiscountValue + unsuccessfulDiscountValue,
    GST_REGISTERED,
  );

  // A missing or deleted contact saves the invoice unlinked rather than pointing nowhere.
  const requestedContactId = parseObjectId(contactId);
  const linkedContactId =
    requestedContactId &&
    (await prisma.contact.findFirst({
      where: { id: requestedContactId, deletedAt: null },
      select: { id: true },
    }))
      ? requestedContactId
      : null;

  // Retry on a number collision (concurrent creates or a stale sheet counter).
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
          jobDate:
            typeof jobDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(jobDate) ? jobDate : null,
          lineItems: lines,
          gst: gstAmount > 0,
          subtotal,
          gstAmount,
          total,
          promoTitle: discount > 0 && promoTitle ? promoTitle : null,
          promoDiscount: discount > 0 ? discount : null,
          promoId: discount > 0 ? parseObjectId(promoId) : null,
          unsuccessful: unsuccessful === true,
          unsuccessfulDiscount: unsuccessfulDiscountValue > 0 ? unsuccessfulDiscountValue : null,
          goldCardDiscount: goldCardDiscountValue > 0 ? goldCardDiscountValue : null,
          goldCardPercent: goldCardPercentValue || null,
          notes: notes ?? null,
          alreadyPaid: prepaid.amount,
          alreadyPaidMethod: prepaid.method,
          // Prisma throws on a malformed ObjectId; calendarEventId is a free-form Google id.
          contactId: linkedContactId,
          bookingId: parseObjectId(bookingId),
          calendarEventId:
            typeof calendarEventId === "string" && calendarEventId ? calendarEventId : null,
          // Merged jobs only; empty means "see calendarEventId" (the earliest).
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

  // Settle the booking-time redemption with its real value, so one job is one use.
  // A quote is not a use of the promo.
  const billedBookingId = parseObjectId(bookingId);
  if (!isQuote && promoId && discount > 0) {
    await settlePromoRedemption({
      promoId,
      invoiceId: invoice.id,
      bookingId: billedBookingId,
      contactId: linkedContactId,
      discountValue: discount,
    });
  } else if (!isQuote && billedBookingId) {
    // Billed with no promo discount, so the booking-time redemption went unused.
    await releaseBookingRedemptions(billedBookingId);
  }

  // A contact picked with no email (e.g. phone-only from Google) takes the billed address.
  await attachEmailIfMissing(invoice.contactId, invoice.clientEmail);

  // Invoicing means the job happened; a quote's booking completes on conversion.
  if (!isQuote) {
    await completeBilledBookings(
      {
        bookingId: billedBookingId,
        calendarEventId: invoice.calendarEventId,
        calendarEventIds: mergedEventIds,
      },
      "[invoices]",
    );
  }

  // One trip per job, logged once the invoice is saved.
  let tripResult: AutoTripResult | undefined;
  if (tripRequest) {
    tripResult = await autoLogJobTrip({
      bookingId: billedBookingId,
      calendarEventIds:
        mergedEventIds.length > 0
          ? mergedEventIds
          : invoice.calendarEventId
            ? [invoice.calendarEventId]
            : [],
      address: tripRequest.address,
      date: tripRequest.date,
      clientName: invoice.clientName,
      contactId: parseObjectId(contactId),
      invoiceNumber: invoice.number,
    });
  }

  // Record the part payment now, so marking paid later records only the balance.
  let incomeSheetWarning = false;
  if (prepaid.amount) {
    incomeSheetWarning = (await syncAlreadyPaidIncome(invoice.id, prepaidDate)).sheetSyncWarning;
  }

  // Helpers swallow failures. Quotes use SETTINGS!B12, invoices B19.
  if (isQuote) {
    await writeBackQuoteCounter(sheetNextCount);
  } else {
    await writeBackInvoiceCounter(sheetNextCount);
  }

  // Awaited: Vercel freezes the instance after the response. Failures are swallowed.
  try {
    const pdfBuffer = await generateInvoicePdf(serialiseInvoice(invoice));
    await syncInvoicePdfToDrive(invoice, pdfBuffer, "[invoices]");
  } catch (err) {
    console.error("[invoices] Drive PDF upload failed:", err);
  }

  return NextResponse.json(
    { ok: true, invoice, sheetSyncWarning, incomeSheetWarning, trip: tripResult },
    { status: 201 },
  );
}
