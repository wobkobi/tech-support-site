// src/features/business/lib/cancellation-invoice.ts
// Builds and saves the DRAFT invoice for a late cancellation or no-show, for both the
// customer and operator cancel routes.

import { calcInvoiceTotals } from "@/features/business/lib/business";
import { syncInvoicePdfToDrive } from "@/features/business/lib/invoice-drive-sync";
import {
  getNextInvoiceNumber,
  writeBackInvoiceCounter,
} from "@/features/business/lib/invoice-numbering";
import { generateInvoicePdf, serialiseInvoice } from "@/features/business/lib/invoice-pdf";
import {
  assessCancellation,
  calcTravelCharge,
  cancellationFeeLabel,
  cancellationNotes,
  type CancellationReason,
} from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import type { LineItem } from "@/features/business/types/business";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { sendInvoiceEmail } from "@/features/reviews/lib/email-invoice";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { Prisma, type Booking, type Invoice } from "@prisma/client";

export interface DraftCancellationInvoiceOptions {
  /** When the client called it off, for the notice check; defaults to cancelledAt, then now. */
  cancelledAt?: Date;
  /** Drives the customer-facing notes ("Late cancellation" / "No-show"). */
  reason?: CancellationReason;
  /** Email it and mark SENT; a send failure leaves the draft. */
  autoSend?: boolean;
}

/**
 * Builds and saves a DRAFT cancellation invoice, one per call (callers handle idempotency).
 * Travel uses the booking-time snapshot, else a live lookup of the notes' address.
 * @param booking - Booking row, already stamped with cancellation flags.
 * @param options - Travel + reason flags.
 */
export async function createDraftCancellationInvoice(
  booking: Booking,
  options: DraftCancellationInvoiceOptions,
): Promise<void> {
  const reason = options.reason ?? "late-cancellation";
  const { CANCELLATION, GST_REGISTERED, MIN_TRAVEL_CHARGE, TRAVEL_RATE_PER_HOUR } =
    await getPolicy();
  // Tier comes from the booking itself so the two cancel paths can't drift.
  const charge = assessCancellation(
    booking.startAt,
    options.cancelledAt ?? booking.cancelledAt ?? new Date(),
    {
      reason,
      meetingType: booking.meetingType === "remote" ? "remote" : "in-person",
      policy: CANCELLATION,
    },
  );

  // Enough notice to be free; a $0 draft is never right, whatever the caller checked.
  if (charge.fee <= 0) {
    console.log(`[cancellation-invoice] No fee applies for booking ${booking.id}; no draft.`);
    return;
  }

  const headline = cancellationFeeLabel(reason, booking.startAt);
  const lineItems: LineItem[] = [
    {
      description: headline,
      qty: 1,
      unitPrice: charge.fee,
      lineTotal: charge.fee,
    },
  ];

  if (charge.travelApplies) {
    let travelMins = booking.travelMinsAtBooking ?? 0;
    // Legacy rows missing the back-leg snapshot fall back to the outbound figure.
    let travelMinsBack = booking.travelMinsBackAtBooking ?? 0;
    if (!travelMins) {
      // Pre-snapshot rows: live lookup of the notes' address, timed at now.
      const addressMatch = booking.notes?.match(/Address:\s*(.+)/i);
      const address = addressMatch?.[1]?.trim();
      if (address) {
        try {
          const result = await lookupDriveRoundTrip(address);
          if (result.status === "ok") {
            travelMins = result.data.there.durationMins;
            travelMinsBack = result.data.back.durationMins;
          }
        } catch (err) {
          console.warn("[cancellation-invoice] travel lookup failed:", err);
        }
      }
    }
    if (travelMins > 0) {
      // Bill the rate the customer was quoted; live setting for pre-snapshot bookings.
      const travelRatePerHour = booking.travelRatePerHourAtBooking || TRAVEL_RATE_PER_HOUR;
      const travelCost = calcTravelCharge(
        travelMins,
        travelMinsBack || travelMins,
        travelRatePerHour,
        MIN_TRAVEL_CHARGE,
      );
      if (travelCost > 0) {
        lineItems.push({
          description: "Cancellation travel (round-trip)",
          qty: 1,
          unitPrice: travelCost,
          lineTotal: travelCost,
        });
      }
    }
  }

  // Shared numbering avoids unique-constraint collisions with the admin flow.
  let { number, sheetNextCount } = await getNextInvoiceNumber();
  const { subtotal, gstAmount, total } = calcInvoiceTotals(lineItems, 0, GST_REGISTERED);
  const now = new Date();
  const paymentTermsDays = (await getIdentity()).paymentTermsDays;

  let contactId: string | null = null;
  try {
    const { contact } = await findOrCreateContactByEmail(booking.email.trim().toLowerCase(), {
      name: booking.name,
      phone: booking.phone,
      address: booking.address ?? null,
    });
    contactId = contact.id;
  } catch (err) {
    console.warn("[cancellation-invoice] contact link failed:", err);
  }

  const customerNotes = cancellationNotes(reason, booking.startAt);

  // Retry on P2002: getNextInvoiceNumber isn't atomic, so a concurrent save can collide.
  let invoice: Invoice | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      invoice = await prisma.invoice.create({
        data: {
          number,
          clientName: booking.name,
          clientEmail: booking.email,
          issueDate: now,
          dueDate: new Date(now.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000),
          lineItems,
          gst: gstAmount > 0,
          subtotal,
          gstAmount,
          total,
          status: "DRAFT",
          notes: customerNotes,
          contactId,
          // Lets the booking detail page show it.
          bookingId: booking.id,
          // A fee invoice never triggers a review ask, even sent by hand later.
          reviewAskOutcome: "skipped",
          reviewAskNote: "cancellation_fee",
          reviewAskDecidedAt: now,
        },
      });
      break;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempt < 4
      ) {
        console.warn(`[cancellation-invoice] Invoice number ${number} collided; re-allocating.`);
        ({ number, sheetNextCount } = await getNextInvoiceNumber());
        continue;
      }
      throw err;
    }
  }
  if (!invoice) {
    throw new Error("Could not allocate a unique invoice number for the cancellation fee");
  }
  console.log(
    `[cancellation-invoice] Drafted ${reason} invoice ${number} for booking ${booking.id}`,
  );

  await writeBackInvoiceCounter(sheetNextCount);

  // Best-effort: a failure leaves it DRAFT to send by hand.
  if (options.autoSend) {
    await sendCancellationInvoice(invoice, reason);
  }
}

/**
 * Emails a new cancellation invoice and marks it SENT (PDF > email > status > Drive).
 * Swallows all errors; the draft stands.
 * @param invoice - The DRAFT cancellation invoice row just created.
 * @param reason - Drives the email body wording.
 */
async function sendCancellationInvoice(
  invoice: Invoice,
  reason: CancellationReason,
): Promise<void> {
  if (!invoice.clientEmail) {
    console.warn(`[cancellation-invoice] No client email on ${invoice.number}; left as draft.`);
    return;
  }

  const customBody =
    reason === "no-show"
      ? `This invoice covers the fee for missing the appointment we'd booked. Please see the attached PDF for the details.`
      : `This invoice covers the late-cancellation fee for the appointment you cancelled inside the notice window. Please see the attached PDF for the details.`;

  try {
    const pdfBytes = await generateInvoicePdf(serialiseInvoice(invoice));

    const ok = await sendInvoiceEmail({
      invoice: {
        number: invoice.number,
        clientName: invoice.clientName,
        clientEmail: invoice.clientEmail,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        total: invoice.total,
        driveWebUrl: invoice.driveWebUrl,
      },
      pdfBytes,
      customBody,
    });
    if (!ok) {
      console.warn(
        `[cancellation-invoice] Email send failed for ${invoice.number}; left as draft.`,
      );
      return;
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "SENT", sentAt: new Date() },
    });
    console.log(`[cancellation-invoice] Auto-sent ${invoice.number}.`);

    // Sync the sent PDF to Drive so the archive matches what the client got.
    await syncInvoicePdfToDrive(invoice, pdfBytes, "[cancellation-invoice]");
  } catch (err) {
    console.error(`[cancellation-invoice] Auto-send failed for ${invoice.number}:`, err);
  }
}
