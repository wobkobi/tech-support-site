// src/app/booking/error.tsx
/**
 * @file error.tsx
 * @description Booking-segment error boundary. Reassures the customer their
 * booking wasn't lost and offers a retry.
 */

"use client";

import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaArrowRotateRight, FaCalendarDays } from "react-icons/fa6";

/**
 * Error boundary UI for the booking segment.
 * @param props - Component props.
 * @param props.error - Thrown error instance.
 * @param props.reset - Callback to re-render the segment.
 * @returns The error page element.
 */
export default function BookingError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  const msg = (error?.message || "").trim().slice(0, 300) || "An unexpected error occurred.";

  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className="flex flex-col gap-6 sm:gap-8">
          <section className={cn(CARD, "text-center")}>
            <div className="mb-4 text-7xl font-extrabold text-coquelicot-500 sm:text-8xl">
              Oops!
            </div>

            <h1 className="mb-4 text-3xl font-extrabold text-russian-violet sm:text-4xl md:text-5xl">
              Something went wrong with the booking page
            </h1>

            <p className="mb-6 text-base text-rich-black sm:text-lg md:text-xl">
              Nothing has been booked yet, so you haven&apos;t lost anything. Give it another go, or
              get in touch and I&apos;ll sort it out.
            </p>

            <p
              className="mb-6 text-sm wrap-break-word text-rich-black/70 italic sm:text-base"
              role="status"
              aria-live="polite"
            >
              {msg}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button type="button" onClick={reset} variant="primary">
                <FaArrowRotateRight className="h-5 w-5" aria-hidden />
                Try again
              </Button>
              <Button href="/contact" variant="ghost">
                <FaCalendarDays className="h-5 w-5" aria-hidden />
                Contact me
              </Button>
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
