// src/app/admin/(shell)/business/invoices/[id]/page.tsx
/**
 * @description Detail page for a single saved invoice. Two-column on lg+: the A4
 * preview (mirrors the generated PDF) on the left, a context rail (timeline,
 * payment, linked records) on the right. Data loads in two batches so the preview
 * paints from batch 1 while the rail streams via Suspense from batch 2; both are
 * Server-Timing instrumented to catch this page's historically slow loads.
 */
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { InvoiceStatusBadge } from "@/features/business/components/invoice/InvoiceStatusBadge";
import { InvoiceTimeline } from "@/features/business/components/invoice/InvoiceTimeline";
import { formatNZD } from "@/features/business/lib/business";
import { isInvoiceOverdue } from "@/features/business/lib/invoice-status";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { ServerTimer } from "@/shared/lib/server-timing";
import type { Invoice as PrismaInvoice } from "@prisma/client";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type React from "react";
import { Suspense } from "react";
import { InvoiceActions } from "./InvoiceActions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoice - Business",
  robots: { index: false, follow: false },
};

/** Trimmed income entry shown in the payment rail card. */
interface LinkedIncomeEntry {
  id: string;
  amount: number;
  date: Date;
  method: string;
}

/**
 * A label/value row inside a rail card.
 * @param props - Component props.
 * @param props.label - Left-hand label.
 * @param props.children - Right-hand value.
 * @returns The row element.
 */
function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-admin-muted">{label}</span>
      <span className="text-right font-medium text-admin-text">{children}</span>
    </div>
  );
}

/**
 * Placeholder shown while the context rail (batch 2) streams in.
 * @returns The skeleton element.
 */
function RailSkeleton(): React.ReactElement {
  return (
    <div className="space-y-4" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-xl border border-admin-border bg-admin-surface shadow-sm"
        />
      ))}
    </div>
  );
}

/**
 * Streamed context rail: loads the linked booking + contact (batch 2, keyed off
 * the invoice) and renders the timeline, payment, and linked-records cards. The
 * linked income entries come pre-loaded from batch 1.
 * @param props - Component props.
 * @param props.invoice - The invoice (batch 1).
 * @param props.incomeEntries - Income entries linked to the invoice (batch 1).
 * @returns The rail element.
 */
async function InvoiceRail({
  invoice,
  incomeEntries,
}: {
  invoice: PrismaInvoice;
  incomeEntries: LinkedIncomeEntry[];
}): Promise<React.ReactElement> {
  const timer = new ServerTimer();
  const [booking, contact] = await timer.measure("rail", () =>
    Promise.all([
      invoice.bookingId
        ? prisma.booking
            .findUnique({
              where: { id: invoice.bookingId },
              select: { id: true, name: true, startAt: true },
            })
            .catch(() => null)
        : Promise.resolve(null),
      invoice.contactId
        ? prisma.contact
            .findUnique({
              where: { id: invoice.contactId },
              select: { id: true, name: true, email: true, phone: true },
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]),
  );
  timer.log("invoice-detail-rail");

  const overdue = isInvoiceOverdue(invoice);
  const isPaid = invoice.status === "PAID";
  const isVoided = invoice.status === "VOIDED";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Timeline" />
        <InvoiceTimeline
          status={invoice.status}
          createdAt={invoice.createdAt}
          sentAt={invoice.sentAt}
          reviewLinkSentAt={invoice.reviewLinkSentAt}
          paidAt={invoice.paidAt}
          paymentMethod={invoice.paymentMethod}
          paymentReference={invoice.paymentReference}
          voidedAt={invoice.voidedAt}
        />
      </Card>

      <Card>
        <CardHeader title="Payment" />
        {isPaid ? (
          <dl className="space-y-1 text-sm">
            <InfoRow label="Paid">
              {invoice.paidAt ? (
                formatDateShort(invoice.paidAt)
              ) : (
                <span className="text-admin-faint">date not recorded</span>
              )}
            </InfoRow>
            {invoice.paymentMethod && <InfoRow label="Method">{invoice.paymentMethod}</InfoRow>}
            {invoice.paymentReference && (
              <InfoRow label="Reference">{invoice.paymentReference}</InfoRow>
            )}
          </dl>
        ) : isVoided ? (
          <p className="text-sm text-admin-muted">Voided - no payment due.</p>
        ) : (
          <dl className="space-y-1 text-sm">
            <InfoRow label="Amount due">{formatNZD(invoice.total)}</InfoRow>
            <InfoRow label="Due">{formatDateShort(invoice.dueDate)}</InfoRow>
            {overdue && (
              <div className="pt-1">
                <StatusPill tone="critical">OVERDUE</StatusPill>
              </div>
            )}
          </dl>
        )}

        {incomeEntries.length > 0 && (
          <div className="mt-3 border-t border-admin-border pt-3">
            <p className="mb-1 text-xs font-semibold text-admin-muted uppercase">Linked income</p>
            {incomeEntries.map((e) => (
              <div key={e.id} className="flex justify-between gap-3 text-sm">
                <span className="text-admin-text-secondary">
                  {formatDateShort(e.date)} · {e.method}
                </span>
                <span className="font-medium text-admin-text">{formatNZD(e.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Linked records" />
        <dl className="space-y-2 text-sm">
          <InfoRow label="Booking">
            {booking ? (
              <>
                {booking.name}
                <span className="block text-xs font-normal text-admin-muted">
                  {formatDateShort(booking.startAt)} · #{booking.id.slice(-6)}
                </span>
              </>
            ) : (
              <span className="text-admin-faint">None</span>
            )}
          </InfoRow>
          <InfoRow label="Contact">
            {contact ? (
              <>
                {contact.name}
                <span className="block text-xs font-normal text-admin-muted">
                  {contact.email || contact.phone || "no details"}
                </span>
              </>
            ) : (
              <span className="text-admin-faint">Not linked</span>
            )}
          </InfoRow>
          <InfoRow label="Calendar">
            {invoice.calendarEventId ? "Linked" : <span className="text-admin-faint">None</span>}
          </InfoRow>
          <InfoRow label="Drive PDF">
            {invoice.driveWebUrl ? (
              <a
                href={invoice.driveWebUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-500 hover:text-blue-700"
              >
                View ↗
              </a>
            ) : (
              <span className="text-admin-faint">Not synced</span>
            )}
          </InfoRow>
        </dl>
      </Card>
    </div>
  );
}

/**
 * Detail page for a single saved invoice.
 * @param props - Page props.
 * @param props.params - Route params containing the invoice ID.
 * @param props.searchParams - Query params; `send=1` auto-opens the send preview.
 * @returns Invoice detail page element.
 */
export default async function InvoiceViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ send?: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  // `?send=1` (from the calculator's "Save & send") opens the send preview on mount.
  const { send } = await searchParams;
  await requireAdminAuth();
  const timer = new ServerTimer();

  // Batch 1: the A4 preview + header need the invoice and identity; the void
  // warning + payment card need the linked income. All keyed on the route id, so
  // they run in parallel with no waterfall.
  const [invoice, identity, incomeEntries] = await timer.measure("batch1", () =>
    Promise.all([
      prisma.invoice.findUnique({ where: { id } }),
      getIdentity(),
      prisma.incomeEntry.findMany({
        where: { invoiceId: id },
        select: { id: true, amount: true, date: true, method: true },
        orderBy: { date: "desc" },
      }),
    ]),
  );
  timer.log("invoice-detail-batch1");
  if (!invoice) notFound();

  const linkedIncome = {
    count: incomeEntries.length,
    total: incomeEntries.reduce((sum, e) => sum + e.amount, 0),
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Invoices", href: "/admin/business/invoices" },
          { label: invoice.number },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{invoice.number}</span>
            <InvoiceStatusBadge invoice={invoice} />
          </span>
        }
        actions={
          <InvoiceActions
            driveWebUrl={invoice.driveWebUrl}
            invoiceId={invoice.id}
            invoiceNumber={invoice.number}
            clientName={invoice.clientName}
            clientEmail={invoice.clientEmail}
            status={invoice.status}
            total={invoice.total}
            notes={invoice.notes}
            sentAt={invoice.sentAt?.toISOString() ?? null}
            paidAt={invoice.paidAt?.toISOString() ?? null}
            linkedIncome={linkedIncome}
            autoOpenSend={send === "1"}
          />
        }
      />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
        {/* Left: A4 preview - mirrors the trimmed PDF layout (one of three
            hand-synced renderers; keep the markup in step with the PDF). */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 print:border-0 print:shadow-none">
          {/* Header row: wordmark (left), INVOICE block (right). */}
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
              <p className="mt-2 font-mono text-sm font-semibold text-slate-700">
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
                <span className="font-bold text-slate-800">
                  {formatDateShort(invoice.issueDate)}
                </span>
              </p>
              <p className="flex justify-between gap-4">
                <span className="text-slate-500">Due:</span>
                <span className="font-bold text-slate-800">{formatDateShort(invoice.dueDate)}</span>
              </p>
            </div>
          </div>

          {/* Clean table (matches PDF): Description 67%, Qty 9%, Price 11%, Total 13%. */}
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
                <span className="whitespace-nowrap">
                  -{formatNZD(invoice.unsuccessfulDiscount)}
                </span>
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
          <div className="mt-8 border-t border-slate-200 pt-3 text-center text-xs wrap-break-word text-slate-500">
            {identity.email} &nbsp;·&nbsp; {identity.phone} &nbsp;·&nbsp; {identity.website}
            &nbsp;·&nbsp; {identity.location}
          </div>
        </div>

        {/* Right: context rail - streams in via Suspense from batch 2. */}
        <div className="mt-6 lg:mt-0 print:hidden">
          <Suspense fallback={<RailSkeleton />}>
            <InvoiceRail invoice={invoice} incomeEntries={incomeEntries} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
