"use client";
// Inline "get a rough estimate" block under the booking form's description.

import type { JobDuration } from "@/features/booking/lib/booking";
import { durationRangeText, type InlineQuote } from "@/features/booking/lib/booking-form";
import { formatMoneyCompact } from "@/features/business/lib/business";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

export interface BookingEstimatePanelProps {
  /** True while an estimate request is in flight. */
  estimating: boolean;
  /** True once the description is long enough to estimate from. */
  descriptionReady: boolean;
  /** Why the button is greyed out, or what the estimate will leave out; null when neither. */
  estimateHelp: string | null;
  /** The estimate on screen, or null. */
  quote: InlineQuote | null;
  /** True when the form has changed since the shown estimate was worked out. */
  quoteStale: boolean;
  /** Error from the last estimate attempt, or null. */
  quoteError: string | null;
  /** Chosen job duration; a short booking with a long estimate offers the 2-hour switch. */
  duration: JobDuration;
  /** Runs (or re-runs) the estimate. */
  onEstimate: () => void;
  /** Switches the booking to the long duration. */
  onBookLong: () => void;
}

/**
 * Button, help text and result card for the inline rough estimate.
 * @param props - Component props.
 * @param props.estimating - True while an estimate request is in flight.
 * @param props.descriptionReady - True once the description is long enough to estimate from.
 * @param props.estimateHelp - Help line under the button, or null.
 * @param props.quote - The estimate on screen, or null.
 * @param props.quoteStale - True when the form has changed since the shown estimate.
 * @param props.quoteError - Error from the last estimate attempt, or null.
 * @param props.duration - Chosen job duration.
 * @param props.onEstimate - Runs (or re-runs) the estimate.
 * @param props.onBookLong - Switches the booking to the long duration.
 * @returns The estimate block.
 */
export function BookingEstimatePanel({
  estimating,
  descriptionReady,
  estimateHelp,
  quote,
  quoteStale,
  quoteError,
  duration,
  onEstimate,
  onBookLong,
}: BookingEstimatePanelProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-rich-black">Want a rough price first?</h3>
        <p className="text-base text-rich-black/70">
          Press the button for a ballpark worked out from your description. It&apos;s free, takes a
          few seconds and doesn&apos;t book anything.
        </p>
        <p className="text-base text-rich-black/70">
          Rates and travel charges are on the{" "}
          <Link
            href="/pricing"
            target="_blank"
            className="font-semibold text-russian-violet underline underline-offset-2 hover:opacity-80"
          >
            pricing page
          </Link>{" "}
          (opens in a new tab, so you won&apos;t lose what you&apos;ve typed).
        </p>
      </div>
      <button
        type="button"
        onClick={onEstimate}
        disabled={estimating || !descriptionReady}
        aria-describedby={estimateHelp ? "booking-estimate-help" : undefined}
        className="min-h-11 self-start rounded-md border border-russian-violet/40 px-4 py-2 text-base font-semibold text-russian-violet transition-colors hover:bg-russian-violet/5 disabled:opacity-50"
      >
        {estimating
          ? "Working it out..."
          : quote
            ? quoteStale
              ? "Update the estimate"
              : "Estimate again"
            : "Get a price estimate"}
      </button>
      {estimateHelp && (
        <p id="booking-estimate-help" className="text-base text-rich-black/70">
          {estimateHelp}
        </p>
      )}
      {quote && (
        <div
          role="status"
          className={cn(
            "rounded-xl border border-russian-violet/20 bg-russian-violet/5 p-4",
            quoteStale && "opacity-60",
          )}
        >
          {quoteStale && (
            <p className="mb-2 text-base font-medium text-rich-black">
              You&apos;ve changed some details since this estimate. Press &quot;Update the
              estimate&quot; to see a new one.
            </p>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-base font-medium text-rich-black/70">Rough estimate</p>
            <span className="rounded-full bg-russian-violet/10 px-2.5 py-0.5 text-sm font-semibold text-russian-violet">
              {durationRangeText(quote.minsLow, quote.minsHigh)}
            </span>
          </div>
          <p className="mt-1 text-3xl font-extrabold text-russian-violet">
            {formatMoneyCompact(quote.low)} - {formatMoneyCompact(quote.high)}
          </p>
          {quote.travelCharge > 0 && (
            <p className="mt-1 text-base font-medium text-rich-black/80">
              + {formatMoneyCompact(quote.travelCharge)} round-trip travel
            </p>
          )}
          <p className="mt-2 text-base text-rich-black/70">
            This is a guide only, based on what you&apos;ve written. The final cost is confirmed
            with you before any work starts.
          </p>
          {/* Gate on the MIDDLE of the range, not its high end: a wide
              band like 25m-1h10m has a typical case well under an hour,
              and nudging those to a 2-hour visit fires on almost every
              estimate. Only suggest it when the likely time runs over. */}
          {duration === "short" && (quote.minsLow + quote.minsHigh) / 2 > 60 && (
            <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-400/50 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-base text-rich-black/80">
                This looks like it might take around 2 hours. You can book a 2-hour visit so the
                time is set aside.
              </p>
              <button
                type="button"
                onClick={onBookLong}
                className="min-h-11 self-start rounded-md bg-russian-violet px-4 py-2 text-base font-semibold text-white hover:bg-russian-violet/90 sm:shrink-0 sm:self-auto"
              >
                Book 2 hours
              </button>
            </div>
          )}
        </div>
      )}
      {quoteError && <p className="text-base text-error">{quoteError}</p>}
    </div>
  );
}
