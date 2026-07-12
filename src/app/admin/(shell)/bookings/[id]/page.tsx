// src/app/admin/(shell)/bookings/[id]/page.tsx
/**
 * @description Detail page for a single booking - the Booking model is the app's
 * richest row (price/promo/rate snapshots, travel mins, cancellation metadata,
 * reminder/review stamps) and this surfaces it. Two-column on lg+: the editable
 * customer card + price snapshot on the left, a context rail (actions, timeline,
 * linked records) on the right. Batch 1 loads the booking; batch 2 runs the
 * linked-record lookups (contact / invoices / review) in parallel. Both are
 * Server-Timing instrumented.
 */
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { BookingActions } from "@/features/booking/components/admin/BookingActions";
import { BookingInfoCard } from "@/features/booking/components/admin/BookingInfoCard";
import { BookingTimeline } from "@/features/booking/components/admin/BookingTimeline";
import { formatNZD } from "@/features/business/lib/business";
import { requireAdminAuth } from "@/shared/lib/auth";
import { formatDateShort, formatDateTimeShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { ServerTimer } from "@/shared/lib/server-timing";
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
 * Small chip used in the page header for meeting type / duration.
 * @param props - Component props.
 * @param props.children - Chip label.
 * @returns The chip element.
 */
function Chip({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="rounded-full bg-admin-bg px-2.5 py-0.5 text-xs font-medium text-admin-text-secondary">
      {children}
    </span>
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

  // Batch 2: linked records, all keyed on the booking so they run in parallel.
  // Contact matches the primary or any alt email (case-insensitive), skipping
  // soft-deleted rows - the same rule the booking>contact sync uses.
  const [contact, invoices, review] = await timer.measure("batch2", () =>
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
    ]),
  );
  timer.log("booking-detail");

  const isTest = booking.name.toLowerCase().includes("test");
  const tone = STATUS_TONE[booking.status] ?? "neutral";

  // Which price-snapshot fields exist decides whether to show the card.
  const hasPriceSnapshot =
    booking.quotedLowAtBooking != null ||
    booking.baseRateAtBooking != null ||
    booking.travelMinsAtBooking != null ||
    booking.promoTitleAtBooking != null ||
    booking.publicHolidayName != null;

  const promoSummary = booking.promoTitleAtBooking
    ? [
        booking.promoTitleAtBooking,
        booking.promoFlatHourlyRateAtBooking != null
          ? `${formatNZD(booking.promoFlatHourlyRateAtBooking)}/hr flat`
          : booking.promoPercentDiscountAtBooking != null
            ? `${booking.promoPercentDiscountAtBooking}% off`
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
            {booking.meetingType && <Chip>{MEETING_LABEL[booking.meetingType]}</Chip>}
            {booking.duration && <Chip>{DURATION_LABEL[booking.duration]}</Chip>}
          </span>
        }
        description={`${formatDateTimeShort(booking.startAt)} - ${formatDateTimeShort(booking.endAt)}`}
      />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        {/* Left: editable customer info + price snapshot. */}
        <div className="space-y-4">
          <Card>
            <BookingInfoCard
              id={booking.id}
              name={booking.name}
              email={booking.email}
              phone={booking.phone}
              notes={booking.notes}
            />
          </Card>

          {hasPriceSnapshot && (
            <Card>
              <CardHeader
                title="Price snapshot"
                description="What the customer saw / the rates locked in at booking."
              />
              <dl className="space-y-1.5 text-sm">
                {booking.quotedLowAtBooking != null && booking.quotedHighAtBooking != null && (
                  <InfoRow label="Quoted">
                    {formatNZD(booking.quotedLowAtBooking)} -{" "}
                    {formatNZD(booking.quotedHighAtBooking)}
                  </InfoRow>
                )}
                {promoSummary && <InfoRow label="Promo">{promoSummary}</InfoRow>}
                {booking.baseRateAtBooking != null && (
                  <InfoRow label="Base rate">{formatNZD(booking.baseRateAtBooking)}/hr</InfoRow>
                )}
                {booking.complexRateAtBooking != null && (
                  <InfoRow label="Complex rate">
                    {formatNZD(booking.complexRateAtBooking)}/hr
                  </InfoRow>
                )}
                {booking.travelRatePerHourAtBooking != null && (
                  <InfoRow label="Travel rate">
                    {formatNZD(booking.travelRatePerHourAtBooking)}/hr
                  </InfoRow>
                )}
                {booking.travelMinsAtBooking != null && (
                  <InfoRow label="Travel time">
                    {booking.travelMinsAtBooking} min there
                    {booking.travelMinsBackAtBooking != null
                      ? ` · ${booking.travelMinsBackAtBooking} min back`
                      : ""}
                  </InfoRow>
                )}
                {booking.publicHolidayName && (
                  <InfoRow label="Public holiday">{booking.publicHolidayName}</InfoRow>
                )}
              </dl>
            </Card>
          )}
        </div>

        {/* Right: context rail - actions, timeline, linked records. */}
        <div className="mt-4 space-y-4 lg:mt-0">
          <Card>
            <CardHeader title="Actions" />
            <BookingActions
              id={booking.id}
              status={booking.status}
              startAt={booking.startAt.toISOString()}
              cancelToken={booking.cancelToken}
              reviewAlreadySent={booking.reviewSentAt != null}
              isTest={isTest}
            />
          </Card>

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
                  <Link href="/admin/contacts" className="text-blue-500 hover:text-blue-700">
                    {contact.name}
                  </Link>
                ) : (
                  <span className="text-admin-faint">Not linked</span>
                )}
              </InfoRow>
              <div>
                <span className="text-admin-muted">Invoices</span>
                {invoices.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {invoices.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between gap-2">
                        <Link
                          href={`/admin/business/invoices/${inv.id}`}
                          className="font-mono text-blue-500 hover:text-blue-700"
                        >
                          {inv.number}
                        </Link>
                        <span className="flex items-center gap-2">
                          <span className="text-admin-text-secondary">{formatNZD(inv.total)}</span>
                          <span className="text-xs text-admin-muted">{inv.status}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="ml-2 text-admin-faint">None</span>
                )}
              </div>
              <InfoRow label="Review">
                {review ? (
                  <Link href="/admin/reviews" className="text-blue-500 hover:text-blue-700">
                    {review.status}
                    {review.verified ? " · verified" : ""}
                    <span className="block text-xs font-normal text-admin-muted">
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
        </div>
      </div>
    </div>
  );
}
