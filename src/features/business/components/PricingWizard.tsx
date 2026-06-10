"use client";

import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { calcTravelCharge } from "@/features/business/lib/pricing-policy";
import {
  applyPromoToHourlyRate,
  summariseForBanner,
  type ActivePromo,
} from "@/features/business/lib/promos";
import type { PriceRange, PublicRate } from "@/features/business/types/pricing";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";
import { useEffect, useState } from "react";

const SOFT_CARD = cn(
  "border-seasalt-400/80 bg-seasalt-900/60 rounded-xl border p-3 text-base sm:p-4 sm:text-lg",
);

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

interface Props {
  /** Minimum billable minutes (live pricing setting); floors the estimate. */
  minBillableMins: number;
  /** Travel floor (live pricing setting) for the travel estimate. */
  minTravelCharge: number;
}

/**
 * Multi-step wizard that gathers a job description, location, and meeting type,
 * uses the AI duration estimator to predict job length, and shows a price range.
 * @param props - Component props.
 * @param props.minBillableMins - Minimum billable minutes used to floor the estimate.
 * @param props.minTravelCharge - Travel floor for the travel estimate.
 * @returns The rendered wizard.
 */
export function PricingWizard({ minBillableMins, minTravelCharge }: Props): React.ReactElement {
  const [rates, setRates] = useState<PublicRate[]>([]);
  const [activePromo, setActivePromo] = useState<ActivePromo | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("issue");
  const [issueDescription, setIssueDescription] = useState("");
  const [meeting, setMeeting] = useState<MeetingMode>("on-site");
  const [address, setAddress] = useState("");
  const [addressNotFound, setAddressNotFound] = useState(false);
  const [aiExplanation, setAiExplanation] = useState("");
  const [aiEstimatedMins, setAiEstimatedMins] = useState(0);
  const [result, setResult] = useState<PriceRange | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    // Rates + active promo in parallel; promo may be null.
    Promise.all([
      fetch("/api/pricing/rates")
        .then((r) => r.json())
        .catch(() => ({ ok: false, rates: [] })),
      fetch("/api/promos/active")
        .then((r) => r.json())
        .catch(() => ({ ok: false, promo: null })),
    ]).then(
      ([ratesRes, promoRes]: [
        { ok: boolean; rates: PublicRate[] },
        { ok: boolean; promo: ActivePromo | null },
      ]) => {
        setRates(ratesRes.rates ?? []);
        setActivePromo(promoRes.promo ?? null);
        setLoading(false);
      },
    );
  }, []);

  /** Calls both APIs in parallel then computes a price range from the AI's time estimate. */
  async function getEstimate(): Promise<void> {
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

    const [travelRes, estimateRes] = await Promise.allSettled([
      dest
        ? fetch("/api/pricing/travel-time", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ destination: dest }),
          }).then((r) => r.json() as Promise<{ durationMins?: number }>)
        : Promise.resolve({ durationMins: 0 }),
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
              explanation: string;
              tasks: { label: string; mins: number }[];
            };
          }>,
      ),
    ]);

    // travelMins is one-way; calcTravelCharge doubles internally for round-trip.
    // Force 0 for remote even if an address was typed before backing up.
    const travelMins =
      meeting === "remote"
        ? 0
        : travelRes.status === "fulfilled"
          ? (travelRes.value.durationMins ?? 0)
          : 0;

    // Disclaim when an address was typed but geocoding returned durationMins: 0.
    // Without this the wizard silently quotes $0 travel.
    if (meeting === "on-site" && dest && travelMins === 0) {
      setAddressNotFound(true);
    }

    let estimatedMins = 60;
    let fullRate = 65;
    let explanation = "";
    let tasks: { label: string; mins: number }[] = [];

    if (estimateRes.status === "fulfilled" && estimateRes.value.ok && estimateRes.value.result) {
      const ai = estimateRes.value.result;
      estimatedMins = ai.estimatedMins;
      explanation = ai.explanation;
      tasks = Array.isArray(ai.tasks) ? ai.tasks : [];

      // Mirror effectiveHourlyRate: Standard base + stacked modifier deltas.
      const baseStandard =
        rates.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
        rates.find((r) => r.ratePerHour !== null)?.ratePerHour ??
        65;
      const remoteDelta =
        meeting === "remote"
          ? (rates.find((r) => r.label === "Remote" && r.hourlyDelta !== null)?.hourlyDelta ?? 0)
          : 0;
      fullRate = baseStandard + remoteDelta;
    }

    // Travel rate is decoupled from labour; Remote/promo never touch it.
    const travelRatePerHour =
      rates.find((r) => r.unit === "travel-hour" && r.ratePerHour !== null)?.ratePerHour ?? 40;

    const promoRate = applyPromoToHourlyRate(fullRate, activePromo);
    const promoApplied = promoRate < fullRate;

    setAiExplanation(explanation);
    setAiEstimatedMins(estimatedMins);

    // Floor short jobs to the published billable minimum. ±25% spread with a
    // $20 minimum bucket keeps the high end defensible per published policy.
    const effectiveMins = Math.max(minBillableMins, estimatedMins);

    /**
     * Builds a ±25% price range rounded to the nearest $5 with a $20 min spread.
     * @param mins - Minutes for this slice.
     * @param rate - Effective $/hr.
     * @returns Whole-dollar low/high range.
     */
    const rangeFor = (mins: number, rate: number): { low: number; high: number } => {
      const cost = (mins / 60) * rate;
      const low = Math.floor((cost * 0.75) / 5) * 5;
      const high = Math.max(Math.ceil((cost * 1.25) / 5) * 5, low + 20);
      return { low, high };
    };

    // Travel uses the dedicated Travel rate (never promo-discounted, never
    // labour-rate). Routes through calcTravelCharge so the floor + round-trip
    // doubling match the calculator and invoice exactly.
    const travel = calcTravelCharge(travelMins, travelRatePerHour, minTravelCharge);

    /**
     * Visit total (floor applied) plus flat travel surcharge.
     * @param rate - Effective $/hr for labour.
     * @returns Visit low/high plus the (rate-invariant) drive-time charge.
     */
    const buildVisitRange = (rate: number): { low: number; high: number; travel: number } => {
      const { low, high } = rangeFor(effectiveMins, rate);
      return { low: low + travel, high: high + travel, travel };
    };

    const promoRange = buildVisitRange(promoRate);
    // Only show the crossed-out original when it actually differs after rounding.
    const rawOriginal = promoApplied ? buildVisitRange(fullRate) : null;
    const original =
      rawOriginal && (rawOriginal.low !== promoRange.low || rawOriginal.high !== promoRange.high)
        ? rawOriginal
        : null;

    // Per-task breakdown: allocate the visit range proportionally to each
    // task's share of total mins. Per-line rangeFor would re-apply the $20 min
    // spread and inflate beyond the visit total; proportional split keeps the
    // sum honest with drift snapping to the largest line.
    const taskLines = (() => {
      const visitJob = rangeFor(effectiveMins, promoRate);
      if (tasks.length <= 1) {
        return [{ label: "Tech support", low: visitJob.low, high: visitJob.high, note: null }];
      }
      const totalTaskMins = tasks.reduce((s, t) => s + t.mins, 0) || 1;
      const lines = tasks.map((t) => ({
        label: t.label,
        low: Math.round((t.mins * visitJob.low) / totalTaskMins / 5) * 5,
        high: Math.round((t.mins * visitJob.high) / totalTaskMins / 5) * 5,
        note: null as string | null,
      }));
      const lowDrift = visitJob.low - lines.reduce((s, l) => s + l.low, 0);
      const highDrift = visitJob.high - lines.reduce((s, l) => s + l.high, 0);
      if (lowDrift !== 0 || highDrift !== 0) {
        const largestIdx = lines.reduce(
          (maxI, l, i, arr) => (l.high > arr[maxI].high ? i : maxI),
          0,
        );
        lines[largestIdx] = {
          ...lines[largestIdx],
          low: Math.max(0, lines[largestIdx].low + lowDrift),
          high: Math.max(0, lines[largestIdx].high + highDrift),
        };
      }
      return lines;
    })();

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
      includesAfterHours: false,
      ...(original
        ? {
            originalLow: original.low,
            originalHigh: original.high,
            promoLabel: activePromo ? summariseForBanner(activePromo) : undefined,
          }
        : {}),
    };

    setResult(range);
    setIsCalculating(false);
    setStep("results");

    // Audit log: fire-and-forget so failures don't break the UX. Captures
    // the raw text, AI interpretation, meeting mode the customer picked, and
    // the exact range shown so disputes can be reconstructed.
    void fetch("/api/pricing/log-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: issueDescription,
        aiEstimatedMins: estimatedMins,
        aiExplanation: explanation,
        aiTasks: tasks,
        address: dest || null,
        travelMins,
        meetingType: meeting === "on-site" ? "in_person" : "remote",
        hourlyRate: promoRate,
        priceLow: promoRange.low,
        priceHigh: promoRange.high,
        promoTitle: activePromo?.title ?? null,
        promoLabel: activePromo ? summariseForBanner(activePromo) : null,
      }),
    }).catch(() => {
      // Logging is best-effort; ignore network/server errors.
    });
  }

  /**
   * Advances to the next step. Remote sessions skip the address step (there's
   * no travel to look up); the address step is the trigger for the estimate
   * on-site, the meeting step is the trigger for remote.
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
    setMeeting("on-site");
    setAddress("");
    setAddressNotFound(false);
    setAiExplanation("");
    setAiEstimatedMins(0);
    setResult(null);
  }

  /**
   * Returns whether the current step has enough input to advance.
   * @returns True if the user can proceed
   */
  function canAdvance(): boolean {
    if (step === "issue") return issueDescription.trim().length > 0;
    return true;
  }

  // Step progression: on-site has 3 steps (issue > meeting > address), remote
  // has 2 (issue > meeting). stepIndex / totalSteps drive the progress bar.
  const totalSteps = meeting === "remote" ? 2 : 3;
  const stepIndex = step === "issue" ? 0 : step === "meeting" ? 1 : 2;

  if (loading) {
    return <div className="py-8 text-center text-sm text-slate-400">Loading calculator...</div>;
  }

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
                  ? "bg-moonstone-600"
                  : i === stepIndex
                    ? "bg-russian-violet"
                    : "bg-slate-200",
              )}
            />
          ))}
          <span className="ml-2 whitespace-nowrap text-xs text-slate-400">
            {stepIndex + 1} / {totalSteps}
          </span>
        </div>
      )}

      {step === "issue" && (
        <div>
          <h3 className="text-coquelicot mb-1 text-lg font-bold">What do you need help with?</h3>
          <p className="mb-4 text-base text-slate-600">
            Describe the issue or job - the more detail, the better the estimate.
          </p>
          <textarea
            rows={4}
            value={issueDescription}
            onChange={(e) => setIssueDescription(e.target.value)}
            placeholder="e.g. My laptop is running really slow and I think it has a virus. Also want to set up my new phone."
            className={cn(
              "w-full resize-none rounded-xl border px-4 py-3 text-base text-slate-700 outline-none transition-all",
              "border-coquelicot/40 bg-white",
              "focus:border-coquelicot focus:ring-coquelicot/30 focus:ring-2",
            )}
          />
        </div>
      )}

      {step === "meeting" && (
        <div>
          <h3 className="text-russian-violet mb-1 text-lg font-bold">
            How would you like the work done?
          </h3>
          <p className="mb-4 text-base text-slate-600">
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
                  onClick={() => setMeeting(option.value)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-all",
                    selected
                      ? "border-russian-violet bg-russian-violet/5 ring-russian-violet/30 ring-2"
                      : "border-slate-200 bg-white hover:border-slate-300",
                  )}
                >
                  <p className="text-russian-violet text-base font-bold">{option.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{option.body}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === "address" && (
        <div>
          <h3 className="text-russian-violet mb-1 text-lg font-bold">Where are you located?</h3>
          <p className="mb-4 text-base text-slate-600">
            Enter your address so drive time can be included, or skip for an estimate without
            travel.
          </p>
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            placeholder="Start typing your address..."
          />
        </div>
      )}

      {step === "results" && result && (
        <div>
          <div className="border-russian-violet/20 bg-russian-violet/5 mb-4 rounded-2xl border p-6 text-center">
            {aiEstimatedMins > 0 && (
              <p className="text-rich-black mb-3 text-2xl font-bold sm:text-3xl">
                {formatDuration(aiEstimatedMins)}
              </p>
            )}
            <p className="mb-1 text-base font-medium text-slate-600">Estimated cost</p>
            {result.originalLow !== undefined && result.originalHigh !== undefined && (
              <p className="text-base text-slate-500 line-through sm:text-lg">
                {formatPriceRound(result.originalLow)} – {formatPriceRound(result.originalHigh)}
              </p>
            )}
            <p className="text-russian-violet text-4xl font-extrabold sm:text-5xl">
              {formatPriceRound(result.low)} – {formatPriceRound(result.high)}
            </p>
            {result.promoLabel && (
              <p className={cn("mt-2 text-sm font-semibold text-amber-700")}>
                ⚡ {result.promoLabel}
              </p>
            )}
            <p
              className={cn(
                "border-coquelicot/30 bg-coquelicot/5 text-coquelicot-500 mt-4 rounded-lg border px-3 py-2 text-base font-bold",
              )}
            >
              You're charged for the actual time worked at the agreed hourly rate. Jobs that turn
              out more involved than described will cost more than this estimate.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {meeting === "remote"
                ? "Remote session - no travel charge. "
                : result.includesTravel
                  ? "Includes round-trip drive time at the Travel rate, $10 minimum. "
                  : addressNotFound
                    ? "Address not found - actual travel will be confirmed before work begins. "
                    : ""}
              All prices in NZD. No GST.
            </p>
          </div>

          {aiExplanation && <p className="mb-4 text-base text-slate-600">{aiExplanation}</p>}

          {result.breakdown.length > 0 && (
            <div className={cn(SOFT_CARD, "mb-4")}>
              <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Breakdown
              </p>
              <div className="divide-y divide-slate-100">
                {result.breakdown.map((line, i) => (
                  <div key={i} className="flex items-baseline justify-between py-1.5">
                    <span className="text-slate-700">{line.label}</span>
                    <span className="ml-4 whitespace-nowrap font-medium text-slate-700">
                      {line.low === line.high
                        ? formatPriceRound(line.low)
                        : `${formatPriceRound(line.low)} - ${formatPriceRound(line.high)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mb-5 text-sm text-slate-600">
            This is a rough estimate only. The actual cost depends on the complexity of the job and
            will be confirmed before work begins. No GST is charged.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/booking"
              className="bg-russian-violet hover:bg-russian-violet/90 rounded-xl px-5 py-2.5 text-base font-semibold text-white"
            >
              Book now
            </Link>
            <Link
              href="/contact"
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-base font-semibold text-slate-700 hover:bg-slate-50"
            >
              Ask a question
            </Link>
            <button
              onClick={reset}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-base font-semibold text-slate-600 hover:bg-slate-50"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {step !== "results" && (
        <div className="mt-6 flex gap-3">
          {(step === "meeting" || step === "address") && (
            <button
              onClick={prevStep}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-base font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
          )}
          <button
            onClick={() => void nextStep()}
            disabled={!canAdvance() || isCalculating}
            className={cn(
              "rounded-xl px-5 py-2.5 text-base font-semibold text-white transition-opacity",
              canAdvance() && !isCalculating
                ? "bg-russian-violet hover:bg-russian-violet/90"
                : "cursor-not-allowed bg-slate-300",
            )}
          >
            {isCalculating
              ? "Estimating..."
              : step === "address" || (step === "meeting" && meeting === "remote")
                ? "Get a rough estimate"
                : "Next"}
          </button>
        </div>
      )}
    </div>
  );
}
