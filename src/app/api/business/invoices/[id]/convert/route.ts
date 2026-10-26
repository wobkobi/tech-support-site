// src/app/api/business/invoices/[id]/convert/route.ts
// Converts a quote into an invoice: next TTP number, dates restamped from today, PDF
// re-synced. The row keeps its id, so links and history carry over.

import { completeBilledBookings } from "@/features/booking/lib/complete-billed-bookings.server";
import { syncInvoicePdfToDriveById } from "@/features/business/lib/invoice-drive-sync";
import { calcInvoiceTotals } from "@/features/business/lib/invoice-maths";
import {
  getNextInvoiceNumber,
  writeBackInvoiceCounter,
} from "@/features/business/lib/invoice-numbering";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import {
  releaseBookingRedemptions,
  settlePromoRedemption,
} from "@/features/business/lib/promo-redemption";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/[id]/convert - promotes a quote to an invoice.
 * @param request - Incoming Next.js request.
 * @param params - Route parameters containing the invoice ID.
 * @param params.params - Promise resolving to the dynamic route params object.
 * @returns JSON with the converted invoice, its previous Q- number and a sheet warning.
 */
export async function POST(
  request: NextRequest,
  params: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params.params;
  let existing;
  try {
    existing = await prisma.invoice.findUnique({ where: { id } });
  } catch {
    // Malformed ObjectId throws P2023; treat as not found.
    return errorResponse("Invoice not found.", 404);
  }
  if (!existing) return errorResponse("Invoice not found.", 404);
  if (!existing.isQuote) {
    return errorResponse("This is already an invoice.", 409);
  }
  if (existing.status === "VOIDED") {
    return errorResponse("A voided quote can't be converted.", 409);
  }

  const previousNumber = existing.number;
  const identity = await getIdentity();
  // GST as it stands at conversion, not when the quote was written.
  const { GST_REGISTERED } = await getPolicy();
  const totals = calcInvoiceTotals(
    existing.lineItems,
    (existing.promoDiscount ?? 0) +
      (existing.goldCardDiscount ?? 0) +
      (existing.unsuccessfulDiscount ?? 0),
    GST_REGISTERED,
  );
  const now = new Date();
  const dueDate = new Date(now.getTime() + identity.paymentTermsDays * 24 * 60 * 60 * 1000);

  // Same collision-retry loop as creation.
  let converted: Awaited<ReturnType<typeof prisma.invoice.update>> | null = null;
  let sheetNextCount: number | null = null;
  let sheetSyncWarning = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const alloc = await getNextInvoiceNumber();
    sheetNextCount = alloc.sheetNextCount;
    sheetSyncWarning = alloc.sheetSyncWarning;
    try {
      // Still a quote: a second tab converting at once matches nothing (P2025 below), so
      // it can't take a second number and leave a gap in the sequence.
      converted = await prisma.invoice.update({
        where: { id, isQuote: true },
        data: {
          number: alloc.number,
          isQuote: null,
          quoteValidUntil: null,
          // The payment clock starts at conversion.
          issueDate: now,
          dueDate,
          gst: totals.gstAmount > 0,
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          total: totals.total,
          // Back to DRAFT: the operator sends the real invoice as its own step.
          status: "DRAFT",
          sentAt: null,
          // Clear so the real invoice's review ask starts fresh.
          reviewAskOutcome: null,
          reviewAskNote: null,
          reviewAskDecidedAt: null,
          reviewAskAttempts: null,
        },
      });
      break;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return errorResponse("This quote was just converted. Reload to see the invoice.", 409);
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempt < 4
      ) {
        console.warn(`[invoices/convert] Number ${alloc.number} collided; re-allocating.`);
        continue;
      }
      throw err;
    }
  }
  if (!converted) {
    return errorResponse("Could not allocate a unique invoice number", 500);
  }

  await writeBackInvoiceCounter(sheetNextCount);
  // The quote is now billed work, so the booking it priced is done.
  await completeBilledBookings(
    {
      bookingId: converted.bookingId,
      calendarEventId: converted.calendarEventId,
      calendarEventIds: converted.calendarEventIds,
    },
    "[invoices/convert]",
  );
  // A quote is not a promo use; now it is billed work, settle it toward the cap.
  if (converted.promoId && (converted.promoDiscount ?? 0) > 0) {
    await settlePromoRedemption({
      promoId: converted.promoId,
      invoiceId: converted.id,
      bookingId: converted.bookingId,
      contactId: converted.contactId,
      discountValue: converted.promoDiscount ?? 0,
    });
  } else if (converted.bookingId) {
    await releaseBookingRedemptions(converted.bookingId);
  }
  console.log(`[invoices/convert] Quote ${previousNumber} converted to ${converted.number}.`);

  // Re-render + re-upload the PDF under the new number (awaited; never throws).
  await syncInvoicePdfToDriveById(id, "[invoices/convert]");

  return NextResponse.json({ ok: true, invoice: converted, previousNumber, sheetSyncWarning });
}
