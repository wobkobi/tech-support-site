// src/app/review/error.tsx
/**
 * @file error.tsx
 * @description Review-segment error boundary. Offers a retry on the review form.
 */

"use client";

import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaArrowRotateRight, FaHouse } from "react-icons/fa6";

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
  const msg = (error?.message || "").trim().slice(0, 300) || "An unexpected error occurred.";

  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "text-center")}>
            <div className={cn("mb-4 text-7xl font-extrabold text-coquelicot-500 sm:text-8xl")}>
              Oops!
            </div>

            <h1
              className={cn(
                "mb-4 text-3xl font-extrabold text-russian-violet sm:text-4xl md:text-5xl",
              )}
            >
              Something went wrong with the review page
            </h1>

            <p className={cn("mb-6 text-base text-rich-black sm:text-lg md:text-xl")}>
              Your review wasn&apos;t submitted. Please try again - and thank you for taking the
              time to leave one.
            </p>

            <p
              className={cn("mb-6 text-sm wrap-break-word text-rich-black/70 italic sm:text-base")}
              role="status"
              aria-live="polite"
            >
              {msg}
            </p>

            <div className={cn("flex flex-wrap items-center justify-center gap-3")}>
              <Button type="button" onClick={reset} variant="primary">
                <FaArrowRotateRight className={cn("h-5 w-5")} aria-hidden />
                Try again
              </Button>
              <Button href="/" variant="ghost">
                <FaHouse className={cn("h-5 w-5")} aria-hidden />
                Go home
              </Button>
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
