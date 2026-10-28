"use client";
// src/features/business/components/PricingWizard.tsx
// Public multi-step price-estimate wizard: AI-estimated job length to a price range.

import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { BOOKING_FIELD_LIMITS } from "@/features/booking/lib/booking";
import { FIELD_INPUT } from "@/features/booking/lib/form-styles";
import { PromoCodeField } from "@/features/business/components/PromoCodeField";
import {
  meetingModifiers,
  priceRangeFor,
  remoteRateDelta,
} from "@/features/business/lib/estimate-range";
import { calcTravelCharge, surchargeCaveat } from "@/features/business/lib/pricing-policy";
import type { LiveDelta } from "@/features/business/lib/promo-locked-rates";
import {
  applyPromoToHourlyRate,
  applyPromoToQuote,
  describePromoDiscount,
  describeRecurringWindow,
  promoForAppointment,
  promoForSpend,
  summariseForBanner,
  type ActivePromo,
} from "@/features/business/lib/promos";
import type { PriceRange, PublicRate } from "@/features/business/types/pricing";
import { Button } from "@/shared/components/Button";
import { TextArea } from "@/shared/components/TextArea";
import { cn } from "@/shared/lib/cn";
import type { EstimateConfidence, EstimatorRange } from "@/shared/lib/settings/types";
import type React from "react";
import { useEffect, useState } from "react";

// Step headings and their one-line helper text.
const STEP_TITLE = "mb-1 text-lg font-bold text-russian-violet";
const STEP_HELP = "mb-4 text-base text-seasalt-700";

type Step = "issue" | "meeting" | "address" | "results";
type MeetingMode = "on-site" | "remote";

/**
 * Whole-dollar NZD string (no cents) for the pricing range UI.
 * @param amount - Amount in dollars (positive or negative).
 * @returns Formatted string e.g. "$85" or "-$85".
 */
function formatPriceRound(amount: number): string {
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(0)}`;
}

/**
 * Price range text, collapsing to one figure when both ends match.
 * @param low - Low end in dollars.
 * @param high - High end in dollars.
 * @returns e.g. "$65 - $130", or "$40" for a fixed line.
 */
function priceRangeText(low: number, high: number): string {
  return low === high
    ? formatPriceRound(low)
    : `${formatPriceRound(low)} - ${formatPriceRound(high)}`;
}

/**
 * Formats minutes as a human-readable duration string.
 * @param mins - Duration in minutes
 * @returns Formatted string e.g. "About 2 hours"
 */
function formatDuration(mins: number): string {
  if (mins < 60) return `About ${mins} minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hourStr = `${h} hour${h === 1 ? "" : "s"}`;
  return m === 0 ? `About ${hourStr}` : `About ${hourStr} ${m} min`;
}

/** The promo-independent half of a quote, kept so a code can reprice without re-asking the AI. */
interface QuoteInputs {
  /** Undiscounted $/hr for the chosen meeting mode. */
  fullRate: number;
  /** Undiscounted Standard $/hr, which a flat promo replaces. */
  baseRate: number;
  /** The $/hr modifiers in `fullRate`, whose locked deltas a flat promo prices with. */
  modifiers: LiveDelta[];
  /** AI-estimated labour minutes. */
  estimatedMins: number;
  /** AI confidence, which sets the band width. */
  confidence: EstimateConfidence;
  /** AI task breakdown, possibly empty. */
  tasks: { label: string; mins: number }[];
  /** The AI's plain-English reasoning, logged with the estimate. */
  explanation: string;
  /** Outbound drive minutes; 0 for remote. */
  travelMins: number;
  /** Return drive minutes; 0 for remote. */
  travelMinsBack: number;
  /** Geocoded destination, or "" for remote. Logged with the estimate. */
  dest: string;
  /** Meeting mode the customer picked. */
  meeting: MeetingMode;
}

/** The live pricing settings a quote is built against. */
interface QuoteSettings {
  minBillableMins: number;
  minTravelCharge: number;
  travelRatePerHour: number;
  estimatorRange: EstimatorRange;
  lowEndFloorFactor: number;
}

/**
 * Builds the displayed price range from fixed estimate inputs and one promo, so a promo
 * code reprices without another AI call. Spend thresholds are judged here, on the
 * undiscounted total.
 * @param inputs - The estimate inputs, independent of any promo.
 * @param settings - Live pricing settings.
 * @param resolvedPromo - The promo resolution returned, before spend is known.
 * @returns The range, the effective hourly rate, and the promo the job earned.
 */
function buildPriceRange(
  inputs: QuoteInputs,
  settings: QuoteSettings,
  resolvedPromo: ActivePromo | null,
): { range: PriceRange; promoRate: number; promo: ActivePromo | null } {
  // Floor to the billable minimum; the range widens with a vaguer description.
  const effectiveMins = Math.max(settings.minBillableMins, inputs.estimatedMins);

  /**
   * Confidence-scaled price band for one slice, shared with the inline booking estimate.
   * @param mins - Minutes for this slice.
   * @param rate - Effective $/hr.
   * @returns Whole-dollar low/high range.
   */
  const rangeFor = (mins: number, rate: number): { low: number; high: number } =>
    priceRangeFor(
      mins,
      rate,
      inputs.confidence,
      settings.estimatorRange,
      settings.lowEndFloorFactor,
    );

  // Travel rate (never discounted) via calcTravelCharge, matching the calculator and invoice.
  const travel = calcTravelCharge(
    inputs.travelMins,
    inputs.travelMinsBack,
    settings.travelRatePerHour,
    settings.minTravelCharge,
  );

  /**
   * Labour-only band (floor applied), with the travel charge alongside for its own line.
   * @param rate - Effective $/hr for labour.
   * @returns Labour low/high plus the (rate-invariant) drive-time charge.
   */
  const buildVisitRange = (rate: number): { low: number; high: number; travel: number } => {
    const { low, high } = rangeFor(effectiveMins, rate);
    // Travel shows on its own line; the logged total below stays all-in.
    return { low, high, travel };
  };

  // Undiscounted first: spend thresholds judge it, and it doubles as the "before" figure.
  const undiscounted = buildVisitRange(inputs.fullRate);
  const promo = promoForSpend(resolvedPromo, undiscounted.low + undiscounted.travel);
  const promoRate = applyPromoToHourlyRate(
    inputs.fullRate,
    promo,
    inputs.baseRate,
    inputs.modifiers,
  );
  const promoApplied = promoRate < inputs.fullRate;

  // Quote-level promos (fixed amount, free travel) apply here; rate-based ones already did.
  const pricedRange = buildVisitRange(promoRate);
  const discounted = applyPromoToQuote(
    { labourLow: pricedRange.low, labourHigh: pricedRange.high, travel: pricedRange.travel },
    promo,
  );
  const promoRange = {
    low: discounted.labourLow,
    high: discounted.labourHigh,
    travel: discounted.travel,
  };
  // The "before" figure includes travel, or a free-travel offer would show no saving.
  const anyDiscount =
    promoApplied ||
    promoRange.low !== pricedRange.low ||
    promoRange.high !== pricedRange.high ||
    promoRange.travel !== pricedRange.travel;
  const rawOriginal = anyDiscount ? undiscounted : null;
  const original =
    rawOriginal &&
    (rawOriginal.low !== promoRange.low ||
      rawOriginal.high !== promoRange.high ||
      rawOriginal.travel !== promoRange.travel)
      ? rawOriginal
      : null;

  // Split the visit range by each task's share of minutes (rounding drift to the largest
  // line); a per-line rangeFor would re-apply the $20 spread and inflate the total.
  const taskLines = (() => {
    const visitJob = rangeFor(effectiveMins, promoRate);
    if (inputs.tasks.length <= 1) {
      // The AI's own label, falling back to "Tech support" when no tasks came back.
      return [
        {
          label: inputs.tasks[0]?.label || "Tech support",
          low: visitJob.low,
          high: visitJob.high,
          note: null,
        },
      ];
    }
    const totalTaskMins = inputs.tasks.reduce((s, t) => s + t.mins, 0) || 1;
    const lines = inputs.tasks.map((t) => ({
      label: t.label,
      low: Math.round((t.mins * visitJob.low) / totalTaskMins / 5) * 5,
      high: Math.round((t.mins * visitJob.high) / totalTaskMins / 5) * 5,
      note: null as string | null,
    }));
    const lowDrift = visitJob.low - lines.reduce((s, l) => s + l.low, 0);
    const highDrift = visitJob.high - lines.reduce((s, l) => s + l.high, 0);
    if (lowDrift !== 0 || highDrift !== 0) {
      const largestIdx = lines.reduce(
        (maxI, l, i, arr) => (l.high > arr[maxI]!.high ? i : maxI),
        0,
      );
      const widest = lines[largestIdx]!;
      lines[largestIdx] = {
        ...widest,
        low: Math.max(0, widest.low + lowDrift),
        high: Math.max(0, widest.high + highDrift),
      };
    }
    return lines;
  })();

  // Assemble the final price range
  const range: PriceRange = {
    low: promoRange.low,
    high: promoRange.high,
    breakdown: [
      ...taskLines,
      ...(promoRange.travel > 0
        ? [
            {
              label: "Drive time",
              low: promoRange.travel,
              high: promoRange.travel,
              note: null,
            },
          ]
        : []),
    ],
    includesTravel: promoRange.travel > 0,
    travelCharge: promoRange.travel,
    includesAfterHours: false,
    ...(original
      ? {
          originalLow: original.low,
          originalHigh: original.high,
          originalTravel: original.travel,
          promoLabel: promo ? summariseForBanner(promo) : undefined,
        }
      : {}),
  };

  return { range, promoRate, promo };
}

interface Props {
  /** Live Standard hourly rate, the same figure the page headline quotes before any promo. */
  baseRate: number;
  /** Live customer-facing rate rows (hourly rates and the Remote/At home/Phone modifiers). */
  rates: PublicRate[];
  /** Weekend labour uplift (live pricing setting), for the weekday caveat. */
  weekendUplift: number;
  /** Public-holiday labour uplift (live pricing setting), for the weekday caveat. */
  publicHolidayUplift: number;
  /** NZ hour from which a weekday start bills after hours, or null when off, for the caveat. */
  afterHoursFromHour: number | null;
  /** Minimum billable minutes (live pricing setting); floors the estimate. */
  minBillableMins: number;
  /** Travel floor (live pricing setting) for the travel estimate. */
  minTravelCharge: number;
  /** Travel $/hr (live pricing setting); prices the round trip. */
  travelRatePerHour: number;
  /** Confidence-scaled price-range widths (live estimator setting). */
  estimatorRange: EstimatorRange;
  /** Low-end floor fraction (live estimator setting). */
  lowEndFloorFactor: number;
  /** Offer the promo code box; false while no code promo is running. */
  showPromoCode: boolean;
}

/**
 * Multi-step wizard from job description, meeting type and location to a price range.
 * @param props - Component props.
 * @param props.baseRate - Live Standard hourly rate.
 * @param props.rates - Live customer-facing rate rows.
 * @param props.weekendUplift - Weekend labour uplift, for the weekday caveat.
 * @param props.publicHolidayUplift - Public-holiday labour uplift, for the weekday caveat.
 * @param props.afterHoursFromHour - Hour from which a weekday start bills after hours, or null.
 * @param props.minBillableMins - Minimum billable minutes used to floor the estimate.
 * @param props.minTravelCharge - Travel floor for the travel estimate.
 * @param props.travelRatePerHour - Travel $/hr pricing the round trip.
 * @param props.estimatorRange - Confidence-scaled price-range widths (live estimator setting).
 * @param props.lowEndFloorFactor - Low-end floor fraction (live estimator setting).
 * @param props.showPromoCode - Whether to offer the promo code box.
 * @returns The rendered wizard.
 */
export function PricingWizard({
  baseRate,
  rates,
  weekendUplift,
  publicHolidayUplift,
  afterHoursFromHour,
  minBillableMins,
  minTravelCharge,
  travelRatePerHour,
  estimatorRange,
  lowEndFloorFactor,
  showPromoCode,
}: Props): React.ReactElement {
  const [activePromo, setActivePromo] = useState<ActivePromo | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("issue");
  const [issueDescription, setIssueDescription] = useState("");
  // Null until picked, so nobody gets a travel-inclusive quote by accident.
  const [meeting, setMeeting] = useState<MeetingMode | null>(null);
  const [address, setAddress] = useState("");
  const [addressNotFound, setAddressNotFound] = useState(false);
  const [aiExplanation, setAiExplanation] = useState("");
  const [aiEstimatedMins, setAiEstimatedMins] = useState(0);
  const [aiConfidence, setAiConfidence] = useState<EstimateConfidence>("medium");
  // True when the quote rests on the fallback duration after an AI failure.
  const [aiFailed, setAiFailed] = useState(false);
  const [result, setResult] = useState<PriceRange | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  // Logged estimate id, carried to /booking to snapshot the quote seen.
  const [estimateId, setEstimateId] = useState<string | null>(null);
  // The estimate behind the quote, so a promo code reprices without the AI.
  const [quoteInputs, setQuoteInputs] = useState<QuoteInputs | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [codePromo, setCodePromo] = useState<ActivePromo | null>(null);

  const settings: QuoteSettings = {
    minBillableMins,
    minTravelCharge,
    travelRatePerHour,
    estimatorRange,
    lowEndFloorFactor,
  };

  useEffect(() => {
    // Rates arrive as props from the page; only the active promo (maybe null) is fetched.
    void fetch("/api/promos/active")
      .then((r) => r.json() as Promise<{ ok: boolean; promo: ActivePromo | null }>)
      .catch(() => ({ ok: false, promo: null }))
      .then((promoRes) => {
        setActivePromo(promoRes.promo ?? null);
        setLoading(false);
      });
  }, []);

  /** Calls both APIs in parallel then computes a price range from the AI's time estimate. */
  async function getEstimate(): Promise<void> {
    // Guard so `meeting` narrows below.
    if (!meeting) return;
    setIsCalculating(true);
    setAddressNotFound(false);

    // Travel-time API appends ", New Zealand"; strip before re-sending. Remote skips.
    const dest =
      meeting === "remote"
        ? ""
        : address
            .trim()
            .replace(/,?\s*New Zealand$/i, "")
            .trim();

    // Fetch travel time and AI estimate in parallel
    const [travelRes, estimateRes] = await Promise.allSettled([
      dest
        ? fetch("/api/pricing/travel-time", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ destination: dest }),
          }).then(
            (r) => r.json() as Promise<{ durationMinsThere?: number; durationMinsBack?: number }>,
          )
        : Promise.resolve({ durationMinsThere: 0, durationMinsBack: 0 }),
      fetch("/api/pricing/estimate-duration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: issueDescription }),
      }).then(
        (r) =>
          r.json() as Promise<{
            ok: boolean;
            result?: {
              estimatedMins: number;
              confidence: EstimateConfidence;
              explanation: string;
              tasks: { label: string; mins: number }[];
            };
          }>,
      ),
    ]);

    // Both legs at "now" traffic (no job time yet); 0 for remote even with a typed address.
    const travelMins =
      meeting === "remote"
        ? 0
        : travelRes.status === "fulfilled"
          ? (travelRes.value.durationMinsThere ?? 0)
          : 0;
    const travelMinsBack =
      meeting === "remote"
        ? 0
        : travelRes.status === "fulfilled"
          ? (travelRes.value.durationMinsBack ?? travelMins)
          : 0;

    // Disclaim a typed address that geocoded to 0 minutes, not silently quote $0 travel.
    if (meeting === "on-site" && dest && travelMins === 0) {
      setAddressNotFound(true);
    }

    // Live rates from the page, so the quote can't fall back to a stale figure.
    const baseStandard = baseRate;
    const fullRate = baseStandard + remoteRateDelta(rates, meeting);

    // Fallback when the AI fails; must match the "typical one-hour job" copy.
    let estimatedMins = 60;
    let explanation = "";
    let confidence: EstimateConfidence = "medium";
    let tasks: { label: string; mins: number }[] = [];
    const ai =
      estimateRes.status === "fulfilled" && estimateRes.value.ok
        ? estimateRes.value.result
        : undefined;

    if (ai) {
      estimatedMins = ai.estimatedMins;
      explanation = ai.explanation;
      confidence = ai.confidence ?? "medium";
      tasks = Array.isArray(ai.tasks) ? ai.tasks : [];
    }

    setAiFailed(!ai);
    setAiExplanation(explanation);
    setAiEstimatedMins(estimatedMins);
    setAiConfidence(confidence);

    const inputs: QuoteInputs = {
      fullRate,
      baseRate: baseStandard,
      modifiers: meetingModifiers(rates, meeting),
      estimatedMins,
      confidence,
      tasks,
      explanation,
      travelMins,
      travelMinsBack,
      dest,
      meeting,
    };
    // Held so applying a promo code later reprices from the same estimate.
    setQuoteInputs(inputs);
    // No appointment yet, so a day-restricted promo isn't priced in (it is named below).
    const promo = promoForAppointment(codePromo ?? activePromo, null);
    const built = buildPriceRange(inputs, settings, promo);
    const { range, promoRate } = built;

    setResult(range);
    setIsCalculating(false);
    setStep("results");

    // Report the quote so the funnel shows where estimates stall before booking.
    if (typeof window.gtag === "function") {
      window.gtag("event", "price_estimate");
    }

    logEstimate(inputs, range, promoRate, built.promo);
  }

  /**
   * Logs the quote seen and keeps its id for the booking link. Fire-and-forget.
   * @param inputs - The estimate behind the quote.
   * @param range - The range as displayed.
   * @param promoRate - Effective $/hr the range was built at.
   * @param promo - The promo in force, or null.
   */
  function logEstimate(
    inputs: QuoteInputs,
    range: PriceRange,
    promoRate: number,
    promo: ActivePromo | null,
  ): void {
    const travel = range.travelCharge ?? 0;
    fetch("/api/pricing/log-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: issueDescription,
        aiEstimatedMins: inputs.estimatedMins,
        aiExplanation: inputs.explanation,
        aiTasks: inputs.tasks,
        address: inputs.dest || null,
        travelMins: inputs.travelMins,
        travelMinsBack: inputs.travelMinsBack,
        meetingType: inputs.meeting === "on-site" ? "in_person" : "remote",
        hourlyRate: promoRate,
        // Logged total stays all-in; the headline shows labour only.
        priceLow: range.low + travel,
        priceHigh: range.high + travel,
        travelCharge: travel,
        promoTitle: promo?.title ?? null,
        promoLabel: promo ? summariseForBanner(promo) : null,
      }),
    })
      .then((r) => r.json())
      .then((d: { id?: string }) => {
        if (d?.id) setEstimateId(d.id);
      })
      .catch(() => {
        // Logging is best-effort; ignore network/server errors.
      });
  }

  /**
   * Reprices from the stored estimate after a promo code is applied or cleared, and
   * re-logs it since the booking snapshots the quote seen.
   * @param promo - The promo the code unlocked, or null when it was cleared or rejected.
   */
  function repriceForCode(promo: ActivePromo | null): void {
    setCodePromo(promo);
    if (!quoteInputs) return;
    // A rejected code leaves the automatic promo in place.
    const effective = promoForAppointment(promo ?? activePromo, null);
    const built = buildPriceRange(quoteInputs, settings, effective);
    setResult(built.range);
    logEstimate(quoteInputs, built.range, built.promoRate, built.promo);
  }

  /**
   * Advances a step; remote skips the address step, so the estimate runs from whichever is last.
   */
  async function nextStep(): Promise<void> {
    if (step === "issue") {
      setStep("meeting");
      return;
    }
    if (step === "meeting") {
      if (meeting === "remote") {
        await getEstimate();
        return;
      }
      setStep("address");
      return;
    }
    if (step === "address") {
      await getEstimate();
      return;
    }
  }

  /** Returns to the previous step. Remote-mode results jump back to meeting. */
  function prevStep(): void {
    if (step === "meeting") setStep("issue");
    else if (step === "address") setStep("meeting");
  }

  /** Resets all wizard state back to the first step. */
  function reset(): void {
    setStep("issue");
    setIssueDescription("");
    setQuoteInputs(null);
    setPromoCode("");
    setCodePromo(null);
    // Null, not "on-site" - the meeting step must always be an explicit pick.
    setMeeting(null);
    setAddress("");
    setAddressNotFound(false);
    setAiExplanation("");
    setAiEstimatedMins(0);
    setAiFailed(false);
    setResult(null);
    setEstimateId(null);
  }

  /**
   * Returns whether the current step has enough input to advance.
   * @returns True if the user can proceed
   */
  function canAdvance(): boolean {
    if (step === "issue") return issueDescription.trim().length >= BOOKING_FIELD_LIMITS.notesMin;
    if (step === "meeting") return meeting !== null;
    return true;
  }

  // On-site: issue > meeting > address; remote: issue > meeting.
  const totalSteps = meeting === "remote" ? 2 : 3;
  const stepIndex = step === "issue" ? 0 : step === "meeting" ? 1 : 2;

  if (loading) {
    return (
      <div role="status" className="py-8 text-center text-base text-seasalt-700">
        Loading calculator...
      </div>
    );
  }

  // An offer the estimate couldn't price in (day- or customer-restricted), named so the
  // customer knows to pick that day.
  const restrictedOffer = (() => {
    const resolved = codePromo ?? activePromo;
    if (!resolved || promoForAppointment(resolved, null)) return null;
    if (resolved.customerLimited) {
      return `${describePromoDiscount(resolved)} may also apply. It depends on your past bookings with us, so it is worked out when you book.`;
    }
    const when = describeRecurringWindow(resolved);
    if (!when) return null;
    return `${describePromoDiscount(resolved)} is available ${when}. Pick one of those times when you book and it comes off this estimate.`;
  })();

  // All-in range: labour plus the one round trip, the same figures logEstimate records.
  const travelCharge = result?.travelCharge ?? 0;
  const totalRange = result
    ? priceRangeText(result.low + travelCharge, result.high + travelCharge)
    : "";

  // The next spend threshold not yet reached, shown even when a lower band applied.
  const spendNudge = (() => {
    const resolved = promoForAppointment(codePromo ?? activePromo, null);
    if (!resolved || !result) return null;
    // Judge on the pre-discount total incl. travel (the original* pair when a promo
    // applied), or an already-earned free-travel promo reads as one still to earn.
    const total =
      (result.originalLow ?? result.low) + (result.originalTravel ?? result.travelCharge ?? 0);
    const next = [
      ...resolved.tiers.map((t) => t.minSpend),
      ...(resolved.minSpend != null ? [resolved.minSpend] : []),
    ]
      .filter((floor) => floor > total)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return null;
    const earned = promoForSpend(resolved, next);
    if (!earned) return null;
    // Tiers stripped so the phrase names only the band this threshold unlocks.
    return `Jobs over $${next} get ${describePromoDiscount({ ...earned, tiers: [] })}.`;
  })();

  // The quote has no date, so it prices a weekday; dollars at the quote's own full rate.
  const weekdayCaveat = quoteInputs
    ? surchargeCaveat(
        { weekendUplift, publicHolidayUplift, afterHoursFromHour },
        quoteInputs.fullRate,
      )
    : null;

  // An applied code travels to /booking, which re-resolves it.
  const bookingHref = (() => {
    const params = new URLSearchParams();
    if (estimateId) params.set("estimate", estimateId);
    if (codePromo?.code) params.set("promo", codePromo.code);
    const query = params.toString();
    return query ? `/booking?${query}` : "/booking";
  })();

  return (
    <div>
      {step !== "results" && (
        <div className="mb-6 flex items-center gap-2">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={cn(
                "h-2 flex-1 rounded-full transition-colors",
                i < stepIndex
                  ? "bg-moonstone-400"
                  : i === stepIndex
                    ? "bg-russian-violet"
                    : "bg-seasalt-200",
              )}
            />
          ))}
          <span className="ml-2 text-base whitespace-nowrap text-seasalt-700">
            <span className="sr-only">Step </span>
            {stepIndex + 1} / {totalSteps}
          </span>
        </div>
      )}

      {step === "issue" && (
        <div>
          <h3 className={STEP_TITLE}>What do you need help with?</h3>
          <p className={STEP_HELP}>
            Describe the issue or job - the more detail, the better the estimate.
          </p>
          <TextArea
            rows={4}
            value={issueDescription}
            onChange={(e) => setIssueDescription(e.target.value)}
            maxLength={BOOKING_FIELD_LIMITS.notes}
            aria-label="Describe the issue or job you need help with"
            placeholder="e.g. My laptop is running really slow and I think it has a virus. Also want to set up my new phone."
            className={cn(FIELD_INPUT, "resize-none placeholder:text-seasalt-500")}
          />
          {issueDescription.trim().length > 0 &&
            issueDescription.trim().length < BOOKING_FIELD_LIMITS.notesMin && (
              <p className="mt-2 text-base text-seasalt-700">
                Add a bit more detail for a better estimate.
              </p>
            )}
        </div>
      )}

      {step === "meeting" && (
        <div>
          <h3 className={STEP_TITLE}>How would you like the work done?</h3>
          <p className={STEP_HELP}>
            On-site visits include travel; remote sessions get a small rate reduction and no travel
            charge.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  value: "on-site",
                  title: "On-site visit",
                  body: "I come to you. Best for Wi-Fi, printers, hardware, anything hands-on.",
                },
                {
                  value: "remote",
                  title: "Remote session",
                  body: "I log in via screen share. Best for software, accounts, quick fixes.",
                },
              ] as const
            ).map((option) => {
              const selected = meeting === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMeeting(option.value)}
                  className={cn(
                    "rounded-lg border-2 bg-white p-4 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet",
                    selected
                      ? "border-russian-violet bg-seasalt"
                      : "border-seasalt-200 hover:border-seasalt-500",
                  )}
                >
                  <p className="text-base font-bold text-russian-violet">{option.title}</p>
                  <p className="mt-1 text-base text-rich-black">{option.body}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === "address" && (
        <div>
          <h3 className={STEP_TITLE}>Where are you located?</h3>
          <p className={STEP_HELP}>
            Enter your address so drive time can be included, or skip for an estimate without
            travel.
          </p>
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            aria-label="Your address"
            placeholder="Start typing your address..."
            inputClassName={FIELD_INPUT}
          />
        </div>
      )}

      {step === "results" && result && (
        <div>
          <div
            role="status"
            className="mb-4 rounded-lg border-2 border-russian-violet bg-white p-6 text-center"
          >
            {aiFailed ? (
              <p className="mb-3 text-base font-medium text-rich-black">
                The automatic estimate isn't working just now, so this price assumes a typical
                one-hour job. Try again in a minute, or book and I'll confirm the price once I know
                the details.
              </p>
            ) : (
              aiEstimatedMins > 0 && (
                <p className="mb-3 text-2xl font-bold text-rich-black sm:text-3xl">
                  {formatDuration(aiEstimatedMins)}
                </p>
              )
            )}
            <p className="mb-1 text-base font-medium text-seasalt-700">Estimated cost</p>
            {result.originalLow !== undefined && result.originalHigh !== undefined && (
              <p className="text-base text-seasalt-700 line-through sm:text-lg">
                {formatPriceRound(result.originalLow)} - {formatPriceRound(result.originalHigh)}
              </p>
            )}
            <p className="text-4xl font-extrabold text-russian-violet sm:text-5xl">
              {formatPriceRound(result.low)} - {formatPriceRound(result.high)}
            </p>
            {meeting !== "remote" && result.includesTravel && (result.travelCharge ?? 0) > 0 && (
              <>
                <p className="mt-1 text-lg font-semibold text-seasalt-700">
                  + {formatPriceRound(result.travelCharge ?? 0)} round-trip travel
                </p>
                <p className="mt-3 text-xl font-bold text-rich-black sm:text-2xl">
                  Total: {totalRange}
                </p>
              </>
            )}
            {result.promoLabel && (
              <p className="mt-3 inline-block rounded bg-mustard-300 px-3 py-1 text-base font-bold text-russian-violet">
                ⚡ {result.promoLabel}
              </p>
            )}
            <p className="mt-4 border-l-4 border-coquelicot-600 bg-seasalt px-4 py-3 text-left text-base font-bold text-coquelicot-700">
              You're charged for the actual time worked at the agreed hourly rate. Jobs that turn
              out more involved than described will cost more than this estimate.
            </p>
            <p className="mt-3 text-base text-seasalt-700">
              {meeting === "remote"
                ? "Remote session - no travel charge. "
                : result.includesTravel
                  ? // Mention the minimum only when the minimum is what's charged.
                    (result.travelCharge ?? 0) <= minTravelCharge
                    ? `Round-trip drive time is charged at the Travel rate, ${formatPriceRound(minTravelCharge)} minimum. `
                    : "Round-trip drive time is charged at the Travel rate. "
                  : addressNotFound
                    ? "Address not found - actual travel will be confirmed before work begins. "
                    : ""}
              All prices in NZD. No GST.
            </p>
            {aiConfidence === "low" && !aiFailed && (
              <p className="mt-3 text-base font-medium text-coquelicot-700">
                Your description was brief, so this is a wide ballpark - I'll pin it down once I see
                it.
              </p>
            )}
          </div>

          {spendNudge && (
            <p className="mb-4 rounded-lg border-2 border-mustard-300 bg-mustard-50 px-4 py-3 text-base font-medium text-russian-violet-900">
              {spendNudge}
            </p>
          )}

          {restrictedOffer && (
            <p className="mb-4 rounded-lg border-2 border-mustard-300 bg-mustard-50 px-4 py-3 text-base font-medium text-russian-violet-900">
              {restrictedOffer}
            </p>
          )}

          {showPromoCode && (
            <PromoCodeField
              value={promoCode}
              onChange={setPromoCode}
              onApplied={repriceForCode}
              className="mb-4 max-w-sm"
            />
          )}

          {aiExplanation && <p className="mb-4 text-base text-seasalt-700">{aiExplanation}</p>}

          {/* A plain ruled list, not a box: the result panel above is the only boxed element. */}
          {result.breakdown.length > 0 && (
            <div className="mb-5">
              <p className="mb-1 text-sm font-bold tracking-[0.06em] text-moonstone-700 uppercase">
                Breakdown
              </p>
              <div className="divide-y divide-seasalt-100 border-y border-seasalt-100 text-base sm:text-lg">
                {result.breakdown.map((line, i) => (
                  <div key={i} className="flex items-baseline justify-between py-2">
                    <span className="text-rich-black">{line.label}</span>
                    <span className="ml-4 font-bold whitespace-nowrap text-rich-black">
                      {priceRangeText(line.low, line.high)}
                    </span>
                  </div>
                ))}
                {result.breakdown.length > 1 && (
                  <div className="flex items-baseline justify-between border-t-2 border-russian-violet py-2">
                    <span className="font-bold text-rich-black">Total</span>
                    <span className="ml-4 font-extrabold whitespace-nowrap text-russian-violet">
                      {totalRange}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="mb-5 text-base text-seasalt-700">
            {weekdayCaveat
              ? `This is a rough estimate for a weekday. ${weekdayCaveat} `
              : "This is a rough estimate only. "}
            The actual cost depends on the complexity of the job and will be confirmed before work
            begins. No GST is charged.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button href={bookingHref}>Book now</Button>
            <Button href="/contact" variant="outline">
              Ask a question
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Start over
            </Button>
          </div>
        </div>
      )}

      {step !== "results" && (
        <div className="mt-6 flex gap-3">
          {(step === "meeting" || step === "address") && (
            <Button type="button" variant="outline" onClick={prevStep}>
              Back
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => void nextStep()}
            disabled={!canAdvance() || isCalculating}
          >
            {isCalculating
              ? "Estimating..."
              : step === "address" || (step === "meeting" && meeting === "remote")
                ? "Get a rough estimate"
                : "Next"}
          </Button>
        </div>
      )}
    </div>
  );
}
