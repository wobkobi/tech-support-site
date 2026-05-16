"use client";

import type React from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import type { PublicRate, PriceRange } from "@/features/business/types/pricing";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { cn } from "@/shared/lib/cn";
import {
  applyPromoToHourlyRate,
  summariseForBanner,
  type ActivePromo,
} from "@/features/business/lib/promos";

const SOFT_CARD = cn(
  "border-seasalt-400/80 bg-seasalt-900/60 rounded-xl border p-3 text-sm sm:p-4 sm:text-base",
);

type Step = "issue" | "address" | "results";

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

/**
 * Multi-step wizard that gathers a job description, location, and meeting type,
 * uses the AI duration estimator to predict job length, and shows a price range.
 * @returns The rendered wizard.
 */
export function PricingWizard(): React.ReactElement {
  const [rates, setRates] = useState<PublicRate[]>([]);
  const [activePromo, setActivePromo] = useState<ActivePromo | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("issue");
  const [issueDescription, setIssueDescription] = useState("");
  const [address, setAddress] = useState("");
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

  /** Calls both APIs in parallel then computes a ±20% price range from the AI's time estimate. */
  async function getEstimate(): Promise<void> {
    setIsCalculating(true);

    // Strip trailing ", New Zealand" — travel-time API appends it automatically
    const dest = address
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
              category: "standard" | "complex";
              explanation: string;
            };
          }>,
      ),
    ]);

    const travelMins = travelRes.status === "fulfilled" ? (travelRes.value.durationMins ?? 0) : 0;

    let estimatedMins = 60;
    let fullRate = 65;
    let explanation = "";

    if (estimateRes.status === "fulfilled" && estimateRes.value.ok && estimateRes.value.result) {
      const ai = estimateRes.value.result;
      estimatedMins = ai.estimatedMins;
      explanation = ai.explanation;

      // Standard base + Complex modifier delta when AI flags the job complex.
      const baseStandard =
        rates.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
        rates.find((r) => r.ratePerHour !== null)?.ratePerHour ??
        65;
      const complexModifier = rates.find((r) => r.label === "Complex" && r.hourlyDelta !== null);
      const complexRate = complexModifier
        ? baseStandard + (complexModifier.hourlyDelta ?? 0)
        : baseStandard;
      fullRate = ai.category === "complex" ? complexRate : baseStandard;
    }

    const promoRate = applyPromoToHourlyRate(fullRate, activePromo);
    const promoApplied = promoRate < fullRate;

    setAiExplanation(explanation);
    setAiEstimatedMins(estimatedMins);

    /**
     * Builds a ±20% price range from the AI's minute estimate at a given rate.
     * Called twice when a promo is active so we can show original + promo'd.
     * @param rate - Effective $/hr for this branch.
     * @returns Low/high range plus the per-call travel surcharge.
     */
    const buildRange = (rate: number): { low: number; high: number; travel: number } => {
      const jobCost = (estimatedMins / 60) * rate;
      const travelCost = (travelMins / 60) * rate;
      const jobLow = Math.floor((jobCost * 0.8) / 10) * 10;
      const jobHigh = Math.max(Math.ceil((jobCost * 1.2) / 10) * 10, jobLow + 30);
      const travel = Math.round(travelCost / 10) * 10;
      return { low: jobLow + travel, high: jobHigh + travel, travel };
    };
    const promoRange = buildRange(promoRate);
    const original = promoApplied ? buildRange(fullRate) : null;
    const jobLow = Math.floor(((estimatedMins / 60) * promoRate * 0.8) / 10) * 10;
    const jobHigh = Math.max(
      Math.ceil(((estimatedMins / 60) * promoRate * 1.2) / 10) * 10,
      jobLow + 30,
    );

    const range: PriceRange = {
      low: promoRange.low,
      high: promoRange.high,
      breakdown: [
        { label: "Tech support", low: jobLow, high: jobHigh, note: null },
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
  }

  /** Advances to the next step, or triggers estimate calculation on the address step. */
  async function nextStep(): Promise<void> {
    if (step === "address") {
      await getEstimate();
      return;
    }
    setStep("address");
  }

  /** Returns to the previous step. */
  function prevStep(): void {
    if (step === "address") setStep("issue");
  }

  /** Resets all wizard state back to the first step. */
  function reset(): void {
    setStep("issue");
    setIssueDescription("");
    setAddress("");
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

  const stepIndex = step === "issue" ? 0 : 1;

  if (loading) {
    return <div className="py-8 text-center text-sm text-slate-400">Loading calculator...</div>;
  }

  return (
    <div>
      {step !== "results" && (
        <div className="mb-6 flex items-center gap-2">
          {[0, 1].map((i) => (
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
          <span className="ml-2 whitespace-nowrap text-xs text-slate-400">{stepIndex + 1} / 2</span>
        </div>
      )}

      {step === "issue" && (
        <div>
          <h3 className="text-coquelicot mb-1 text-lg font-bold">What do you need help with?</h3>
          <p className="mb-4 text-sm text-slate-500">
            Describe the issue or job - the more detail, the better the estimate.
          </p>
          <textarea
            rows={4}
            value={issueDescription}
            onChange={(e) => setIssueDescription(e.target.value)}
            placeholder="e.g. My laptop is running really slow and I think it has a virus. Also want to set up my new phone."
            className={cn(
              "w-full resize-none rounded-xl border px-4 py-3 text-sm text-slate-700 outline-none transition-all",
              "border-coquelicot/40 bg-white",
              "focus:border-coquelicot focus:ring-coquelicot/30 focus:ring-2",
            )}
          />
        </div>
      )}

      {step === "address" && (
        <div>
          <h3 className="text-russian-violet mb-1 text-lg font-bold">Where are you located?</h3>
          <p className="mb-4 text-sm text-slate-500">
            Enter your address to include drive time, or skip for an estimate without travel.
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
            <p className="mb-1 text-sm font-medium text-slate-500">Estimated cost</p>
            {result.originalLow !== undefined && result.originalHigh !== undefined && (
              <p className="text-sm text-slate-400 line-through sm:text-base">
                {formatPriceRound(result.originalLow)} – {formatPriceRound(result.originalHigh)}
              </p>
            )}
            <p className="text-russian-violet text-4xl font-extrabold sm:text-5xl">
              {formatPriceRound(result.low)} – {formatPriceRound(result.high)}
            </p>
            {result.promoLabel && (
              <p className={cn("mt-2 text-xs font-semibold text-amber-700")}>
                ⚡ {result.promoLabel}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              {result.includesTravel && "Includes drive time. "}
              All prices in NZD. No GST.
            </p>
          </div>

          {aiExplanation && <p className="mb-4 text-sm text-slate-500">{aiExplanation}</p>}

          {result.breakdown.length > 0 && (
            <div className={cn(SOFT_CARD, "mb-4")}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
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

          <p className="mb-5 text-xs text-slate-400">
            This is a rough estimate only. The actual cost depends on the complexity of the job and
            will be confirmed before work begins. No GST is charged.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/booking"
              className="bg-russian-violet hover:bg-russian-violet/90 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
            >
              Book now
            </Link>
            <Link
              href="/contact"
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Ask a question
            </Link>
            <button
              onClick={reset}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {step !== "results" && (
        <div className="mt-6 flex gap-3">
          {step === "address" && (
            <button
              onClick={prevStep}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
          )}
          <button
            onClick={() => void nextStep()}
            disabled={!canAdvance() || isCalculating}
            className={cn(
              "rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-opacity",
              canAdvance() && !isCalculating
                ? "bg-russian-violet hover:bg-russian-violet/90"
                : "cursor-not-allowed bg-slate-300",
            )}
          >
            {isCalculating ? "Estimating..." : step === "address" ? "Get a rough estimate" : "Next"}
          </button>
        </div>
      )}
    </div>
  );
}
