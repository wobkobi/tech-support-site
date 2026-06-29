// src/app/global-error.tsx
/**
 * @description Global error boundary. Must render <html> and <body>.
 */

"use client";

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";
import { FaArrowRotateRight, FaHouse } from "react-icons/fa6";

/**
 * Global error boundary UI for the App Router.
 * @param props - Component props.
 * @param props.error - Thrown error instance.
 * @param props.reset - Callback to retry rendering the route tree.
 * @returns The global error page element.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  const msg = (error?.message || "").trim().slice(0, 300) || "An unexpected error occurred.";

  return (
    <html lang="en-NZ">
      <body className="min-h-screen bg-seasalt-900 text-rich-black">
        <main className="mx-auto w-full max-w-5xl px-3 py-8 sm:px-6 sm:py-12">
          <h1 className="mb-3 text-center text-2xl font-bold sm:mb-4 sm:text-3xl md:text-4xl">
            Something went wrong
          </h1>

          <div className="rounded-lg border border-seasalt-400/60 bg-seasalt-800 p-4 shadow-sm sm:p-6">
            <p
              className="mb-3 text-base font-medium sm:mb-4 sm:text-lg"
              role="status"
              aria-live="polite"
            >
              {msg}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={reset}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md bg-russian-violet px-4 py-2 text-base font-semibold text-seasalt-800",
                  "hover:bg-russian-violet-600 disabled:opacity-60",
                )}
              >
                <FaArrowRotateRight className="h-4 w-4" aria-hidden />
                Try again
              </button>

              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-base font-semibold text-russian-violet hover:text-coquelicot-500"
              >
                <FaHouse className="h-4 w-4" aria-hidden />
                Go home
              </Link>
            </div>

            <details className="mt-4 text-base text-rich-black/80">
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-2 overflow-auto rounded-md border border-seasalt-400/60 bg-seasalt-800 p-3">
                {String(error?.stack || error)}
              </pre>
            </details>
          </div>
        </main>
      </body>
    </html>
  );
}
