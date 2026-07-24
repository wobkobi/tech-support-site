// src/app/admin/error.tsx
/**
 * @description Admin-segment error boundary. Operator-facing, so it keeps the
 * technical details block for debugging.
 */

"use client";

import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import type React from "react";
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
        <div className="flex flex-col gap-6 sm:gap-8">
          <section className={cn(CARD, "text-center")}>
            <div className="mb-4 text-7xl font-extrabold text-coquelicot-500 sm:text-8xl">
              Oops!
            </div>

            <h1 className="mb-4 text-3xl font-extrabold text-russian-violet sm:text-4xl md:text-5xl">
              An admin page hit an error
            </h1>

            <p className="mb-6 text-base text-rich-black sm:text-lg md:text-xl">
              Retry the action below. If it keeps failing, check the technical details and the
              server logs.
            </p>

            <p
              className="mb-6 text-sm wrap-break-word text-rich-black/70 italic sm:text-base"
              role="status"
              aria-live="polite"
            >
              {msg}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button type="button" onClick={reset} variant="primary">
                <FaArrowRotateRight className="h-5 w-5" aria-hidden />
                Try again
              </Button>
              <Button href="/admin" variant="ghost">
                <FaGauge className="h-5 w-5" aria-hidden />
                Back to dashboard
              </Button>
            </div>

            <details className="mt-6 text-base text-rich-black/80">
              <summary className="cursor-pointer font-semibold hover:text-russian-violet">
                Technical details
              </summary>
              <pre className="mt-3 max-w-full overflow-auto rounded-lg border border-seasalt-200/60 bg-white/60 p-4 text-left text-base">
                {String(error?.stack || error)}
              </pre>
            </details>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
