// src/app/error.tsx
/**
 * @file error.tsx
 * @description Themed error boundary. Matches site styling.
 */

"use client";

import type React from "react";
import { FrostedSection, PageShell, CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { FaArrowRotateRight, FaHouse } from "react-icons/fa6";

/**
 * Error boundary UI for the App Router.
 * @param props - Component props.
 * @param props.error - Thrown error instance.
 * @param props.reset - Callback to re-render the segment.
 * @returns The error page element.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  const msg = (error?.message || "").trim().slice(0, 300) || "An unexpected error occurred.";

  return (
    <PageShell>
      <FrostedSection maxWidth="48rem">
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
              The website has encountered an error
            </h1>

            <p className={cn("text-rich-black mb-2 text-base sm:text-lg md:text-xl")}>
              Looks like something went wrong. Have you tried turning it off and on again?
            </p>

            <p className={cn("text-rich-black/80 mb-4 text-base sm:text-lg")}>
              Just kidding. That's my job, not yours.
            </p>

            <p
              className={cn("text-rich-black/70 wrap-break-word mb-6 text-sm italic sm:text-base")}
              role="status"
              aria-live="polite"
            >
              {msg}
            </p>

            <div className={cn("flex flex-wrap items-center justify-center gap-3")}>
              <button
                type="button"
                onClick={reset}
                className={cn(
                  "bg-coquelicot-500 hover:bg-coquelicot-600 text-seasalt inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold shadow-lg transition-colors hover:shadow-xl",
                )}
              >
                <FaArrowRotateRight className={cn("h-5 w-5")} aria-hidden />
                Try again
              </button>

              <Link
                href="/"
                className={cn(
                  "border-seasalt-400/60 hover:bg-seasalt-900/40 text-rich-black inline-flex items-center gap-2 rounded-lg border px-6 py-3 font-semibold transition-colors",
                )}
              >
                <FaHouse className={cn("h-5 w-5")} aria-hidden />
                Go home
              </Link>
            </div>

            <details className={cn("text-rich-black/80 mt-6 text-sm")}>
              <summary className={cn("hover:text-russian-violet cursor-pointer font-semibold")}>
                Technical details (for the curious)
              </summary>
              <pre
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-900/60 mt-3 max-w-full overflow-auto rounded-lg border p-4 text-left text-xs",
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
