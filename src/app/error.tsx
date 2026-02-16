// src/app/error.tsx
/**
 * @file error.tsx
 * @description Themed error boundary. Matches site styling.
 */

"use client";

import type React from "react";
import { FrostedSection, PageShell, CARD } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { FaArrowRotateRight, FaHouse } from "react-icons/fa6";

/**
 * Error boundary UI for the App Router.
 * @param root0 - Component props.
 * @param root0.error - Thrown error instance.
 * @param root0.reset - Callback to re-render the segment.
 * @returns Error page element.
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
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          <section className={cn(CARD)}>
            <h1
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Something went wrong
            </h1>

            <p
              className={cn("text-rich-black mb-4 text-sm sm:text-base")}
              role="status"
              aria-live="polite"
            >
              {msg}
            </p>

            <div className={cn("flex flex-wrap items-center gap-3")}>
              <button
                type="button"
                onClick={reset}
                className={cn(
                  "bg-russian-violet text-seasalt inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold",
                  "hover:brightness-110",
                )}
              >
                <FaArrowRotateRight className={cn("h-4 w-4")} aria-hidden />
                Try again
              </button>

              <Link
                href="/"
                className={cn(
                  "border-seasalt-400/60 text-rich-black hover:bg-seasalt-900/40 inline-flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold",
                )}
              >
                <FaHouse className={cn("h-4 w-4")} aria-hidden />
                Go home
              </Link>
            </div>

            <details className={cn("text-rich-black/80 mt-4 text-sm")}>
              <summary className={cn("cursor-pointer")}>Technical details</summary>
              <pre
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-900/60 mt-2 overflow-auto rounded-md border p-3 text-xs",
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
