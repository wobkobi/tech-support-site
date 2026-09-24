// src/app/admin/(shell)/business/invoices/[id]/edit/page.tsx
// DRAFT-only invoice edit page. Loads the invoice; a non-DRAFT status redirects to the
// detail page (SENT/PAID are audit-locked - void and reissue). Loads live identity +
// pricing policy in parallel so the form's totals and preview match what the server will
// recompute on save. The invoice's billed calendar events are resolved too, so the
// "Describe the job" box bills against the booked window and address like the calculator.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { EditInvoiceView } from "@/features/business/components/invoice/EditInvoiceView";
import type { InvoiceAiContext } from "@/features/business/components/invoice/InvoiceAiBox";
import type { InvoiceFormData } from "@/features/business/components/invoice/InvoiceForm";
import { buildEventPrefill } from "@/features/business/lib/event-prefill.server";
import { getPolicy, lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { nzDateKey } from "@/shared/lib/timezone-utils";
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
  const [identity, policy, prefill] = await Promise.all([
    getIdentity(),
    getPolicy(),
    // A deleted or unreachable event just leaves the box without a booked window.
    eventIds.length > 0 ? buildEventPrefill(eventIds).catch(() => null) : Promise.resolve(null),
  ]);
  const jobDate = prefill?.jobDate ?? nzDateKey(invoice.issueDate);
  // UTC midnight is midday in NZ, so the key's own NZ date is the one looked up.
  const holiday = await lookupPublicHoliday(new Date(`${jobDate}T00:00:00Z`)).catch(() => null);
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
      holidayUplift: holiday ? policy.PUBLIC_HOLIDAY_UPLIFT : 0,
    },
  };

  const initial: InvoiceFormData = {
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    // NZ calendar dates: an invoice raised before midday NZ is still the previous
    // day in UTC, and the form would save that shifted date back.
    issueDate: nzDateKey(invoice.issueDate),
    dueDate: nzDateKey(invoice.dueDate),
    lineItems: invoice.lineItems,
    notes: invoice.notes ?? "",
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
        }}
        identity={identity}
        gstRegistered={policy.GST_REGISTERED}
        paymentTermsDays={identity.paymentTermsDays}
        aiContext={aiContext}
      />
    </div>
  );
}
