// src/app/admin/(shell)/business/invoices/[id]/edit/page.tsx
// DRAFT-only invoice edit page (others redirect to detail). Loads live pricing so totals
// match the server's recompute, and billed events so the AI box uses the booked window.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { EditInvoiceView } from "@/features/business/components/invoice/EditInvoiceView";
import type { InvoiceAiContext } from "@/features/business/components/invoice/InvoiceAiBox";
import type { InvoiceFormData } from "@/features/business/components/invoice/InvoiceForm";
import {
  EMPTY_ALREADY_PAID,
  toAlreadyPaidMethod,
} from "@/features/business/lib/already-paid-input";
import type { JobPromo } from "@/features/business/lib/business";
import { buildEventPrefill } from "@/features/business/lib/event-prefill.server";
import { dateSurcharge } from "@/features/business/lib/pricing-policy";
import { getPolicy, lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { lockedInPromo } from "@/features/business/lib/promos";
import type { RateConfig } from "@/features/business/types/business";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { nzDateKey, nzWeekday } from "@/shared/lib/timezone-utils";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit invoice - Business",
  robots: { index: false, follow: false },
};

/**
 * DRAFT invoice edit page.
 * @param props - Page props.
 * @param props.params - Route params containing the invoice ID.
 * @returns The edit page element.
 */
export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  await requireAdminAuth();

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) notFound();
  // Only DRAFT invoices are editable; SENT/PAID/VOIDED are audit-locked.
  if (invoice.status !== "DRAFT") redirect(`/admin/business/invoices/${id}`);

  // Merged jobs list every event; older and single-event invoices only carry the one.
  const eventIds =
    invoice.calendarEventIds.length > 0
      ? invoice.calendarEventIds
      : invoice.calendarEventId
        ? [invoice.calendarEventId]
        : [];
  const promoId = (invoice.promoDiscount ?? 0) > 0 ? invoice.promoId : null;
  const [identity, policy, prefill, rateRows, booking] = await Promise.all([
    getIdentity(),
    getPolicy(),
    // A deleted or unreachable event just leaves the box without a booked window.
    eventIds.length > 0 ? buildEventPrefill(eventIds).catch(() => null) : Promise.resolve(null),
    prisma.rateConfig.findMany().catch(() => []),
    promoId && invoice.bookingId
      ? prisma.booking
          .findUnique({
            where: { id: invoice.bookingId },
            select: { promoTermsAtBooking: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  // Dates flattened to the ISO strings the client rate type expects.
  const rates: RateConfig[] = rateRows.map((r) => ({
    id: r.id,
    label: r.label,
    ratePerHour: r.ratePerHour,
    flatRate: r.flatRate,
    hourlyDelta: r.hourlyDelta,
    percentDelta: r.percentDelta,
    unit: r.unit,
    isDefault: r.isDefault,
    createdAt: r.createdAt.toISOString(),
  }));
  // The invoice's promo, re-applied when the AI box rebuilds the lines (window not
  // re-judged). A deleted promo falls back to the stored dollar figure.
  const promoTerms = promoId
    ? await lockedInPromo(promoId, null, booking?.promoTermsAtBooking)
    : null;
  const promo: JobPromo | null =
    promoTerms ??
    ((invoice.promoDiscount ?? 0) > 0
      ? {
          discountType: "fixed_amount",
          fixedAmount: invoice.promoDiscount,
          flatHourlyRate: null,
          percentDiscount: null,
        }
      : null);
  // Issue date is the last resort, or a Saturday job invoiced Monday loses its surcharge.
  const jobDate = prefill?.jobDate ?? invoice.jobDate ?? nzDateKey(invoice.issueDate);
  // UTC midnight is midday in NZ, so the key's own NZ date is the one looked up.
  const jobDay = new Date(`${jobDate}T00:00:00Z`);
  const holiday = await lookupPublicHoliday(jobDay).catch(() => null);
  const aiContext: InvoiceAiContext = {
    slots: prefill?.slots ?? [],
    jobDate,
    fallbackDestination:
      prefill && prefill.meetingType !== "remote" && prefill.jobAddress ? prefill.jobAddress : null,
    pricing: {
      taskTiming: {
        snapMins: policy.BILLING_INCREMENT_MINS,
        shortTaskMins: policy.SHORT_TASK_MINS,
        minTaskMins: policy.MIN_TASK_MINS,
      },
      minBillableMins: policy.MIN_BILLABLE_MINS,
      travelRatePerHour: policy.TRAVEL_RATE_PER_HOUR,
      minTravelCharge: policy.MIN_TRAVEL_CHARGE,
      surcharge: dateSurcharge(holiday?.name ?? null, nzWeekday(jobDay), {
        publicHolidayUplift: policy.PUBLIC_HOLIDAY_UPLIFT,
        weekendUplift: policy.WEEKEND_UPLIFT,
      }),
      unsuccessfulFactor: policy.UNSUCCESSFUL_WORK_FACTOR,
      // Picked like the calculator, so both price a promo identically.
      businessModifierId:
        rates.find((r) => r.label === "Business" && r.unit === "modifier")?.id ?? null,
      standardRate:
        rates.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
        rates.find((r) => r.ratePerHour !== null && r.unit === "hour")?.ratePerHour ??
        null,
      rates,
      // The share kept on the invoice, not today's rate, like the promo terms.
      goldCardPercent: invoice.goldCardPercent ?? 0,
    },
    promo,
  };

  const initial: InvoiceFormData = {
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    // NZ calendar dates: before midday NZ is still the previous day in UTC.
    issueDate: nzDateKey(invoice.issueDate),
    dueDate: nzDateKey(invoice.dueDate),
    lineItems: invoice.lineItems,
    notes: invoice.notes ?? "",
    alreadyPaid: invoice.alreadyPaid
      ? {
          amount: invoice.alreadyPaid.toFixed(2),
          method: toAlreadyPaidMethod(invoice.alreadyPaidMethod),
        }
      : EMPTY_ALREADY_PAID,
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Invoices", href: "/admin/business/invoices" },
          { label: invoice.number, href: `/admin/business/invoices/${id}` },
          { label: "Edit" },
        ]}
        title={`Edit ${invoice.number}`}
      />
      <EditInvoiceView
        invoiceId={invoice.id}
        invoiceNumber={invoice.number}
        initial={initial}
        preservedDiscounts={{
          promoTitle: invoice.promoTitle,
          promoDiscount: invoice.promoDiscount ?? 0,
          unsuccessfulDiscount: invoice.unsuccessfulDiscount ?? 0,
          goldCardDiscount: invoice.goldCardDiscount ?? 0,
          goldCardPercent: invoice.goldCardPercent,
        }}
        identity={identity}
        gstRegistered={policy.GST_REGISTERED}
        paymentTermsDays={identity.paymentTermsDays}
        aiContext={aiContext}
      />
    </div>
  );
}
