// src/app/admin/(shell)/contacts/[id]/page.tsx
/**
 * @description Customer-360 contact detail. Loads everything the contact touches
 * through the shared {@link loadContact360} matcher - bookings, invoices, income,
 * reviews - summarises it as StatCards, and merges the lot into one interaction
 * timeline. The right rail carries the contact fields and sync/review-link state.
 */
import { ContactDetailActions } from "@/features/admin/components/ContactDetailActions";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { formatNZD } from "@/features/business/lib/business";
import { loadContact360 } from "@/features/contacts/lib/contact-360";
import { requireAdminAuth } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact - Admin",
  robots: { index: false, follow: false },
};

type EventKind = "booking" | "invoice" | "payment" | "review";

/** One merged row in the interaction timeline. */
interface ContactEvent {
  kind: EventKind;
  timestamp: Date;
  title: string;
  detail: string;
  href?: string;
}

const KIND_BADGE: Record<EventKind, { letter: string; className: string }> = {
  booking: { letter: "B", className: "bg-moonstone-600/15 text-moonstone-600" },
  invoice: { letter: "I", className: "bg-russian-violet/15 text-russian-violet" },
  payment: { letter: "$", className: "bg-emerald-500/15 text-emerald-600" },
  review: { letter: "R", className: "bg-yellow-500/15 text-yellow-600" },
};

/**
 * A label/value row in the fields rail, mirroring the invoice detail layout.
 * @param props - Component props.
 * @param props.label - Row label.
 * @param props.children - Row value.
 * @returns Row element.
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
      <dt className="shrink-0 text-admin-muted">{label}</dt>
      <dd className="text-right font-medium text-admin-text">{children}</dd>
    </div>
  );
}

const NONE = <span className="text-admin-faint">None</span>;

/**
 * Customer-360 contact detail page.
 * @param props - Page props.
 * @param props.params - Route params carrying the contact id.
 * @returns Contact detail page element.
 */
export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const { id } = await params;

  const data = await loadContact360(id);
  if (!data) notFound();

  const { contact, bookings, invoices, income, reviews, totals } = data;

  // Merge every touch-point into one timeline, most recent first.
  const timeline: ContactEvent[] = [
    ...bookings.map((b) => ({
      kind: "booking" as const,
      timestamp: b.startAt,
      title: "Booking",
      detail: `${b.status} · ${formatDateShort(b.startAt.toISOString())}`,
      href: `/admin/bookings/${b.id}`,
    })),
    ...invoices.map((inv) => ({
      kind: "invoice" as const,
      timestamp: inv.issueDate,
      title: `Invoice ${inv.number}`,
      detail: `${inv.status} · ${formatNZD(inv.total)}`,
      href: `/admin/business/invoices/${inv.id}`,
    })),
    ...income.map((e) => ({
      kind: "payment" as const,
      timestamp: e.date,
      title: "Payment",
      detail: `${e.method} · ${formatNZD(e.amount)}`,
      href: e.invoiceId ? `/admin/business/invoices/${e.invoiceId}` : undefined,
    })),
    ...reviews.map((r) => ({
      kind: "review" as const,
      timestamp: r.createdAt,
      title: `Review (${r.status})`,
      detail: r.text.length > 70 ? `${r.text.slice(0, 70)}…` : r.text,
    })),
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Contacts", href: "/admin/contacts" }, { label: contact.name }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {contact.name}
            <StatusPill tone={contact.googleContactId ? "success" : "neutral"}>
              {contact.googleContactId ? "Synced" : "Not synced"}
            </StatusPill>
          </span>
        }
        actions={
          <ContactDetailActions
            id={contact.id}
            name={contact.name}
            email={contact.email}
            phone={contact.phone}
            address={contact.address}
            googleContactId={contact.googleContactId}
            retainerTier={contact.retainerTier}
            retainerPrice={contact.retainerPrice}
            retainerHours={contact.retainerHours}
            retainerSince={contact.retainerSince?.toISOString().slice(0, 10) ?? null}
            retainerNotes={contact.retainerNotes}
            siteNotes={contact.siteNotes}
          />
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Bookings" value={totals.bookings} />
        <StatCard label="Invoices" value={totals.invoices} />
        <StatCard label="Billed" value={formatNZD(totals.incomeTotal)} tone="success" />
        <StatCard label="Reviews" value={totals.reviews} />
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
        {/* Left: interaction timeline */}
        <Card padding="none">
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Timeline"
              description="Bookings, invoices, payments, and reviews, newest first."
            />
          </div>
          {timeline.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-admin-faint">
              Nothing linked to this contact yet.
            </p>
          ) : (
            <ul className="divide-y divide-admin-border">
              {timeline.map((e, i) => {
                const badge = KIND_BADGE[e.kind];
                const row = (
                  <span className="flex items-start gap-3 px-5 py-3">
                    <span
                      className={cn(
                        "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        badge.className,
                      )}
                      aria-hidden="true"
                    >
                      {badge.letter}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-admin-text">
                        {e.title}
                      </span>
                      <span className="block truncate text-xs text-admin-muted">{e.detail}</span>
                    </span>
                    <span className="shrink-0 text-xs text-admin-faint">
                      {formatDateShort(e.timestamp.toISOString())}
                    </span>
                  </span>
                );
                return (
                  <li key={`${e.kind}:${i}:${e.timestamp.getTime()}`}>
                    {e.href ? (
                      <a href={e.href} className="block transition-colors hover:bg-admin-bg">
                        {row}
                      </a>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Right rail: fields + status */}
        <div className="mt-6 flex flex-col gap-4 lg:mt-0">
          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-2 text-sm">
              <InfoRow label="Email">{contact.email || NONE}</InfoRow>
              {contact.altEmails.length > 0 && (
                <InfoRow label="Also">{contact.altEmails.join(", ")}</InfoRow>
              )}
              <InfoRow label="Phone">{contact.phone || NONE}</InfoRow>
              {contact.altPhones.length > 0 && (
                <InfoRow label="Also">{contact.altPhones.join(", ")}</InfoRow>
              )}
              <InfoRow label="Address">{contact.address || NONE}</InfoRow>
              <InfoRow label="Added">{formatDateShort(contact.createdAt.toISOString())}</InfoRow>
            </dl>
          </Card>

          {contact.siteNotes && (
            <Card>
              <CardHeader title="Site notes" description="Environment details from past visits." />
              <p className="text-sm font-medium whitespace-pre-wrap text-admin-text">
                {contact.siteNotes}
              </p>
            </Card>
          )}

          {contact.retainerTier && (
            <Card>
              <CardHeader title="Retainer" />
              <dl className="space-y-2 text-sm">
                <InfoRow label="Tier">
                  <StatusPill tone="violet">{contact.retainerTier}</StatusPill>
                </InfoRow>
                <InfoRow label="Monthly">
                  {contact.retainerPrice !== null ? formatNZD(contact.retainerPrice) : NONE}
                </InfoRow>
                <InfoRow label="Included hrs">
                  {contact.retainerHours !== null ? `${contact.retainerHours}h/month` : NONE}
                </InfoRow>
                <InfoRow label="Since">
                  {contact.retainerSince
                    ? formatDateShort(contact.retainerSince.toISOString())
                    : NONE}
                </InfoRow>
                {contact.retainerNotes && (
                  <div>
                    <dt className="text-admin-muted">Notes</dt>
                    <dd className="mt-1 font-medium whitespace-pre-wrap text-admin-text">
                      {contact.retainerNotes}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          )}

          <Card>
            <CardHeader title="Review link" />
            <dl className="space-y-2 text-sm">
              <InfoRow label="Sent">
                {contact.reviewLinkSentAt ? (
                  <>
                    {formatDateShort(contact.reviewLinkSentAt.toISOString())}
                    {contact.reviewLinkSentMode ? ` · ${contact.reviewLinkSentMode}` : ""}
                  </>
                ) : (
                  NONE
                )}
              </InfoRow>
              <InfoRow label="Reviewed">
                {contact.reviewLinkSubmittedAt ? (
                  <StatusPill tone="success">Yes</StatusPill>
                ) : (
                  <StatusPill tone="neutral">Not yet</StatusPill>
                )}
              </InfoRow>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
