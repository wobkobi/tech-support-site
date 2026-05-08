import type { Metadata } from "next";
import type React from "react";
import { notFound } from "next/navigation";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { prisma } from "@/shared/lib/prisma";
import { formatNZD, formatNZDate } from "@/features/business/lib/business";
import { cn } from "@/shared/lib/cn";
import { BUSINESS, BUSINESS_BANK_ACCOUNT } from "@/shared/lib/business-identity";
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
 * @param root0.searchParams - URL search parameters containing the admin token
 * @returns Invoice view page element
 */
export default async function InvoiceViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const [{ token }, { id }] = await Promise.all([searchParams, params]);
  const t = requireAdminToken(token);

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) notFound();

  return (
    <AdminPageLayout
      token={t}
      current="business-invoices"
      contentClassName="mx-auto max-w-3xl px-6 py-8"
    >
      {/* Actions bar */}
      <InvoiceActions
        backHref={`/admin/business/invoices?token=${encodeURIComponent(t)}`}
        driveWebUrl={invoice.driveWebUrl}
      />

      {/* Invoice preview */}
      <div
        className={cn(
          "rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none",
        )}
      >
        <div className={cn("mb-8 flex items-start justify-between")}>
          <div>
            <p className={cn("text-lg font-bold text-slate-800")}>{BUSINESS.company}</p>
            <p className={cn("text-sm text-slate-500")}>{BUSINESS.name}</p>
            <p className={cn("text-sm text-slate-500")}>{BUSINESS.email}</p>
            <p className={cn("text-sm text-slate-500")}>{BUSINESS.phone}</p>
          </div>
          <div className={cn("text-right")}>
            <p className={cn("text-russian-violet text-2xl font-extrabold")}>INVOICE</p>
            <p className={cn("font-mono text-sm font-semibold text-slate-700")}>{invoice.number}</p>
            <p
              className={cn(
                "mt-1 text-xs",
                invoice.status === "PAID"
                  ? "font-semibold text-green-600"
                  : invoice.status === "SENT"
                    ? "font-semibold text-blue-600"
                    : "text-slate-400",
              )}
            >
              {invoice.status}
            </p>
          </div>
        </div>

        <div className={cn("mb-8 grid grid-cols-2 gap-4 text-sm")}>
          <div>
            <p className={cn("mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400")}>
              Bill to
            </p>
            <p className={cn("font-medium text-slate-700")}>{invoice.clientName}</p>
            <p className={cn("text-slate-500")}>{invoice.clientEmail}</p>
          </div>
          <div className={cn("text-right")}>
            <p className={cn("text-xs text-slate-400")}>
              Issued: {formatNZDate(invoice.issueDate.toISOString())}
            </p>
            <p className={cn("text-xs text-slate-400")}>
              Due: {formatNZDate(invoice.dueDate.toISOString())}
            </p>
          </div>
        </div>

        <table className={cn("mb-6 w-full text-sm")}>
          <thead>
            <tr className={cn("border-b border-slate-200")}>
              <th className={cn("pb-2 text-left text-xs font-semibold text-slate-400")}>
                Description
              </th>
              <th className={cn("pb-2 text-right text-xs font-semibold text-slate-400")}>Qty</th>
              <th className={cn("pb-2 text-right text-xs font-semibold text-slate-400")}>Price</th>
              <th className={cn("pb-2 text-right text-xs font-semibold text-slate-400")}>Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item, idx) => (
              <tr key={idx} className={cn("border-b border-slate-100")}>
                <td className={cn("py-2 text-slate-700")}>{item.description}</td>
                <td className={cn("py-2 text-right text-slate-500")}>{item.qty}</td>
                <td className={cn("py-2 text-right text-slate-500")}>
                  {formatNZD(item.unitPrice)}
                </td>
                <td className={cn("py-2 text-right font-medium text-slate-700")}>
                  {formatNZD(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={cn("max-w-50 mb-6 ml-auto space-y-1 text-sm")}>
          <div className={cn("flex justify-between")}>
            <span className={cn("text-slate-500")}>Subtotal</span>
            <span className={cn("font-medium text-slate-700")}>{formatNZD(invoice.subtotal)}</span>
          </div>
          {invoice.gst && (
            <div className={cn("flex justify-between")}>
              <span className={cn("text-slate-500")}>GST (15%)</span>
              <span className={cn("font-medium text-slate-700")}>
                {formatNZD(invoice.gstAmount)}
              </span>
            </div>
          )}
          <div className={cn("flex justify-between border-t border-slate-200 pt-1")}>
            <span className={cn("font-semibold text-slate-800")}>Total</span>
            <span className={cn("text-russian-violet font-extrabold")}>
              {formatNZD(invoice.total)}
            </span>
          </div>
        </div>

        <div className={cn("border-t border-slate-100 pt-4 text-xs text-slate-500")}>
          <p className={cn("mb-1 font-semibold text-slate-600")}>Bank transfer</p>
          <p>Bank: {BUSINESS_BANK_ACCOUNT}</p>
          <p>Reference: {invoice.number}</p>
          {invoice.notes && <p className={cn("mt-3 italic")}>{invoice.notes}</p>}
        </div>
      </div>
    </AdminPageLayout>
  );
}
