// src/features/business/lib/cancellation-invoice.ts
/**
 * @description Builds + writes the DRAFT invoice that covers a late
 * cancellation or no-show. Shared by /api/booking/cancel (customer) and
 * /api/admin/bookings/[id] (operator). Fire-and-forget callable; failures
 * log but never throw so the cancel action that triggered this stays clean.
 */

import { calcInvoiceTotals } from "@/features/business/lib/business";
import { uploadInvoicePdf } from "@/features/business/lib/google-drive";
import {
  getNextInvoiceNumber,
  writeBackInvoiceCounter,
} from "@/features/business/lib/invoice-numbering";
import { extractYearCode, generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { calcTravelCharge, FALLBACK_TRAVEL_RATE } from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { lookupDriveDistance } from "@/features/business/lib/travel-distance";
import type { LineItem } from "@/features/business/types/business";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { sendInvoiceEmail } from "@/features/reviews/lib/email";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import type { Booking, Invoice } from "@prisma/client";

export interface DraftCancellationInvoiceOptions {
  /** True when the cancel lands inside CANCELLATION.travelChargeHours and round-trip travel should be billed. */
  includeTravel: boolean;
  /** Hint shown in the auto-draft's customer-facing notes (e.g. "Late cancellation" / "No-show"). */
  reason?: "late-cancellation" | "no-show";
  /** When true, email the invoice and flip it to SENT instead of leaving it DRAFT. Best-effort: a send failure leaves the draft intact. */
  autoSend?: boolean;
}

/**
 * Builds + persists a DRAFT cancellation invoice. Idempotency is the
 * caller's job; this creates a new draft per call. Travel time prefers the
 * booking-time snapshot, falls back to parsing "Address: X" from notes +
 * a live Distance Matrix lookup for legacy rows.
 * @param booking - Booking row, already stamped with cancellation flags.
 * @param options - Travel + reason flags.
 */
export async function createDraftCancellationInvoice(
  booking: Booking,
  options: DraftCancellationInvoiceOptions,
): Promise<void> {
  const reason = options.reason ?? "late-cancellation";
  const { CANCELLATION, GST_REGISTERED, MIN_TRAVEL_CHARGE } = await getPolicy();
  const headline =
    reason === "no-show"
      ? `No-show fee - ${formatDateShort(booking.startAt)}`
      : `Late cancellation fee - ${formatDateShort(booking.startAt)}`;

  const lineItems: LineItem[] = [
    {
      description: headline,
      qty: 1,
      unitPrice: CANCELLATION.callOutFee,
      lineTotal: CANCELLATION.callOutFee,
    },
  ];

  if (options.includeTravel) {
    let travelMins = booking.travelMinsAtBooking ?? 0;
    if (!travelMins) {
      // Legacy fallback for pre-snapshot rows: notes-parse + live lookup.
      const addressMatch = booking.notes?.match(/Address:\s*(.+)/i);
      const address = addressMatch?.[1]?.trim();
      if (address) {
        try {
          const result = await lookupDriveDistance(address);
          if (result.status === "ok") travelMins = result.data.durationMins;
        } catch (err) {
          console.warn("[cancellation-invoice] travel lookup failed:", err);
        }
      }
    }
    if (travelMins > 0) {
      // Snapshot wins to lock in the rate the customer was quoted.
      let travelRatePerHour = booking.travelRatePerHourAtBooking ?? 0;
      if (!travelRatePerHour) {
        const travelRow = await prisma.rateConfig.findFirst({
          where: { unit: "travel-hour" },
        });
        travelRatePerHour = travelRow?.ratePerHour ?? FALLBACK_TRAVEL_RATE;
      }
      const travelCost = calcTravelCharge(travelMins, travelRatePerHour, MIN_TRAVEL_CHARGE);
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
  const { number, sheetNextCount } = await getNextInvoiceNumber();
  const { subtotal, gstAmount, total } = calcInvoiceTotals(lineItems, 0, GST_REGISTERED);
  const now = new Date();

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

  const customerNotes =
    reason === "no-show"
      ? `Charge for missing the appointment originally booked for ${formatDateShort(booking.startAt)}.`
      : `Late cancellation fee for the appointment originally booked for ${formatDateShort(booking.startAt)}.`;

  const invoice = await prisma.invoice.create({
    data: {
      number,
      clientName: booking.name,
      clientEmail: booking.email,
      issueDate: now,
      dueDate: new Date(
        now.getTime() + (await getIdentity()).paymentTermsDays * 24 * 60 * 60 * 1000,
      ),
      lineItems,
      gst: gstAmount > 0,
      subtotal,
      gstAmount,
      total,
      status: "DRAFT",
      notes: customerNotes,
      contactId,
    },
  });
  console.log(
    `[cancellation-invoice] Drafted ${reason} invoice ${number} for booking ${booking.id}`,
  );

  await writeBackInvoiceCounter(sheetNextCount);

  // Auto-send is best-effort: any failure logs and leaves the invoice DRAFT so
  // the operator can still send it by hand from the admin invoices list.
  if (options.autoSend) {
    await sendCancellationInvoice(invoice, reason);
  }
}

/**
 * Emails a freshly-drafted cancellation invoice and flips it to SENT. Mirrors
 * the operator send path (PDF > email > status > Drive sync) but omits the
 * review-link ask - a fee invoice is not the moment to request a review.
 * Swallows all errors: the booking is already cancelled and the draft stands.
 * @param invoice - The DRAFT cancellation invoice row just created.
 * @param reason - Drives the email body wording.
 */
async function sendCancellationInvoice(
  invoice: Invoice,
  reason: "late-cancellation" | "no-show",
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
    const pdfBytes = await generateInvoicePdf({
      ...invoice,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    });

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
      reviewUrl: null,
      customBody,
    });
    if (!ok) {
      console.warn(
        `[cancellation-invoice] Email send failed for ${invoice.number}; left as draft.`,
      );
      return;
    }

    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "SENT" } });
    console.log(`[cancellation-invoice] Auto-sent ${invoice.number}.`);

    // Sync the sent PDF to Drive so the archive matches what the client got.
    // Drive failure is non-fatal - the email already went out.
    try {
      const yearCode = extractYearCode(invoice.number);
      const drive = await uploadInvoicePdf(
        pdfBytes,
        invoice.number,
        yearCode,
        invoice.driveFileId ?? undefined,
      );
      if (drive.fileId !== invoice.driveFileId || drive.webUrl !== invoice.driveWebUrl) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { driveFileId: drive.fileId, driveWebUrl: drive.webUrl },
        });
      }
    } catch (err) {
      console.error(`[cancellation-invoice] Drive sync failed for ${invoice.number}:`, err);
    }
  } catch (err) {
    console.error(`[cancellation-invoice] Auto-send failed for ${invoice.number}:`, err);
  }
}
