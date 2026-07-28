"use client";
// src/shared/components/ErrorPageShell.tsx
// Shared layout for the App Router error boundaries. Each segment supplies its
// own copy and secondary action; everything else - the "Oops!" numeral, the
// heading scale, the retry button and the technical-details block - lives here
// so the four boundaries cannot drift apart.

import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect } from "react";
import { FaArrowRotateRight } from "react-icons/fa6";

interface ErrorPageShellProps {
  /** Heading describing what failed, in the segment's own words. */
  title: string;
  /** Reassurance copy shown under the heading. */
  body: React.ReactNode;
  /** The thrown error, used for the message line and the stack block. */
  error: Error;
  /** Re-renders the failed segment. */
  onReset: () => void;
  /** Secondary escape route offered alongside the retry button. */
  secondary: { href: string; label: string; icon: React.ReactNode };
  /** Shows the trimmed error message in a live region. */
  showMessage?: boolean;
  /** Summary text for the stack-trace block; omit to hide the block entirely. */
  detailsSummary?: string;
  /** Console prefix to log the raw error under; omit to skip logging. */
  logPrefix?: string;
}

/**
 * Frosted error-boundary layout shared by the segment `error.tsx` files.
 * @param props - Component props.
 * @param props.title - Heading describing what failed.
 * @param props.body - Reassurance copy shown under the heading.
 * @param props.error - The thrown error.
 * @param props.onReset - Re-renders the failed segment.
 * @param props.secondary - Secondary escape route alongside the retry button.
 * @param props.showMessage - Shows the trimmed error message in a live region.
 * @param props.detailsSummary - Summary for the stack block; omit to hide it.
 * @param props.logPrefix - Console prefix for the raw error; omit to skip logging.
 * @returns The error page element.
 */
export function ErrorPageShell({
  title,
  body,
  error,
  onReset,
  secondary,
  showMessage = false,
  detailsSummary,
  logPrefix,
}: ErrorPageShellProps): React.ReactElement {
  const msg = (error?.message || "").trim().slice(0, 300) || "An unexpected error occurred.";

  useEffect(() => {
    if (logPrefix) console.error(logPrefix, error);
  }, [logPrefix, error]);

  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className="flex flex-col gap-6 sm:gap-8">
          <section className={cn(CARD, "text-center")}>
            <div className="mb-4 text-7xl font-extrabold text-coquelicot-500 sm:text-8xl">
              Oops!
            </div>

            <h1 className="mb-4 text-3xl font-extrabold text-russian-violet sm:text-4xl md:text-5xl">
              {title}
            </h1>

            <p className="mb-6 text-base text-rich-black sm:text-lg md:text-xl">{body}</p>

            {showMessage && (
              <p
                className="mb-6 text-sm wrap-break-word text-rich-black/70 italic sm:text-base"
                role="status"
                aria-live="polite"
              >
                {msg}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button type="button" onClick={onReset} variant="primary">
                <FaArrowRotateRight className="h-5 w-5" aria-hidden />
                Try again
              </Button>
              <Button href={secondary.href} variant="ghost">
                {secondary.icon}
                {secondary.label}
              </Button>
            </div>

            {detailsSummary && (
              <details className="mt-6 text-base text-rich-black/80">
                <summary className="cursor-pointer font-semibold hover:text-russian-violet">
                  {detailsSummary}
                </summary>
                <pre className="mt-3 max-w-full overflow-auto rounded-lg border border-seasalt-200/60 bg-white/60 p-4 text-left text-base">
                  {String(error?.stack || error)}
                </pre>
              </details>
            )}
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
