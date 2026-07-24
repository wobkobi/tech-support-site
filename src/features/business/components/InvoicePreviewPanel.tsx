"use client";
// src/features/business/components/InvoicePreviewPanel.tsx
/**
 * @description Live A4-styled invoice preview. The layout must stay in sync with
 * the generated PDF so the operator sees the same invoice the customer receives.
 * Pure presentational; memoised.
 */

import { calcInvoiceTotals, formatNZD } from "@/features/business/lib/business";
import type { LineItem } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type { IdentitySettings } from "@/shared/lib/settings/types";
import Image from "next/image";
import type React from "react";
import { memo } from "react";

interface Props {
  /** Live business identity (name, contact, bank account, GST#, payment terms). */
  identity: IdentitySettings;
  /** Invoice number to display. Use "DRAFT" for unsaved invoices. */
  number: string;
  clientName: string;
  clientEmail: string;
  /** ISO YYYY-MM-DD. */
  issueDate: string;
  /** ISO YYYY-MM-DD. */
  dueDate: string;
  lineItems: LineItem[];
  notes: string;
  promoTitle: string | null;
  /** Dollar amount; rendered when > 0. */
  promoDiscount: number;
  /** Half-price labour discount when operator ticked unsuccessful; rendered when > 0. */
  unsuccessfulDiscount?: number;
  /** Live GST-registration flag; controls the "Includes GST" line so the preview matches the saved invoice. */
  gstRegistered?: boolean;
}

/**
 * Live A4-styled invoice preview. Matches the generated PDF layout so the
 * operator sees the same invoice the customer will receive. Pure presentational.
 * @param props - Component props.
 * @param props.identity - Live business identity for the header/payment/footer.
 * @param props.number - Invoice number to display ("DRAFT" for unsaved).
 * @param props.clientName - Client name shown on the invoice header.
 * @param props.clientEmail - Client email shown on the invoice header.
 * @param props.issueDate - ISO YYYY-MM-DD issue date.
 * @param props.dueDate - ISO YYYY-MM-DD due date.
 * @param props.lineItems - Line items to render.
 * @param props.notes - Footer notes text.
 * @param props.promoTitle - Promo title (when discount > 0).
 * @param props.promoDiscount - Promo discount in dollars; renders the line when > 0.
 * @param props.unsuccessfulDiscount - Half-price labour discount; renders the line when > 0.
 * @param props.gstRegistered - Live GST-registration flag; controls the "Includes GST" line.
 * @returns Invoice preview element.
 */
function InvoicePreviewPanelImpl({
  identity,
  number,
  clientName,
  clientEmail,
  issueDate,
  dueDate,
  lineItems,
  notes,
  promoTitle,
  promoDiscount,
  unsuccessfulDiscount = 0,
  gstRegistered,
}: Props): React.ReactElement {
  const totals = calcInvoiceTotals(lineItems, promoDiscount + unsuccessfulDiscount, gstRegistered);
  const showPromoLine = promoDiscount > 0;
  const showUnsuccessfulLine = unsuccessfulDiscount > 0;
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm",
        "lg:sticky lg:top-4 lg:aspect-210/297 lg:overflow-y-auto",
        // Print: defeat sticky + scroll so the browser captures the full invoice.
        "print:static print:aspect-auto print:overflow-visible print:rounded-none print:border-0 print:shadow-none",
      )}
    >
      <div className="flex flex-1 flex-col px-5 pt-6 pb-6 sm:px-10 sm:pt-10 sm:pb-10">
        {/* Header row: chip + wordmark on the left, INVOICE block on the right. */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <Image
            src="/source/logo-wordmark.svg"
            alt="To the Point Tech"
            width={2000}
            height={674}
            className="h-12 w-auto sm:h-20"
            priority
          />
          <div className="text-right">
            <p className="text-xl leading-none font-extrabold text-russian-violet sm:text-2xl">
              {identity.gstNumber ? "TAX INVOICE" : "INVOICE"}
            </p>
            <p className="mt-2 font-mono text-sm text-slate-700">{number || "TTP-XXXX-0000"}</p>
            {number === "DRAFT" && (
              <p className="mt-1 text-[11px] font-bold text-slate-400 uppercase">DRAFT</p>
            )}
            {identity.gstNumber && (
              <p className="mt-1 text-[11px] text-slate-500">GST# {identity.gstNumber}</p>
            )}
          </div>
        </div>

        {/* Bill to (left) + dates (right). */}
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
              Bill to
            </p>
            <p className="text-sm font-bold text-slate-800">{clientName || "Client name"}</p>
            <p className="text-xs text-slate-500">{clientEmail || "client@email.com"}</p>
          </div>
          <div className="space-y-1 text-[11px]">
            <p className="flex justify-between gap-4">
              <span className="text-slate-500">Issued:</span>
              <span className="font-bold text-slate-800">
                {issueDate ? formatDateShort(issueDate) : "-"}
              </span>
            </p>
            <p className="flex justify-between gap-4">
              <span className="text-slate-500">Due:</span>
              <span className="font-bold text-slate-800">
                {dueDate ? formatDateShort(dueDate) : "-"}
              </span>
            </p>
          </div>
        </div>

        <div className="mb-0 h-px bg-slate-300" />

        {/* Line items table - no zebra striping (matches the PDF + Xero/QuickBooks).
            `table-fixed` enforces the <th> percentage widths so long descriptions
            wrap inside their cell instead of blowing out the column. At sm+ the
            widths mirror the PDF (Description 67% / Qty 9% / Price 11% / Total 13%);
            below sm those numeric columns widen so the right-aligned figures don't
            overflow their cell and collide on a narrow phone. */}
        <table className="mb-0 w-full table-fixed text-xs">
          <thead>
            <tr className="border-b-2 border-russian-violet text-slate-800">
              <th className="w-[46%] px-2 py-2 text-left font-bold sm:w-[67%]">Description</th>
              <th className="w-[10%] px-1 py-2 text-center font-bold sm:w-[9%] sm:px-2">Qty</th>
              <th className="w-[20%] px-1 py-2 text-center font-bold sm:w-[11%] sm:px-2">Price</th>
              <th className="w-[24%] px-1 py-2 text-center font-bold sm:w-[13%] sm:px-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-center text-xs text-slate-300 italic">
                  (no line items yet)
                </td>
              </tr>
            ) : (
              lineItems.map((item, idx) => (
                <tr
                  key={idx}
                  className={cn(
                    "border-b border-slate-100",
                    idx === lineItems.length - 1 && "border-b-0",
                  )}
                >
                  <td className="px-2 py-2 align-top wrap-break-word text-slate-700">
                    {item.description || (
                      <span className="text-slate-300 italic">(line description)</span>
                    )}
                  </td>
                  <td className="px-1 py-2 text-right align-top text-slate-700 sm:px-2">
                    {item.qty}
                  </td>
                  <td className="px-1 py-2 text-right align-top whitespace-nowrap text-slate-700 sm:px-2">
                    {formatNZD(item.unitPrice)}
                  </td>
                  <td className="px-1 py-2 text-right align-top font-bold whitespace-nowrap text-slate-700 sm:px-2">
                    {formatNZD(item.lineTotal)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="mb-4 h-px bg-slate-300" />

        {/* Totals (right-aligned). */}
        <div className="mb-6 ml-auto w-3/5 space-y-1 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Subtotal</span>
            <span className="whitespace-nowrap text-slate-700">{formatNZD(totals.subtotal)}</span>
          </div>
          {showPromoLine && (
            <div className="flex justify-between gap-3 text-amber-700">
              <span>Promo (labour only){promoTitle ? `: ${promoTitle}` : ""}</span>
              <span className="whitespace-nowrap">-{formatNZD(promoDiscount)}</span>
            </div>
          )}
          {showUnsuccessfulLine && (
            <div className="flex justify-between gap-3 text-amber-700">
              <span>Unsuccessful-visit discount (half off labour)</span>
              <span className="whitespace-nowrap">-{formatNZD(unsuccessfulDiscount)}</span>
            </div>
          )}
          {totals.gstAmount > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Includes GST</span>
              <span className="whitespace-nowrap text-slate-700">
                {formatNZD(totals.gstAmount)}
              </span>
            </div>
          )}
          <div className="h-px bg-slate-300" />
          <div className="flex justify-between gap-3 text-sm font-extrabold text-russian-violet">
            <span>Total</span>
            <span className="whitespace-nowrap">{formatNZD(totals.total)}</span>
          </div>
        </div>

        {/* Bank transfer call-out. */}
        <div className="mb-4 space-y-1 rounded-lg border border-slate-200 px-3 py-3 text-[11px]">
          <p className="text-xs font-bold text-russian-violet">Bank transfer</p>
          <p className="text-slate-500">Payee: {identity.name}</p>
          <p className="font-semibold text-slate-700">Account: {identity.bankAccount}</p>
          <p className="font-semibold text-slate-700">Reference: {number || "[invoice number]"}</p>
          <p className="text-slate-500">
            Due within {identity.paymentTermsDays} days of issue
            {dueDate ? ` (by ${formatDateShort(dueDate)}).` : "."}
          </p>
        </div>

        {notes && <p className="mb-6 text-[11px] text-slate-500">{notes}</p>}

        {/* Sender contact footer. */}
        <div className="mt-auto border-t border-slate-200 pt-3 text-center text-[10px] wrap-break-word text-slate-500">
          {identity.email} · {identity.phone} · {identity.website} · {identity.location}
        </div>
      </div>
    </div>
  );
}

// Memoised so parent re-renders with identical props skip the preview.
export const InvoicePreviewPanel = memo(InvoicePreviewPanelImpl);
