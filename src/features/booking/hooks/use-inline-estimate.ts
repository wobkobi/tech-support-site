"use client";
// Inline "get a rough estimate" state for the public booking form (new
// bookings only): runs the quick estimate and tracks whether it is out of date.

import {
  BOOKING_FIELD_LIMITS,
  combineUnitAndAddress,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import type { InlineQuote } from "@/features/booking/lib/booking-form";
import { fetchQuickEstimate } from "@/features/business/lib/quick-estimate";
import type { EstimatorRange } from "@/shared/lib/settings/types";
import { useState } from "react";

/** Form inputs and live settings the inline estimate is worked out from. */
export interface InlineEstimateInputs {
  /** False in edit mode, where the estimate is never offered. */
  enabled: boolean;
  /** Live estimator range widths. */
  estimatorRange?: EstimatorRange;
  /** Min billable minutes (live setting). */
  minBillableMins?: number;
  /** Travel floor (live setting). */
  minTravelCharge?: number;
  /** Travel $/hr (live setting). */
  travelRatePerHour?: number;
  /** Low-end floor fraction (live setting). */
  lowEndFloorFactor?: number;
  /** Issue description as typed. */
  notes: string;
  /** Meeting type, or "" when not chosen. */
  meetingType: "in-person" | "remote" | "";
  /** Unit as typed. */
  unit: string;
  /** Street address as typed. */
  address: string;
  /** Chosen day key, or null. */
  dateKey: string | null;
  /** Chosen time window, or null. */
  selectedTime: TimeOfDay | null;
  /** Chosen minute past the hour. */
  selectedMinute: StartMinute;
  /** Chosen job duration. */
  duration: JobDuration;
  /** Live job durations in minutes. */
  durations: { short: number; long: number };
  /** The chosen slot's start instant, or null when day or time isn't chosen. */
  slotStart: Date | null;
  /** Promo code as typed. */
  promoCode: string;
  /** Customer email as typed. */
  email: string;
  /** Receives the logged estimate id so the booking snapshots the quote shown. */
  onEstimateId: (id: string) => void;
}

/** State and actions returned by {@link useInlineEstimate}. */
export interface InlineEstimateState {
  /** True when the inline estimate can be offered at all. */
  canInlineEstimate: boolean;
  /** True while an estimate request is in flight. */
  estimating: boolean;
  /** The estimate on screen, or null. */
  quote: InlineQuote | null;
  /** Error from the last attempt, or null. */
  quoteError: string | null;
  /** True when an input has changed since the shown estimate was worked out. */
  quoteStale: boolean;
  /** True once the description is long enough to estimate from. */
  descriptionReady: boolean;
  /** Why the estimate button is greyed out, or what it will leave out. */
  estimateHelp: string | null;
  /** Runs the estimate from the current inputs. */
  runInlineEstimate: () => Promise<void>;
  /** Drops the estimate on screen and any error. */
  clearQuote: () => void;
}

/**
 * Holds the booking form's inline rough estimate.
 * @param inputs - Current form inputs and live estimator settings.
 * @returns Estimate state, derived flags and actions.
 */
export function useInlineEstimate(inputs: InlineEstimateInputs): InlineEstimateState {
  const {
    enabled,
    estimatorRange,
    minBillableMins,
    minTravelCharge,
    travelRatePerHour,
    lowEndFloorFactor,
    notes,
    meetingType,
    unit,
    address,
    dateKey,
    selectedTime,
    selectedMinute,
    duration,
    durations,
    slotStart,
    promoCode,
    email,
    onEstimateId,
  } = inputs;
  const [estimating, setEstimating] = useState(false);
  const [quote, setQuote] = useState<InlineQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  // Inputs the shown estimate was worked out from, so an edit afterwards marks it out of date.
  const [quotedFor, setQuotedFor] = useState<string | null>(null);
  const canInlineEstimate =
    enabled &&
    estimatorRange != null &&
    minBillableMins != null &&
    minTravelCharge != null &&
    travelRatePerHour != null &&
    lowEndFloorFactor != null;

  /**
   * Everything the estimate depends on, joined into one comparable string.
   * @returns The key for the current form inputs.
   */
  function currentEstimateKey(): string {
    return JSON.stringify([
      notes.trim(),
      meetingType,
      combineUnitAndAddress(unit, address),
      dateKey,
      selectedTime,
      selectedMinute,
      duration,
      promoCode.trim(),
    ]);
  }

  /**
   * Runs the inline rough estimate from the current description + meeting +
   * address, shows the range, and captures the logged estimate id so the
   * booking snapshots the quote the customer saw.
   * @returns Resolves when the estimate completes.
   */
  async function runInlineEstimate(): Promise<void> {
    const estimateInputsKey = currentEstimateKey();
    if (
      !estimatorRange ||
      minBillableMins == null ||
      minTravelCharge == null ||
      travelRatePerHour == null ||
      lowEndFloorFactor == null
    )
      return;
    setEstimating(true);
    setQuoteError(null);
    try {
      // Quote the drive at the picked slot so the estimate matches what the
      // booking snapshots at submit.
      const slotEnd = slotStart
        ? new Date(slotStart.getTime() + durations[duration] * 60_000)
        : null;

      const res = await fetchQuickEstimate({
        description: notes.trim(),
        meeting: meetingType === "remote" ? "remote" : "in-person",
        address: meetingType === "remote" ? undefined : combineUnitAndAddress(unit, address),
        estimatorRange,
        minBillableMins,
        minTravelCharge,
        travelRatePerHour,
        lowEndFloorFactor,
        departureTimeIso: slotStart?.toISOString(),
        returnDepartureTimeIso: slotEnd?.toISOString(),
        promoCode,
        email,
      });
      setQuote({
        low: res.low,
        high: res.high,
        travelCharge: res.travelCharge,
        minsLow: res.minsLow,
        minsHigh: res.minsHigh,
      });
      if (res.estimateId) onEstimateId(res.estimateId);
      setQuotedFor(estimateInputsKey);
    } catch {
      setQuoteError("Couldn't get an estimate just now - you can still book.");
    } finally {
      setEstimating(false);
    }
  }

  /** Drops the estimate on screen and any error. */
  function clearQuote(): void {
    setQuote(null);
    setQuoteError(null);
  }

  const descriptionReady = notes.trim().length >= BOOKING_FIELD_LIMITS.notesMin;
  const quoteStale = quote !== null && quotedFor !== currentEstimateKey();
  // Why the estimate button is greyed out, or what it will leave out.
  const estimateHelp = !descriptionReady
    ? `Describe the problem above first (at least ${BOOKING_FIELD_LIMITS.notesMin} characters).`
    : meetingType === "in-person" && !address.trim()
      ? "Add your address above if you'd like travel included."
      : null;

  return {
    canInlineEstimate,
    estimating,
    quote,
    quoteError,
    quoteStale,
    descriptionReady,
    estimateHelp,
    runInlineEstimate,
    clearQuote,
  };
}
