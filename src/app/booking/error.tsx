// src/app/booking/error.tsx
/**
 * @description Booking-segment error boundary. Reassures the customer their
 * booking wasn't lost and offers a retry.
 */

"use client";

import { ErrorPageShell } from "@/shared/components/ErrorPageShell";
import type React from "react";
import { FaCalendarDays } from "react-icons/fa6";

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
  return (
    <ErrorPageShell
      title="Something went wrong with the booking page"
      body={
        <>
          Nothing has been booked yet, so you haven&apos;t lost anything. Give it another go, or get
          in touch and I&apos;ll sort it out.
        </>
      }
      error={error}
      onReset={reset}
      secondary={{
        href: "/contact",
        label: "Contact me",
        icon: <FaCalendarDays className="h-5 w-5" aria-hidden />,
      }}
      // Log the raw error rather than showing it to the customer - client-render
      // exceptions carry library internals/URLs that aren't redacted.
      logPrefix="[booking] error boundary:"
    />
  );
}
