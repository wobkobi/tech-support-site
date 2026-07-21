// src/app/admin/(shell)/business/invoices/[id]/edit/page.tsx
/**
 * @description DRAFT-only invoice edit page. Loads the invoice; a non-DRAFT
 * status redirects to the detail page (SENT/PAID are audit-locked - void and
 * reissue). Loads live identity + pricing policy in parallel so the form's totals
 * and preview match what the server will recompute on save.
 */
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { EditInvoiceView } from "@/features/business/components/invoice/EditInvoiceView";
import type { InvoiceFormData } from "@/features/business/components/invoice/InvoiceForm";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit invoice - Business",
  robots: { index: false, follow: false },
};

/**
 * Formats a Date as an ISO YYYY-MM-DD string for a date input.
 * @param d - The date.
 * @returns The YYYY-MM-DD string.
 */
function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

  const [identity, policy] = await Promise.all([getIdentity(), getPolicy()]);

  const initial: InvoiceFormData = {
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    issueDate: toDateInput(invoice.issueDate),
    dueDate: toDateInput(invoice.dueDate),
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
      />
    </div>
  );
}
