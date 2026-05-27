// src/app/booking/success/page.tsx
/**
 * @file page.tsx
 * @description Booking request success page.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/components/Button";
import { FaCircleCheck, FaHouse, FaPenToSquare, FaTag } from "react-icons/fa6";
import { cancellationCopy } from "@/features/business/lib/pricing-policy";
import { prisma } from "@/shared/lib/prisma";

const CARD = "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6";

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

  // Surface the snapshotted promo title so customers see the rate is locked
  // even if the offer expires before service.
  const booking = cancelToken
    ? await prisma.booking
        .findFirst({
          where: { cancelToken },
          select: { promoTitleAtBooking: true },
        })
        .catch(() => null)
    : null;
  const promoTitle = booking?.promoTitleAtBooking ?? null;

  return (
    <main className={cn("relative min-h-dvh overflow-hidden")}>
      {/* Backdrop */}
      <div className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden")}>
        <picture>
          <source type="image/avif" srcSet="/source/backdrop-blur.avif" />
          <img
            src="/source/backdrop-blur.webp"
            alt=""
            fetchPriority="high"
            decoding="async"
            className={cn("absolute inset-0 h-full w-full scale-110 transform-gpu object-cover")}
          />
        </picture>
      </div>

      {/* Frosted container */}
      <div className={cn("mx-auto my-5 w-full max-w-[min(100vw-2rem,56rem)] sm:my-10")}>
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-5 shadow-lg backdrop-blur-xl sm:p-10",
          )}
        >
          <div className={cn("flex flex-col gap-4 sm:gap-5")}>
            <section className={cn(CARD, "text-center")}>
              <div className={cn("mb-4 flex justify-center")}>
                <FaCircleCheck className={cn("text-moonstone-600 h-16 w-16")} aria-hidden />
              </div>

              <h1
                className={cn(
                  "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
                )}
              >
                Booking confirmed!
              </h1>

              <p className={cn("text-rich-black/80 mb-6 text-sm sm:text-base")}>
                Your appointment is confirmed. Check your email for the details and a Google
                Calendar invite - if you don't see it within a few minutes, check your spam folder.
              </p>

              <div className={cn("flex flex-wrap justify-center gap-3")}>
                <Button href="/" variant="secondary" size="sm">
                  <FaHouse className={cn("h-4 w-4")} aria-hidden />
                  Back to home
                </Button>
                {cancelToken && (
                  <Button
                    href={`/booking/edit?token=${encodeURIComponent(cancelToken)}`}
                    variant="ghost"
                    size="sm"
                  >
                    <FaPenToSquare className={cn("h-4 w-4")} aria-hidden />
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

            <section className={cn(CARD)}>
              <h2 className={cn("text-russian-violet mb-2 text-lg font-bold sm:text-xl")}>
                What happens next?
              </h2>
              <ol
                className={cn(
                  "text-rich-black/80 list-inside list-decimal space-y-1 text-sm sm:text-base",
                )}
              >
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
              <section
                className={cn(
                  "border-mustard-400 bg-mustard-900 flex items-start gap-3 rounded-xl border p-5 shadow-sm sm:p-6",
                )}
              >
                <FaTag className={cn("text-russian-violet mt-1 h-5 w-5 shrink-0")} aria-hidden />
                <div>
                  <h2 className={cn("text-russian-violet mb-1 text-base font-bold sm:text-lg")}>
                    Rate locked in: {promoTitle}
                  </h2>
                  <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
                    This rate applies to your appointment even if the offer ends before your visit.
                  </p>
                </div>
              </section>
            )}

            <section className={cn(CARD)}>
              <h2 className={cn("text-russian-violet mb-2 text-lg font-bold sm:text-xl")}>
                Cancellation policy
              </h2>
              <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
                {renderEmphasised(cancellationCopy())}
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
