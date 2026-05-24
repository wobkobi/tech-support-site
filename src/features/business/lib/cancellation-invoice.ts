// src/features/business/lib/cancellation-invoice.ts
/**
 * @file cancellation-invoice.ts
 * @description Builds + writes the DRAFT invoice that covers a late
 * cancellation. Shared by:
 * - /api/booking/cancel (customer self-serve cancel inside the fee window)
 * - /api/admin/bookings/[id] (operator cancels on the customer's behalf, or
 *   marks a no-show)
 *
 * The helper is intentionally side-effecting (creates an Invoice row,
 * potentially writes the Sheets counter back) and fire-and-forget callable.
 * Failures log; they never throw - the cancel/no-show action that triggered
 * this should never be blocked by an invoice draft failure.
 */

import type { Booking } from "@prisma/client";
import { prisma } from "@/shared/lib/prisma";
import { CANCELLATION, calcTravelCharge } from "@/features/business/lib/pricing-policy";
import { calcInvoiceTotals } from "@/features/business/lib/business";
import {
  getNextInvoiceNumber,
  writeBackInvoiceCounter,
} from "@/features/business/lib/invoice-numbering";
import { lookupDriveDistance } from "@/features/business/lib/travel-distance";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { BUSINESS_PAYMENT_TERMS_DAYS } from "@/shared/lib/business-identity";
import { formatDateShort } from "@/shared/lib/date-format";
import type { LineItem } from "@/features/business/types/business";

export interface DraftCancellationInvoiceOptions {
  /** True when the cancel lands inside CANCELLATION.travelChargeHours and round-trip travel should be billed. */
  includeTravel: boolean;
  /** Hint shown in the auto-draft's customer-facing notes (e.g. "Late cancellation" / "No-show"). */
  reason?: "late-cancellation" | "no-show";
}

/**
 * Builds + persists the DRAFT cancellation invoice for a booking. Idempotency
 * is the caller's responsibility - this just creates a new draft each time it
 * is called. Travel time is sourced from the booking-time snapshot when
 * present and falls back to a live `Address: X` parse + Distance Matrix
 * lookup when the booking pre-dates the snapshot wiring.
 * @param booking - Booking row, already stamped with cancellation flags.
 * @param options - Travel + reason flags.
 */
export async function createDraftCancellationInvoice(
  booking: Booking,
  options: DraftCancellationInvoiceOptions,
): Promise<void> {
  const reason = options.reason ?? "late-cancellation";
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
      // Legacy fallback: parse "Address: X" out of notes, attempt a live
      // Distance Matrix lookup. Pre-dates the booking-time snapshot wiring.
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
      // Prefer the snapshotted Travel rate (locks in what the customer was
      // quoted at booking time); fall back to the current rate.
      let travelRatePerHour = booking.travelRatePerHourAtBooking ?? 0;
      if (!travelRatePerHour) {
        const travelRow = await prisma.rateConfig.findFirst({
          where: { unit: "travel-hour" },
        });
        travelRatePerHour = travelRow?.ratePerHour ?? 40;
      }
      const travelCost = calcTravelCharge(travelMins, travelRatePerHour);
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

  // Same numbering source as the regular invoice create flow so we never
  // collide on the unique Invoice.number index.
  const { number, sheetNextCount } = await getNextInvoiceNumber();
  const { subtotal, gstAmount, total } = calcInvoiceTotals(lineItems, 0);
  const now = new Date();

  // Best-effort contact link so the invoice shows up under the right Contact
  // row in admin. Failures are non-fatal.
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

  await prisma.invoice.create({
    data: {
      number,
      clientName: booking.name,
      clientEmail: booking.email,
      issueDate: now,
      dueDate: new Date(now.getTime() + BUSINESS_PAYMENT_TERMS_DAYS * 24 * 60 * 60 * 1000),
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
}
