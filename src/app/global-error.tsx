// src/app/global-error.tsx
/**
 * @file global-error.tsx
 * @description Global error boundary. Must render <html> and <body>.
 */

"use client";

import type React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
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
  const msg = (error?.message || "").trim().slice(0, 300) || "The app hit an unexpected error.";

  return (
    <html lang="en-NZ">
      <body className={cn("bg-seasalt-900 text-rich-black min-h-screen")}>
        <main className={cn("mx-auto w-full max-w-5xl px-3 py-8 sm:px-6 sm:py-12")}>
          <h1 className={cn("mb-3 text-center text-2xl font-bold sm:mb-4 sm:text-3xl md:text-4xl")}>
            Something went wrong
          </h1>

          <div
            className={cn(
              "border-seasalt-400/60 bg-seasalt-800 rounded-lg border p-4 shadow-sm sm:p-6",
            )}
          >
            <p
              className={cn("mb-3 text-base font-medium sm:mb-4 sm:text-lg")}
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

            <details className={cn("text-rich-black/80 mt-4 text-sm")}>
              <summary className={cn("cursor-pointer")}>Technical details</summary>
              <pre
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-800 mt-2 overflow-auto rounded-md border p-3",
                )}
              >
                {String(error?.stack || error)}
              </pre>
            </details>
          </div>
        </main>
      </body>
    </html>
  );
}
