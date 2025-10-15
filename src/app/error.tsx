// src/app/error.tsx
/**
 * @file error.tsx
 * @description Themed error page. Matches site styling and offers retry/home actions.
 */
"use client";

import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { FaArrowRotateRight, FaHouse } from "react-icons/fa6";

/**
 * Error boundary UI for the App Router.
 * @param root0 Props
 * @param root0.error Thrown error instance
 * @param root0.reset Callback to re-render the segment
 * @returns Error page element
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
      <FrostedSection>
        <section className={cn("mx-auto w-full max-w-5xl")}>
          <h1
            className={cn(
              "text-rich-black mb-3 text-center text-2xl font-bold sm:mb-4 sm:text-3xl md:text-4xl",
            )}
          >
            Something went wrong
          </h1>

          <div
            className={cn(
              "border-seasalt-400/60 bg-seasalt-800 rounded-lg border p-4 shadow-sm sm:p-6",
            )}
          >
            <p
              className={cn("text-rich-black mb-3 text-base font-medium sm:mb-4 sm:text-lg")}
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
                  "bg-russian-violet text-seasalt-800 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold",
                  "hover:brightness-110 disabled:opacity-60",
                )}
              >
                <FaArrowRotateRight className={cn("h-4 w-4")} aria-hidden />
                Try again
              </button>

              <Link
                href="/"
                className={cn(
                  "text-russian-violet hover:text-coquelicot-500 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold",
                )}
              >
                <FaHouse className={cn("h-4 w-4")} aria-hidden />
                Go home
              </Link>
            </div>

            {/* Optional details for debugging; collapse by default */}
            <details className={cn("text-rich-black/80 mt-4 text-sm")}>
              <summary className={cn("cursor-pointer select-none")}>Technical details</summary>
              <pre
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-800 mt-2 overflow-auto rounded-md border p-3",
                )}
              >
                {String(error?.stack || error)}
              </pre>
            </details>
          </div>
        </section>
      </FrostedSection>
    </PageShell>
  );
}
