// src/app/booking/success/page.tsx
/**
 * @description Booking request success page.
 */

import {
  buildAppointmentDescription,
  combineUnitAndAddress,
  parseBookingNotes,
} from "@/features/booking/lib/booking";
import { googleCalendarUrl } from "@/features/booking/lib/ics";
import { cancellationCopy } from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { Button } from "@/shared/components/Button";
import { CARD } from "@/shared/components/PageLayout";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeLong } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import type React from "react";
import {
  FaCalendarPlus,
  FaCircleCheck,
  FaDownload,
  FaHouse,
  FaPenToSquare,
  FaTag,
} from "react-icons/fa6";
import { BookingConversion } from "./BookingConversion";

// Post-booking confirmation, only reachable after submitting the form: keep
// it out of search results.
export const metadata: Metadata = {
  title: "Booking request received",
  robots: { index: false, follow: false },
};

/**
 * Renders the `**…**` emphasis convention from pricing-policy.ts copy
 * generators as `<strong>` spans, so customer-facing copy bolds the same
 * figures + policy boundaries the pricing page does.
 * @param text - Copy string containing zero or more `**…**` segments.
 * @returns Array of React nodes ready to drop into a parent block element.
 */
function renderEmphasised(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    return m ? <strong key={i}>{m[1]}</strong> : <span key={i}>{part}</span>;
  });
}

/**
 * Human-readable appointment length, derived from the booked window rather than
 * the optional `duration` enum so legacy rows (which never set it) still read
 * correctly.
 * @param startAt - Appointment start.
 * @param endAt - Appointment end.
 * @returns Length such as "45 minutes", "1 hour", "1 hour 30 minutes".
 */
function formatLength(startAt: Date, endAt: Date): string {
  const mins = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  const hourPart = hours === 1 ? "1 hour" : hours > 1 ? `${hours} hours` : "";
  const minPart = rest === 1 ? "1 minute" : rest > 1 ? `${rest} minutes` : "";
  return [hourPart, minPart].filter(Boolean).join(" ") || "Less than a minute";
}

/**
 * One label/value row in the appointment details card.
 * @param props - Component props.
 * @param props.label - Row label.
 * @param props.children - Row value.
 * @returns A details row.
 */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 font-semibold text-russian-violet sm:w-36">{label}</dt>
      <dd className="text-rich-black/80">{children}</dd>
    </div>
  );
}

/**
 * Booking success page component.
 * @param props - Page props.
 * @param props.searchParams - URL search params.
 * @returns The success page element.
 */
export default async function BookingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const tokenValue = params.cancelToken;
  const cancelToken = Array.isArray(tokenValue) ? tokenValue[0] : tokenValue;

  // Restate the appointment itself (the details card below) plus the
  // snapshotted promo title, so customers see the rate is locked even if the
  // offer expires before service. Degrades to the generic page without a token.
  const booking = cancelToken
    ? await prisma.booking
        .findFirst({
          where: { cancelToken },
          select: {
            promoTitleAtBooking: true,
            startAt: true,
            endAt: true,
            address: true,
            unit: true,
            meetingType: true,
            notes: true,
            status: true,
          },
        })
        .catch(() => null)
    : null;
  const promoTitle = booking?.promoTitleAtBooking ?? null;
  // Only restate an appointment that is still live - revisiting this URL after
  // cancelling must not present the old slot as if it were still booked.
  const appointment = booking && booking.status !== "cancelled" ? booking : null;
  const [{ CANCELLATION }, identity] = await Promise.all([getPolicy(), getIdentity()]);

  // Add-to-calendar targets. Google Calendar already invites the customer's
  // email address; these cover everyone whose calendar isn't that address.
  // Rejoined in the stored NZ form ("12/160 Kepa Road"); a comma between unit
  // and street reads as a different address to a map lookup.
  const calendarLocation =
    appointment && appointment.meetingType !== "remote"
      ? combineUnitAndAddress(appointment.unit ?? "", appointment.address ?? "")
      : "";
  const googleUrl =
    appointment && cancelToken
      ? googleCalendarUrl({
          start: appointment.startAt,
          end: appointment.endAt,
          summary: `${identity.company} appointment`,
          location: calendarLocation || undefined,
          // Same blurb the .ics carries, so both calendar paths read alike.
          description: buildAppointmentDescription({
            company: identity.company,
            phone: identity.phone,
            email: identity.email,
            isRemote: appointment.meetingType === "remote",
            userNotes: parseBookingNotes(appointment.notes).userNotes,
            manageUrl: `${getSiteUrl()}/booking/edit?token=${encodeURIComponent(cancelToken)}`,
            cancelUrl: `${getSiteUrl()}/booking/cancel?token=${encodeURIComponent(cancelToken)}`,
          }),
        })
      : null;

  return (
    <main id="main" className="relative min-h-dvh overflow-hidden">
      <BookingConversion />
      {/* Backdrop. Fixed, not absolute: an absolute layer stretches to the full
          page height, so once the content scrolls past one viewport the image
          gets scaled over that taller box instead of staying put. */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <picture>
          <source type="image/avif" srcSet="/source/backdrop-blur.avif" />
          <img
            src="/source/backdrop-blur.webp"
            alt=""
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full scale-110 transform-gpu object-cover"
          />
        </picture>
      </div>

      {/* Frosted container */}
      <div className="mx-auto my-5 w-full max-w-[min(100vw-2rem,56rem)] sm:my-10">
        <div className="rounded-2xl border border-seasalt-400/40 bg-seasalt-800/60 p-5 shadow-lg backdrop-blur-xl sm:p-10">
          <div className="flex flex-col gap-4 sm:gap-5">
            <section className={cn(CARD, "text-center")}>
              <div className="mb-4 flex justify-center">
                <FaCircleCheck className="h-16 w-16 text-moonstone-600" aria-hidden />
              </div>

              <h1 className="mb-3 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
                Booking confirmed!
              </h1>

              <p className="mb-6 text-base text-rich-black/80 sm:text-lg">
                Your appointment is confirmed. Check your email for the details and a Google
                Calendar invite - if you don't see it within a few minutes, check your spam folder.
              </p>

              <div className="flex flex-wrap justify-center gap-3">
                <Button href="/" variant="secondary" size="sm">
                  <FaHouse className="h-4 w-4" aria-hidden />
                  Back to home
                </Button>
                {cancelToken && (
                  <Button
                    href={`/booking/edit?token=${encodeURIComponent(cancelToken)}`}
                    variant="ghost"
                    size="sm"
                  >
                    <FaPenToSquare className="h-4 w-4" aria-hidden />
                    Edit booking
                  </Button>
                )}
                {cancelToken && (
                  <Button
                    href={`/booking/cancel?token=${encodeURIComponent(cancelToken)}`}
                    variant="ghost"
                    size="sm"
                  >
                    Cancel booking
                  </Button>
                )}
              </div>
            </section>

            {appointment && (
              <section className={cn(CARD)}>
                <h2 className="mb-3 text-lg font-bold text-russian-violet sm:text-xl">
                  Your appointment
                </h2>
                <dl className="space-y-2 text-base text-rich-black/80 sm:text-lg">
                  <DetailRow label="When">{formatDateTimeLong(appointment.startAt)}</DetailRow>
                  <DetailRow label="Length">
                    {formatLength(appointment.startAt, appointment.endAt)}
                  </DetailRow>
                  {appointment.meetingType && (
                    <DetailRow label="Type">
                      {appointment.meetingType === "in_person" ? "In person" : "Remote (online)"}
                    </DetailRow>
                  )}
                  {/* Remote jobs have no address; older rows may carry one without
                      a meetingType, so show it whenever it exists and isn't remote. */}
                  {appointment.address && appointment.meetingType !== "remote" && (
                    <DetailRow label="Where">
                      {combineUnitAndAddress(appointment.unit ?? "", appointment.address ?? "")}
                    </DetailRow>
                  )}
                </dl>

                <div className="mt-4 flex flex-wrap gap-3 border-t border-seasalt-400/60 pt-4">
                  {googleUrl && (
                    <Button
                      href={googleUrl}
                      variant="secondary"
                      size="sm"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FaCalendarPlus className="h-4 w-4" aria-hidden />
                      Add to Google Calendar
                    </Button>
                  )}
                  {cancelToken && (
                    <Button
                      href={`/api/booking/ics?token=${encodeURIComponent(cancelToken)}`}
                      download="appointment.ics"
                      variant="ghost"
                      size="sm"
                    >
                      <FaDownload className="h-4 w-4" aria-hidden />
                      Download calendar file
                    </Button>
                  )}
                </div>
              </section>
            )}

            <section className={cn(CARD)}>
              <h2 className="mb-2 text-lg font-bold text-russian-violet sm:text-xl">
                What happens next?
              </h2>
              <ol className="list-inside list-decimal space-y-1 text-base text-rich-black/80 sm:text-lg">
                <li>A confirmation email has been sent to you with the appointment details</li>
                <li>
                  A Google Calendar invite has been sent - accept it to add it to your calendar
                </li>
                <li>
                  To cancel or reschedule, use the link in the confirmation email or reply to it
                </li>
                <li>I'll send you a review link after your appointment</li>
              </ol>
            </section>

            {promoTitle && (
              <section className="flex items-start gap-3 rounded-xl border border-mustard-400 bg-mustard-900 p-5 shadow-sm sm:p-6">
                <FaTag className="mt-1 h-5 w-5 shrink-0 text-russian-violet" aria-hidden />
                <div>
                  <h2 className="mb-1 text-base font-bold text-russian-violet sm:text-lg">
                    Rate locked in: {promoTitle}
                  </h2>
                  <p className="text-base text-rich-black/80 sm:text-lg">
                    This rate applies to your appointment even if the offer ends before your visit.
                  </p>
                </div>
              </section>
            )}

            <section className={cn(CARD)}>
              <h2 className="mb-2 text-lg font-bold text-russian-violet sm:text-xl">
                Cancellation policy
              </h2>
              <p className="text-base text-rich-black/80 sm:text-lg">
                {renderEmphasised(cancellationCopy(CANCELLATION))}
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
