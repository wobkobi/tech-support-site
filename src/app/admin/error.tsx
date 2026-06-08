// src/app/admin/error.tsx
/**
 * @file error.tsx
 * @description Admin-segment error boundary. Operator-facing, so it keeps the
 * technical details block for debugging.
 */

"use client";

import type React from "react";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import { FaArrowRotateRight, FaGauge } from "react-icons/fa6";

/**
 * Error boundary UI for the admin segment.
 * @param props - Component props.
 * @param props.error - Thrown error instance.
 * @param props.reset - Callback to re-render the segment.
 * @returns The error page element.
 */
export default function AdminError({
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
            <div className={cn("text-coquelicot-500 mb-4 text-7xl font-extrabold sm:text-8xl")}>
              Oops!
            </div>

            <h1
              className={cn(
                "text-russian-violet mb-4 text-3xl font-extrabold sm:text-4xl md:text-5xl",
              )}
            >
              An admin page hit an error
            </h1>

            <p className={cn("text-rich-black mb-6 text-base sm:text-lg md:text-xl")}>
              Retry the action below. If it keeps failing, check the technical details and the
              server logs.
            </p>

            <p
              className={cn("text-rich-black/70 wrap-break-word mb-6 text-sm italic sm:text-base")}
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
              <Button href="/admin" variant="ghost">
                <FaGauge className={cn("h-5 w-5")} aria-hidden />
                Back to dashboard
              </Button>
            </div>

            <details className={cn("text-rich-black/80 mt-6 text-base")}>
              <summary className={cn("hover:text-russian-violet cursor-pointer font-semibold")}>
                Technical details
              </summary>
              <pre
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-900/60 mt-3 max-w-full overflow-auto rounded-lg border p-4 text-left text-base",
                )}
              >
                {String(error?.stack || error)}
              </pre>
            </details>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
