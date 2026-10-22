// src/app/admin/(shell)/bookings/[id]/page.tsx
// Booking detail page: editable cards and price snapshot left, context rail right. Loads
// the booking, then linked records and settings in parallel (Server-Timing instrumented).

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { ADMIN_LINK_CLS, ADMIN_META_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import { InfoRow } from "@/features/admin/components/ui/InfoRow";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { StickyRail } from "@/features/admin/components/ui/StickyRail";
import { BookingActions } from "@/features/booking/components/admin/BookingActions";
import { BookingInfoCard } from "@/features/booking/components/admin/BookingInfoCard";
import { BookingTimeline } from "@/features/booking/components/admin/BookingTimeline";
import { BookingTimesCard } from "@/features/booking/components/admin/BookingTimesCard";
import { meetingTypeFromNotes } from "@/features/booking/lib/booking";
import { formatMins, formatNZD } from "@/features/business/lib/business";
import { formatQuotedRange } from "@/features/business/lib/estimate-range";
import { Notice } from "@/shared/components/Notice";
import { requireAdminAuth } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import { formatDateShort, formatDateTimeShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { ServerTimer } from "@/shared/lib/server-timing";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Booking - Admin",
  robots: { index: false, follow: false },
};

/** StatusPill tone for each booking status. */
const STATUS_TONE: Record<string, StatusTone> = {
  confirmed: "info",
  held: "warning",
  completed: "success",
  cancelled: "critical",
};

const MEETING_LABEL: Record<string, string> = { in_person: "In-person", remote: "Remote" };
const DURATION_LABEL: Record<string, string> = { short: "Short job", long: "Long job" };

/**
 * Small chip used in the page header for meeting type / duration.
 * @param props - Component props.
 * @param props.children - Chip label.
 * @returns The chip element.
 */
function Chip({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="rounded-full border border-admin-border bg-admin-surface px-2.5 py-0.5 text-sm font-semibold text-admin-text-secondary">
      {children}
    </span>
  );
}

/**
 * A label-over-value fact in the price snapshot grid, laid out like the Customer and Times cards.
 * @param props - Component props.
 * @param props.label - Fact label.
 * @param props.children - Fact value.
 * @returns The fact element.
 */
function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={ADMIN_META_LABEL_CLS}>{label}</dt>
      <dd className="text-sm text-admin-text">{children}</dd>
    </div>
  );
}

/**
 * Detail page for a single booking.
 * @param props - Page props.
 * @param props.params - Route params containing the booking id.
 * @returns Booking detail page element.
 */
export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  await requireAdminAuth();
  const timer = new ServerTimer();

  const booking = await timer.measure("batch1", () => prisma.booking.findUnique({ where: { id } }));
  if (!booking) notFound();

  // Batch 2: linked records in parallel. Contact matches primary or alt email, case-insensitive,
  // skipping soft-deleted rows (same rule as the booking>contact sync).
  const [contact, invoices, review, settings] = await timer.measure("batch2", () =>
    Promise.all([
      booking.email
        ? prisma.contact
            .findFirst({
              where: {
                OR: [
                  { email: { equals: booking.email, mode: "insensitive" } },
                  { altEmails: { has: booking.email.toLowerCase() } },
                ],
                deletedAt: null,
              },
              select: { id: true, name: true, email: true, phone: true },
            })
            .catch(() => null)
        : Promise.resolve(null),
      prisma.invoice
        .findMany({
          where: { bookingId: id },
          select: { id: true, number: true, status: true, total: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        })
        .catch(() => []),
      prisma.review
        .findFirst({
          where: { bookingId: id },
          select: { id: true, status: true, verified: true, createdAt: true },
        })
        .catch(() => null),
      // Only for the times card's and actions' lock, which mirror the PATCH route's gate.
      getSettings(),
    ]),
  );
  timer.log("booking-detail");

  const isTest = booking.name.toLowerCase().includes("test");
  const tone = STATUS_TONE[booking.status] ?? "neutral";
  // Older bookings state the meeting type only in the notes text.
  const meetingType = booking.meetingType ?? meetingTypeFromNotes(booking.notes);
  // A voided invoice leaves the job unbilled, so Bill comes back.
  const liveInvoice = invoices.find((inv) => inv.status !== "VOIDED") ?? null;

  // Which price-snapshot fields exist decides whether to show the card.
  const hasPriceSnapshot =
    booking.quotedLowAtBooking != null ||
    booking.quotedDescriptionAtBooking != null ||
    booking.baseRateAtBooking != null ||
    booking.travelMinsAtBooking != null ||
    booking.promoTitleAtBooking != null ||
    booking.publicHolidayName != null;

  // percentDiscount is a fraction (0.15 = 15%). Only rate promos are snapshotted, so
  // others show their title alone.
  const promoSummary = booking.promoTitleAtBooking
    ? [
        booking.promoTitleAtBooking,
        booking.promoFlatHourlyRateAtBooking != null
          ? `${formatNZD(booking.promoFlatHourlyRateAtBooking)}/hr flat`
          : booking.promoPercentDiscountAtBooking != null
            ? `${Math.round(booking.promoPercentDiscountAtBooking * 100)}% off`
            : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Bookings", href: "/admin/bookings" }, { label: booking.name }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>{booking.name}</span>
            <StatusPill tone={tone}>{booking.status}</StatusPill>
            {meetingType && <Chip>{MEETING_LABEL[meetingType]}</Chip>}
            {booking.duration && <Chip>{DURATION_LABEL[booking.duration]}</Chip>}
          </span>
        }
        description={`${formatDateTimeShort(booking.startAt)} - ${formatDateTimeShort(booking.endAt)}`}
      />

      {/* No calendar event behind this row, so both email crons are holding off. */}
      {booking.calendarEventMissingAt && booking.status !== "cancelled" && (
        <Notice tone="warn" onGrey className="mb-4 text-[0.9375rem] text-admin-text">
          <p className="font-semibold text-coquelicot-700">This booking has no calendar event.</p>
          <p className="mt-1">
            The event was deleted in Google Calendar on{" "}
            {formatDateTimeShort(booking.calendarEventMissingAt)}, but the booking is still{" "}
            {booking.status}. Reminder emails are paused until it&apos;s sorted - cancel the booking
            if the job isn&apos;t happening, or re-book it if it is.
          </p>
        </Notice>
      )}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        {/* Left: editable customer info + price snapshot. */}
        <div className="space-y-4">
          <Card>
            <BookingInfoCard
              id={booking.id}
              name={booking.name}
              email={booking.email}
              phone={booking.phone}
              address={booking.address}
              notes={booking.notes}
              accessNotes={booking.accessNotes}
            />
          </Card>

          <Card>
            <BookingTimesCard
              id={booking.id}
              startAt={booking.startAt.toISOString()}
              endAt={booking.endAt.toISOString()}
              status={booking.status}
              lockHours={settings.scheduling.pastEditLockHours}
            />
          </Card>

          {hasPriceSnapshot && (
            <Card>
              <CardHeader
                title="Price snapshot"
                description="What the customer saw / the rates locked in at booking."
              />
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {booking.quotedLowAtBooking != null && booking.quotedHighAtBooking != null && (
                  <Fact label="Quoted">
                    {formatQuotedRange(
                      booking.quotedLowAtBooking,
                      booking.quotedHighAtBooking,
                      booking.quotedTravelAtBooking,
                    )}
                  </Fact>
                )}
                {promoSummary && <Fact label="Promo">{promoSummary}</Fact>}
                {booking.baseRateAtBooking != null && (
                  <Fact label="Base rate">{formatNZD(booking.baseRateAtBooking)}/hr</Fact>
                )}
                {booking.complexRateAtBooking != null && (
                  <Fact label="Complex rate">{formatNZD(booking.complexRateAtBooking)}/hr</Fact>
                )}
                {booking.travelRatePerHourAtBooking != null && (
                  <Fact label="Travel rate">
                    {formatNZD(booking.travelRatePerHourAtBooking)}/hr
                  </Fact>
                )}
                {booking.travelMinsAtBooking != null && (
                  <Fact label="Travel time">
                    {formatMins(booking.travelMinsAtBooking)} there
                    {booking.travelMinsBackAtBooking != null
                      ? ` · ${formatMins(booking.travelMinsBackAtBooking)} back`
                      : ""}
                  </Fact>
                )}
                {booking.publicHolidayName && (
                  <Fact label="Public holiday">{booking.publicHolidayName}</Fact>
                )}
              </dl>
              {(booking.quotedDescriptionAtBooking || booking.quotedMinsAtBooking != null) && (
                <div className="mt-4 grid gap-x-6 gap-y-3 border-t border-admin-border pt-4 text-sm lg:grid-cols-2">
                  {booking.quotedDescriptionAtBooking && (
                    <div>
                      <span className="text-admin-muted">They asked</span>
                      <p className="mt-1 whitespace-pre-wrap text-admin-text italic">
                        &ldquo;{booking.quotedDescriptionAtBooking}&rdquo;
                      </p>
                    </div>
                  )}
                  {booking.quotedMinsAtBooking != null && (
                    <div>
                      <span className="text-admin-muted">AI read it as</span>
                      <p className="mt-1 text-admin-text">
                        {formatMins(booking.quotedMinsAtBooking)}
                        {booking.quotedCategoryAtBooking
                          ? ` · ${booking.quotedCategoryAtBooking}`
                          : ""}
                      </p>
                      {booking.quotedTasksAtBooking.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {booking.quotedTasksAtBooking.map((task, i) => (
                            <span
                              key={`quoted-task-${i}`}
                              className="rounded-md bg-admin-bg px-2 py-0.5 text-sm text-admin-muted"
                            >
                              {task.label}: {formatMins(task.mins)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Right: context rail - actions, timeline, linked records. */}
        <StickyRail className="mt-4 space-y-4 lg:mt-0">
          <BookingActions
            id={booking.id}
            status={booking.status}
            startAt={booking.startAt.toISOString()}
            endAt={booking.endAt.toISOString()}
            lockHours={settings.scheduling.pastEditLockHours}
            calendarEventId={booking.calendarEventId}
            phone={booking.phone || null}
            address={meetingType === "remote" ? null : booking.address || null}
            invoiceId={liveInvoice?.id ?? null}
            cancelToken={booking.cancelToken}
            reviewAlreadySent={booking.reviewSentAt != null}
            isTest={isTest}
          />

          <Card>
            <CardHeader title="Timeline" />
            <BookingTimeline
              status={booking.status}
              createdAt={booking.createdAt}
              emailReminderSentAt={booking.emailReminderSentAt}
              reviewSentAt={booking.reviewSentAt}
              reviewSubmittedAt={booking.reviewSubmittedAt}
              cancelledAt={booking.cancelledAt}
              cancelledBy={booking.cancelledBy}
              lateCancellation={booking.lateCancellation}
              travelChargeApplies={booking.travelChargeApplies}
              noShow={booking.noShow}
            />
          </Card>

          <Card>
            <CardHeader title="Linked records" />
            <dl className="space-y-2 text-sm">
              <InfoRow label="Contact">
                {contact ? (
                  <Link href={`/admin/contacts/${contact.id}`} className={ADMIN_LINK_CLS}>
                    {contact.name}
                  </Link>
                ) : (
                  <span className="text-admin-faint">Not linked</span>
                )}
              </InfoRow>
              {invoices.length > 0 ? (
                <div>
                  <span className="text-admin-muted">Invoices</span>
                  <ul className="mt-1 space-y-1">
                    {invoices.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between gap-2">
                        <Link
                          href={`/admin/business/invoices/${inv.id}`}
                          className={cn("font-mono", ADMIN_LINK_CLS)}
                        >
                          {inv.number}
                        </Link>
                        <span className="flex items-center gap-2">
                          <span className="text-admin-text-secondary">{formatNZD(inv.total)}</span>
                          <span className="text-sm text-admin-muted">{inv.status}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <InfoRow label="Invoices">
                  <span className="text-admin-faint">None</span>
                </InfoRow>
              )}
              <InfoRow label="Review">
                {review ? (
                  <Link href="/admin/reviews" className={ADMIN_LINK_CLS}>
                    {review.status}
                    {review.verified ? " · verified" : ""}
                    <span className="block text-sm font-normal text-admin-muted">
                      {formatDateShort(review.createdAt)}
                    </span>
                  </Link>
                ) : (
                  <span className="text-admin-faint">None</span>
                )}
              </InfoRow>
              <InfoRow label="Calendar">
                {booking.calendarEventId ? (
                  "Linked"
                ) : (
                  <span className="text-admin-faint">None</span>
                )}
              </InfoRow>
            </dl>
          </Card>
        </StickyRail>
      </div>
    </div>
  );
}
