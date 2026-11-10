// src/app/global-error.tsx
// Global error boundary. Must render <html> and <body>.

"use client";

import { Button } from "@/shared/components/Button";
import type React from "react";
import { useEffect } from "react";
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
  // Client-render exceptions aren't redacted by Next, so the message and stack show only in
  // development, as on the route error page; production logs them to the console instead.
  const showDetails = process.env.NODE_ENV !== "production";
  const msg =
    (showDetails && (error?.message || "").trim().slice(0, 300)) ||
    "Sorry, the page didn't load properly. Please try again, or head back to the home page.";

  useEffect(() => {
    console.error("[global error]:", error);
  }, [error]);

  return (
    <html lang="en-NZ">
      <body className="min-h-screen bg-white text-rich-black">
        <main className="mx-auto w-full max-w-5xl px-3 py-8 sm:px-6 sm:py-12">
          <h1 className="mb-3 text-center text-2xl font-extrabold sm:mb-4 sm:text-3xl md:text-4xl">
            Something went wrong
          </h1>

          <div className="border border-seasalt-200/60 bg-white p-4 sm:p-6">
            <p
              className="mb-3 text-base font-medium sm:mb-4 sm:text-lg"
              role="status"
              aria-live="polite"
            >
              {msg}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={reset} variant="primary">
                <FaArrowRotateRight className="h-4 w-4" aria-hidden />
                Try again
              </Button>

              <Button href="/" variant="outline">
                <FaHouse className="h-4 w-4" aria-hidden />
                Go home
              </Button>
            </div>

            {showDetails && (
              <details className="mt-4 text-base text-rich-black/80">
                <summary className="cursor-pointer">Technical details</summary>
                <pre className="mt-2 overflow-auto border border-seasalt-200 bg-seasalt p-3">
                  {String(error?.stack || error)}
                </pre>
              </details>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
