"use client";
// Submit-time alerts and the submit band at the foot of the booking form.

import { FIELD_ANCHORS, focusField } from "@/features/booking/lib/booking-form";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import type React from "react";

export interface BookingErrorSummaryProps {
  /** Anchors the summary so a submit failure can be focused. */
  ref: React.Ref<HTMLDivElement>;
  /** True when the server returned 409 (someone booked the same slot first). */
  slotStale: boolean;
  /** Clears the stale-slot state and reloads the available times. */
  onRefreshSlots: () => void;
  /** True once a submit has been attempted, so field errors join the summary. */
  showFieldErrors: boolean;
  /** Submit-time validation errors keyed by field. */
  fieldErrors: Record<string, string>;
  /** Request-level error message, or null. */
  error: string | null;
  /** Owner phone link for the "having trouble?" fallback, or null. */
  phoneLink: React.ReactNode;
}

/**
 * Stale-slot notice, field-error list and request error above the submit
 * button. Collapses (empty:hidden) when there is nothing to show.
 * @param props - Component props.
 * @param props.ref - Anchors the summary so a submit failure can be focused.
 * @param props.slotStale - True when the server returned 409.
 * @param props.onRefreshSlots - Clears the stale-slot state and reloads the times.
 * @param props.showFieldErrors - True once a submit has been attempted.
 * @param props.fieldErrors - Submit-time validation errors keyed by field.
 * @param props.error - Request-level error message, or null.
 * @param props.phoneLink - Owner phone link for the fallback, or null.
 * @returns The error summary container.
 */
export function BookingErrorSummary({
  ref,
  slotStale,
  onRefreshSlots,
  showFieldErrors,
  fieldErrors,
  error,
  phoneLink,
}: BookingErrorSummaryProps): React.ReactElement {
  const fieldErrorKeys = Object.keys(fieldErrors);
  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-8 empty:hidden">
      {slotStale && (
        <div
          role="alert"
          className={cn(
            "rounded-md border border-coquelicot-500/40 bg-coquelicot-50 p-4",
            "flex flex-col gap-2",
          )}
        >
          <p className="text-base font-medium text-error">
            That time slot was just taken by another customer.
          </p>
          <p className="text-base text-rich-black/70">
            Tap below to load the up-to-date availability - your form details will stay where they
            are.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={onRefreshSlots}>
            Refresh available times
          </Button>
        </div>
      )}
      {showFieldErrors && fieldErrorKeys.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-coquelicot-500/50 bg-coquelicot-500/10 p-4 text-rich-black"
        >
          <p className="text-base font-semibold">Please fix the following:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-base">
            {Object.keys(FIELD_ANCHORS)
              .filter((key) => fieldErrors[key])
              .map((key) => (
                <li key={key}>
                  <a
                    href={`#${FIELD_ANCHORS[key]}`}
                    onClick={(e) => {
                      e.preventDefault();
                      focusField(key);
                    }}
                    className="underline"
                  >
                    {fieldErrors[key]}
                  </a>
                </li>
              ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="text-base font-medium text-error" role="alert">
          {error}
          {phoneLink && <> Having trouble? Call or text me on {phoneLink}.</>}
        </p>
      )}
    </div>
  );
}

export interface BookingSubmitBarProps {
  /** True while the booking request is in flight. */
  submitting: boolean;
  /** True when editing an existing booking rather than creating one. */
  isEditMode: boolean;
  /** True when no day has any free slot, which disables submit. */
  noSlots: boolean;
  /** True once a submit has been attempted, so the mobile issues link can show. */
  showIssuesLink: boolean;
  /** Submit-time validation errors keyed by field. */
  fieldErrors: Record<string, string>;
  /** Cancel token of the booking being edited, if any. */
  cancelToken?: string;
}

/**
 * Submit band: sticky to the viewport bottom on mobile so users on a long form
 * never lose sight of the action; inline on >=sm.
 * @param props - Component props.
 * @param props.submitting - True while the booking request is in flight.
 * @param props.isEditMode - True when editing an existing booking.
 * @param props.noSlots - True when no day has any free slot.
 * @param props.showIssuesLink - True once a submit has been attempted.
 * @param props.fieldErrors - Submit-time validation errors keyed by field.
 * @param props.cancelToken - Cancel token of the booking being edited, if any.
 * @returns The submit band.
 */
export function BookingSubmitBar({
  submitting,
  isEditMode,
  noSlots,
  showIssuesLink,
  fieldErrors,
  cancelToken,
}: BookingSubmitBarProps): React.ReactElement {
  const fieldErrorKeys = Object.keys(fieldErrors);
  const firstErrorKey = Object.keys(FIELD_ANCHORS).find((k) => fieldErrors[k]) ?? fieldErrorKeys[0];
  return (
    <div
      className={cn(
        "sticky bottom-0 -mx-5 flex flex-wrap items-center gap-4 border-t",
        "border-seasalt-200/80 bg-seasalt/90 px-5 py-3 backdrop-blur-md",
        "sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none",
      )}
    >
      <Button
        type="submit"
        variant="secondary"
        size="md"
        aria-busy={submitting}
        disabled={submitting || noSlots}
      >
        {submitting
          ? isEditMode
            ? "Saving..."
            : "Sending..."
          : isEditMode
            ? "Save changes"
            : "Submit request"}
      </Button>
      {showIssuesLink && firstErrorKey && (
        <a
          href={`#${FIELD_ANCHORS[firstErrorKey] ?? FIELD_ANCHORS.duration}`}
          onClick={(e) => {
            e.preventDefault();
            focusField(firstErrorKey);
          }}
          className="inline-flex min-h-11 items-center text-base font-medium text-error underline sm:hidden"
        >
          {fieldErrorKeys.length} issue
          {fieldErrorKeys.length === 1 ? "" : "s"} - tap to review
        </a>
      )}
      {isEditMode && cancelToken && (
        <Button
          href={`/booking/cancel?token=${encodeURIComponent(cancelToken)}`}
          variant="ghost"
          size="md"
          disabled={submitting}
        >
          Cancel booking instead
        </Button>
      )}
    </div>
  );
}
