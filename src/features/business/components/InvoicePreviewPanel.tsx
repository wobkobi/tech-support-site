"use client";

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
}

/**
 * Live A4-styled invoice preview. Mirrors invoice-pdf.ts so the operator sees
 * the same layout the customer will receive. Pure presentational.
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
}: Props): React.ReactElement {
  const totals = calcInvoiceTotals(lineItems, promoDiscount + unsuccessfulDiscount);
  const showPromoLine = promoDiscount > 0;
  const showUnsuccessfulLine = unsuccessfulDiscount > 0;
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm",
        "lg:aspect-210/297 lg:sticky lg:top-4 lg:overflow-y-auto",
        // Print: defeat sticky + scroll so the browser captures the full invoice.
        "print:static print:aspect-auto print:overflow-visible print:rounded-none print:border-0 print:shadow-none",
      )}
    >
      <div className={cn("flex flex-1 flex-col px-10 pb-10 pt-10")}>
        {/* Header row: chip + wordmark on the left, INVOICE block on the right. */}
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
            <p className={cn("mt-2 font-mono text-sm text-slate-700")}>
              {number || "TTP-XXXX-0000"}
            </p>
            {number === "DRAFT" && (
              <p className={cn("mt-1 text-[11px] font-bold uppercase text-slate-400")}>DRAFT</p>
            )}
            {identity.gstNumber && (
              <p className={cn("mt-1 text-[11px] text-slate-500")}>GST# {identity.gstNumber}</p>
            )}
          </div>
        </div>

        {/* Bill to (left) + dates (right). */}
        <div className={cn("mb-6 flex items-start justify-between gap-6")}>
          <div>
            <p className={cn("mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400")}>
              Bill to
            </p>
            <p className={cn("text-sm font-bold text-slate-800")}>{clientName || "Client name"}</p>
            <p className={cn("text-xs text-slate-500")}>{clientEmail || "client@email.com"}</p>
          </div>
          <div className={cn("space-y-1 text-[11px]")}>
            <p className={cn("flex justify-between gap-4")}>
              <span className={cn("text-slate-500")}>Issued:</span>
              <span className={cn("font-bold text-slate-800")}>
                {issueDate ? formatDateShort(issueDate) : "-"}
              </span>
            </p>
            <p className={cn("flex justify-between gap-4")}>
              <span className={cn("text-slate-500")}>Due:</span>
              <span className={cn("font-bold text-slate-800")}>
                {dueDate ? formatDateShort(dueDate) : "-"}
              </span>
            </p>
          </div>
        </div>

        <div className={cn("mb-0 h-px bg-slate-300")} />

        {/* Line items table - no zebra striping (matches the PDF + Xero/QuickBooks).
            `table-fixed` enforces the <th> percentage widths even at narrow
            viewports so long descriptions wrap inside their cell instead of
            blowing out the column. */}
        <table className={cn("mb-0 w-full table-fixed text-xs")}>
          <thead>
            <tr className={cn("border-russian-violet border-b-2 text-slate-800")}>
              <th className={cn("w-[67%] px-2 py-2 text-left font-bold")}>Description</th>
              <th className={cn("w-[9%] px-2 py-2 text-center font-bold")}>Qty</th>
              <th className={cn("w-[11%] px-2 py-2 text-center font-bold")}>Price</th>
              <th className={cn("w-[13%] px-2 py-2 text-center font-bold")}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className={cn("px-2 py-3 text-center text-xs italic text-slate-300")}
                >
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
                  <td className={cn("wrap-break-word px-2 py-2 align-top text-slate-700")}>
                    {item.description || (
                      <span className={cn("italic text-slate-300")}>(line description)</span>
                    )}
                  </td>
                  <td className={cn("px-2 py-2 text-right align-top text-slate-700")}>
                    {item.qty}
                  </td>
                  <td className={cn("px-2 py-2 text-right align-top text-slate-700")}>
                    {formatNZD(item.unitPrice)}
                  </td>
                  <td className={cn("px-2 py-2 text-right align-top font-bold text-slate-700")}>
                    {formatNZD(item.lineTotal)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className={cn("mb-4 h-px bg-slate-300")} />

        {/* Totals (right-aligned). */}
        <div className={cn("mb-6 ml-auto w-3/5 space-y-1 text-xs")}>
          <div className={cn("flex justify-between gap-3")}>
            <span className={cn("text-slate-500")}>Subtotal</span>
            <span className={cn("whitespace-nowrap text-slate-700")}>
              {formatNZD(totals.subtotal)}
            </span>
          </div>
          {showPromoLine && (
            <div className={cn("flex justify-between gap-3 text-amber-700")}>
              <span>Promo (labor only){promoTitle ? `: ${promoTitle}` : ""}</span>
              <span className={cn("whitespace-nowrap")}>-{formatNZD(promoDiscount)}</span>
            </div>
          )}
          {showUnsuccessfulLine && (
            <div className={cn("flex justify-between gap-3 text-amber-700")}>
              <span>Unsuccessful-visit discount (half off labour)</span>
              <span className={cn("whitespace-nowrap")}>-{formatNZD(unsuccessfulDiscount)}</span>
            </div>
          )}
          {totals.gstAmount > 0 && (
            <div className={cn("flex justify-between gap-3")}>
              <span className={cn("text-slate-500")}>Includes GST</span>
              <span className={cn("whitespace-nowrap text-slate-700")}>
                {formatNZD(totals.gstAmount)}
              </span>
            </div>
          )}
          <div className={cn("h-px bg-slate-300")} />
          <div
            className={cn("text-russian-violet flex justify-between gap-3 text-sm font-extrabold")}
          >
            <span>Total</span>
            <span className={cn("whitespace-nowrap")}>{formatNZD(totals.total)}</span>
          </div>
        </div>

        {/* Bank transfer call-out. */}
        <div
          className={cn("mb-4 space-y-1 rounded-lg border border-slate-200 px-3 py-3 text-[11px]")}
        >
          <p className={cn("text-russian-violet text-xs font-bold")}>Bank transfer</p>
          <p className={cn("text-slate-500")}>Payee: {identity.name}</p>
          <p className={cn("font-semibold text-slate-700")}>Account: {identity.bankAccount}</p>
          <p className={cn("font-semibold text-slate-700")}>
            Reference: {number || "[invoice number]"}
          </p>
          <p className={cn("text-slate-500")}>
            Due within {identity.paymentTermsDays} days of issue
            {dueDate ? ` (by ${formatDateShort(dueDate)}).` : "."}
          </p>
        </div>

        {notes && <p className={cn("mb-6 text-[11px] text-slate-500")}>{notes}</p>}

        {/* Sender contact footer. */}
        <div
          className={cn(
            "mt-auto border-t border-slate-200 pt-3 text-center text-[10px] text-slate-500",
          )}
        >
          {identity.email} &nbsp;·&nbsp; {identity.phone} &nbsp;·&nbsp; {identity.website}
          &nbsp;·&nbsp; {identity.location}
        </div>
      </div>
    </div>
  );
}

// Memoised so parent re-renders with identical props skip the preview.
export const InvoicePreviewPanel = memo(InvoicePreviewPanelImpl);
