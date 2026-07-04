// src/app/admin/business/invoices/[id]/page.tsx
/**
 * @description View page for a single saved invoice. Loads the invoice by route
 * id (404 when missing), renders the {@link InvoiceActions} bar, and shows an
 * on-screen preview that mirrors the generated PDF layout.
 */
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { formatNZD } from "@/features/business/lib/business";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type React from "react";
import { InvoiceActions } from "./InvoiceActions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoice - Business",
  robots: { index: false, follow: false },
};

/**
 * View page for a single saved invoice.
 * @param root0 - Page props
 * @param root0.params - Route params containing the invoice ID
 * @returns Invoice view page element
 */
export default async function InvoiceViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  await requireAdminAuth();

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) notFound();

  const identity = await getIdentity();

  return (
    <AdminPageLayout current="business-invoices" contentClassName="mx-auto max-w-3xl px-6 py-8">
      {/* Actions bar */}
      <InvoiceActions
        backHref={`/admin/business/invoices`}
        driveWebUrl={invoice.driveWebUrl}
        invoiceId={invoice.id}
        invoiceNumber={invoice.number}
        clientName={invoice.clientName}
        clientEmail={invoice.clientEmail}
        status={invoice.status}
      />

      {/* Invoice preview - mirrors the trimmed PDF layout. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 print:border-0 print:shadow-none">
        {/* Header row: chip + wordmark (left), INVOICE block (right). */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <Image
            src="/source/logo-wordmark.svg"
            alt="To The Point Tech"
            width={2000}
            height={674}
            className="h-12 w-auto sm:h-20"
            priority
          />
          <div className="text-right">
            <p className="text-xl leading-none font-extrabold text-russian-violet sm:text-2xl">
              {identity.gstNumber ? "TAX INVOICE" : "INVOICE"}
            </p>
            <p className="mt-2 font-mono text-sm font-semibold text-slate-700">{invoice.number}</p>
            <p
              className={cn(
                "mt-1 text-xs",
                invoice.status === "PAID"
                  ? "font-semibold text-green-600"
                  : invoice.status === "SENT"
                    ? "font-semibold text-blue-600"
                    : invoice.status === "VOIDED"
                      ? "font-semibold text-[#5a2a82] line-through"
                      : "text-slate-400",
              )}
            >
              {invoice.status}
            </p>
            {invoice.status === "VOIDED" && invoice.voidedAt && (
              <p className="mt-0.5 text-xs text-slate-400">
                Voided {formatDateShort(invoice.voidedAt)}
              </p>
            )}
            {identity.gstNumber && (
              <p className="mt-1 text-xs text-slate-500">GST# {identity.gstNumber}</p>
            )}
          </div>
        </div>

        {/* Bill to (left) + dates (right) - mirrors PDF layout. */}
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <p className="mb-1 text-xs font-bold tracking-wider text-slate-400 uppercase">
              Bill to
            </p>
            <p className="text-base font-bold text-slate-800">{invoice.clientName}</p>
            <p className="text-sm text-slate-500">{invoice.clientEmail}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="flex justify-between gap-4">
              <span className="text-slate-500">Issued:</span>
              <span className="font-bold text-slate-800">{formatDateShort(invoice.issueDate)}</span>
            </p>
            <p className="flex justify-between gap-4">
              <span className="text-slate-500">Due:</span>
              <span className="font-bold text-slate-800">{formatDateShort(invoice.dueDate)}</span>
            </p>
          </div>
        </div>

        {/* Clean table (matches PDF): bold dark headers on white with a brand-coloured
            bottom border. Column widths in % match the PDF: Description 67%, Qty 9%,
            Unit price 11%, Total 13%. */}
        <table className="mb-0 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-russian-violet text-slate-800">
              <th className="w-[67%] px-2 py-2 text-left font-bold sm:px-3">Description</th>
              <th className="w-[9%] px-2 py-2 text-center font-bold sm:px-3">Qty</th>
              <th className="w-[11%] px-2 py-2 text-center font-bold sm:px-3">Price</th>
              <th className="w-[13%] px-2 py-2 text-center font-bold sm:px-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item, idx) => (
              // No zebra striping - matches the generated PDF and the builder preview panel.
              <tr key={idx}>
                <td className="px-2 py-2 align-top wrap-break-word text-slate-700 sm:px-3">
                  {item.description}
                </td>
                <td className="px-2 py-2 text-right align-top text-slate-700 sm:px-3">
                  {item.qty}
                </td>
                <td className="px-2 py-2 text-right align-top whitespace-nowrap text-slate-700 sm:px-3">
                  {formatNZD(item.unitPrice)}
                </td>
                <td className="px-2 py-2 text-right align-top font-bold whitespace-nowrap text-slate-800 sm:px-3">
                  {formatNZD(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 mb-6 h-px bg-slate-300" />

        <div className="mb-6 ml-auto w-3/5 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Subtotal</span>
            <span className="font-medium whitespace-nowrap text-slate-700">
              {formatNZD(invoice.subtotal)}
            </span>
          </div>
          {invoice.promoDiscount && invoice.promoDiscount > 0 && (
            <div className="flex justify-between gap-3 text-amber-700">
              <span>Promo (labor only){invoice.promoTitle ? `: ${invoice.promoTitle}` : ""}</span>
              <span className="whitespace-nowrap">-{formatNZD(invoice.promoDiscount)}</span>
            </div>
          )}
          {invoice.unsuccessfulDiscount && invoice.unsuccessfulDiscount > 0 && (
            <div className="flex justify-between gap-3 text-amber-700">
              <span>Unsuccessful-visit discount (half off labour)</span>
              <span className="whitespace-nowrap">-{formatNZD(invoice.unsuccessfulDiscount)}</span>
            </div>
          )}
          {invoice.gstAmount > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Includes GST</span>
              <span className="font-medium whitespace-nowrap text-slate-700">
                {formatNZD(invoice.gstAmount)}
              </span>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t border-slate-200 pt-1">
            <span className="font-semibold text-slate-800">Total</span>
            <span className="font-extrabold whitespace-nowrap text-russian-violet">
              {formatNZD(invoice.total)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <p className="mb-1 text-sm font-bold text-russian-violet">Bank transfer</p>
          <p>Payee: {identity.name}</p>
          <p className="font-semibold text-slate-700">Account: {identity.bankAccount}</p>
          <p className="font-semibold text-slate-700">Reference: {invoice.number}</p>
          <p>
            Due within {identity.paymentTermsDays} days of issue (by{" "}
            {formatDateShort(invoice.dueDate)}).
          </p>
        </div>
        {invoice.notes && <p className="mt-3 text-xs text-slate-500 italic">{invoice.notes}</p>}

        {/* Sender contact footer (matches the page-bottom footer in the PDF). */}
        <div className="mt-8 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
          {identity.email} &nbsp;·&nbsp; {identity.phone} &nbsp;·&nbsp; {identity.website}
          &nbsp;·&nbsp; {identity.location}
        </div>
      </div>
    </AdminPageLayout>
  );
}
