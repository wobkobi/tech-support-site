import type { Metadata } from "next";
import type React from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import { requireAdminAuth } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { prisma } from "@/shared/lib/prisma";
import { formatNZD } from "@/features/business/lib/business";
import { formatDateShort } from "@/shared/lib/date-format";
import { cn } from "@/shared/lib/cn";
import { getIdentity } from "@/shared/lib/business-identity.server";
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
      <div
        className={cn(
          "rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none",
        )}
      >
        {/* Header row: chip + wordmark (left), INVOICE block (right). */}
        <div className={cn("mb-8 flex items-start justify-between gap-4")}>
          <Image
            src="/source/logo-wordmark.svg"
            alt="To The Point Tech"
            width={2000}
            height={674}
            className={cn("h-20 w-auto")}
            priority
          />
          <div className={cn("text-right")}>
            <p className={cn("text-russian-violet text-2xl font-extrabold leading-none")}>
              {identity.gstNumber ? "TAX INVOICE" : "INVOICE"}
            </p>
            <p className={cn("mt-2 font-mono text-sm font-semibold text-slate-700")}>
              {invoice.number}
            </p>
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
              <p className={cn("mt-0.5 text-xs text-slate-400")}>
                Voided {formatDateShort(invoice.voidedAt)}
              </p>
            )}
            {identity.gstNumber && (
              <p className={cn("mt-1 text-xs text-slate-500")}>GST# {identity.gstNumber}</p>
            )}
          </div>
        </div>

        {/* Bill to (left) + dates (right) - mirrors PDF layout. */}
        <div className={cn("mb-6 flex items-start justify-between gap-6")}>
          <div>
            <p className={cn("mb-1 text-xs font-bold uppercase tracking-wider text-slate-400")}>
              Bill to
            </p>
            <p className={cn("text-base font-bold text-slate-800")}>{invoice.clientName}</p>
            <p className={cn("text-sm text-slate-500")}>{invoice.clientEmail}</p>
          </div>
          <div className={cn("space-y-1 text-sm")}>
            <p className={cn("flex justify-between gap-4")}>
              <span className={cn("text-slate-500")}>Issued:</span>
              <span className={cn("font-bold text-slate-800")}>
                {formatDateShort(invoice.issueDate)}
              </span>
            </p>
            <p className={cn("flex justify-between gap-4")}>
              <span className={cn("text-slate-500")}>Due:</span>
              <span className={cn("font-bold text-slate-800")}>
                {formatDateShort(invoice.dueDate)}
              </span>
            </p>
          </div>
        </div>

        {/* Clean table (matches PDF): bold dark headers on white with a brand-coloured
            bottom border. Column widths in % match the PDF: Description 67%, Qty 9%,
            Unit price 11%, Total 13%. */}
        <table className={cn("mb-0 w-full text-sm")}>
          <thead>
            <tr className={cn("border-russian-violet border-b-2 text-slate-800")}>
              <th className={cn("w-[67%] px-3 py-2 text-left font-bold")}>Description</th>
              <th className={cn("w-[9%] px-3 py-2 text-center font-bold")}>Qty</th>
              <th className={cn("w-[11%] px-3 py-2 text-center font-bold")}>Price</th>
              <th className={cn("w-[13%] px-3 py-2 text-center font-bold")}>Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item, idx) => (
              <tr key={idx} className={cn(idx % 2 === 1 ? "bg-slate-50" : "bg-white")}>
                <td className={cn("px-3 py-2 align-top text-slate-700")}>{item.description}</td>
                <td className={cn("px-3 py-2 text-right align-top text-slate-700")}>{item.qty}</td>
                <td className={cn("px-3 py-2 text-right align-top text-slate-700")}>
                  {formatNZD(item.unitPrice)}
                </td>
                <td className={cn("px-3 py-2 text-right align-top font-bold text-slate-800")}>
                  {formatNZD(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={cn("mb-6 mt-4 h-px bg-slate-300")} />

        <div className={cn("mb-6 ml-auto w-3/5 space-y-1 text-sm")}>
          <div className={cn("flex justify-between gap-3")}>
            <span className={cn("text-slate-500")}>Subtotal</span>
            <span className={cn("whitespace-nowrap font-medium text-slate-700")}>
              {formatNZD(invoice.subtotal)}
            </span>
          </div>
          {invoice.promoDiscount && invoice.promoDiscount > 0 && (
            <div className={cn("flex justify-between gap-3 text-amber-700")}>
              <span>Promo (labor only){invoice.promoTitle ? `: ${invoice.promoTitle}` : ""}</span>
              <span className={cn("whitespace-nowrap")}>-{formatNZD(invoice.promoDiscount)}</span>
            </div>
          )}
          {invoice.unsuccessfulDiscount && invoice.unsuccessfulDiscount > 0 && (
            <div className={cn("flex justify-between gap-3 text-amber-700")}>
              <span>Unsuccessful-visit discount (half off labour)</span>
              <span className={cn("whitespace-nowrap")}>
                -{formatNZD(invoice.unsuccessfulDiscount)}
              </span>
            </div>
          )}
          {invoice.gstAmount > 0 && (
            <div className={cn("flex justify-between gap-3")}>
              <span className={cn("text-slate-500")}>Includes GST</span>
              <span className={cn("whitespace-nowrap font-medium text-slate-700")}>
                {formatNZD(invoice.gstAmount)}
              </span>
            </div>
          )}
          <div className={cn("flex justify-between gap-3 border-t border-slate-200 pt-1")}>
            <span className={cn("font-semibold text-slate-800")}>Total</span>
            <span className={cn("text-russian-violet whitespace-nowrap font-extrabold")}>
              {formatNZD(invoice.total)}
            </span>
          </div>
        </div>

        <div
          className={cn(
            "rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500",
          )}
        >
          <p className={cn("text-russian-violet mb-1 text-sm font-bold")}>Bank transfer</p>
          <p>Payee: {identity.name}</p>
          <p className={cn("font-semibold text-slate-700")}>Account: {identity.bankAccount}</p>
          <p className={cn("font-semibold text-slate-700")}>Reference: {invoice.number}</p>
          <p>
            Due within {identity.paymentTermsDays} days of issue (by{" "}
            {formatDateShort(invoice.dueDate)}).
          </p>
        </div>
        {invoice.notes && (
          <p className={cn("mt-3 text-xs italic text-slate-500")}>{invoice.notes}</p>
        )}

        {/* Sender contact footer (matches the page-bottom footer in the PDF). */}
        <div
          className={cn("mt-8 border-t border-slate-200 pt-3 text-center text-xs text-slate-500")}
        >
          {identity.email} &nbsp;·&nbsp; {identity.phone} &nbsp;·&nbsp; {identity.website}
          &nbsp;·&nbsp; {identity.location}
        </div>
      </div>
    </AdminPageLayout>
  );
}
