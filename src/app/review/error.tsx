// src/app/review/error.tsx
/**
 * @description Review-segment error boundary. Offers a retry on the review form.
 */

"use client";

import { ErrorPageShell } from "@/shared/components/ErrorPageShell";
import type React from "react";
import { FaHouse } from "react-icons/fa6";

/**
 * Error boundary UI for the review segment.
 * @param props - Component props.
 * @param props.error - Thrown error instance.
 * @param props.reset - Callback to re-render the segment.
 * @returns The error page element.
 */
export default function ReviewError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  return (
    <ErrorPageShell
      title="Something went wrong with the review page"
      body={
        <>
          Your review wasn&apos;t submitted. Please try again - and thank you for taking the time to
          leave one.
        </>
      }
      error={error}
      onReset={reset}
      secondary={{
        href: "/",
        label: "Go home",
        icon: <FaHouse className="h-5 w-5" aria-hidden />,
      }}
      showMessage
    />
  );
}
