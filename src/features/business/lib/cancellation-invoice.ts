// src/features/business/lib/cancellation-invoice.ts
/**
 * @file cancellation-invoice.ts
 * @description Builds + writes the DRAFT invoice that covers a late
 * cancellation or no-show. Shared by /api/booking/cancel (customer) and
 * /api/admin/bookings/[id] (operator). Fire-and-forget callable; failures
 * log but never throw so the cancel action that triggered this stays clean.
 */

import { calcInvoiceTotals } from "@/features/business/lib/business";
import {
  getNextInvoiceNumber,
  writeBackInvoiceCounter,
} from "@/features/business/lib/invoice-numbering";
import { calcTravelCharge, FALLBACK_TRAVEL_RATE } from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { lookupDriveDistance } from "@/features/business/lib/travel-distance";
import type { LineItem } from "@/features/business/types/business";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import type { Booking } from "@prisma/client";

export interface DraftCancellationInvoiceOptions {
  /** True when the cancel lands inside CANCELLATION.travelChargeHours and round-trip travel should be billed. */
  includeTravel: boolean;
  /** Hint shown in the auto-draft's customer-facing notes (e.g. "Late cancellation" / "No-show"). */
  reason?: "late-cancellation" | "no-show";
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

  await prisma.invoice.create({
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
}
