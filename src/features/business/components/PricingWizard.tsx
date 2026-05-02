"use client";

import type React from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { calcPriceRange } from "@/features/business/lib/pricing";
import type {
  PublicRate,
  SelectedService,
  PriceRange,
  Urgency,
  DurationGuess,
} from "@/features/business/types/pricing";
import { cn } from "@/shared/lib/cn";

const SOFT_CARD = cn(
  "border-seasalt-400/80 bg-seasalt-900/60 rounded-xl border p-3 text-sm sm:p-4 sm:text-base",
);

type Step = "services" | "suburb" | "urgency" | "duration" | "results";

const STEPS_WITH_DURATION: Step[] = ["services", "suburb", "urgency", "duration", "results"];
const STEPS_NO_DURATION: Step[] = ["services", "suburb", "urgency", "results"];

const URGENCY_OPTIONS: { value: Urgency; label: string; desc: string }[] = [
  { value: "flexible", label: "Flexible", desc: "Whenever works best" },
  { value: "this-week", label: "This week", desc: "Within a few days" },
  { value: "asap", label: "ASAP", desc: "Today or tomorrow - after-hours rates may apply" },
];

const DURATION_OPTIONS: { value: DurationGuess; label: string; desc: string }[] = [
  { value: "quick", label: "Quick job", desc: "Under 45 minutes" },
  { value: "hour", label: "About an hour", desc: "45-90 minutes" },
  { value: "few-hours", label: "A few hours", desc: "More than 90 minutes" },
  { value: "unsure", label: "Not sure", desc: "I'll use a broad estimate" },
];

/**
 * Formats a number as a rounded NZD currency string.
 * @param amount - Amount in dollars
 * @returns Formatted string (e.g. "$85")
 */
function formatNZD(amount: number): string {
  return `$${amount.toFixed(0)}`;
}

/**
 * Returns true if a public rate represents a call-out fee.
 * @param rate - Public rate to test
 * @returns Whether the rate is a call-out fee
 */
function isCallOut(rate: PublicRate): boolean {
  return rate.label.toLowerCase().includes("call") && rate.flatRate !== null;
}

/**
 * Returns true if a public rate is a per-kilometre travel rate.
 * @param rate - Public rate to test
 * @returns Whether the rate is charged per km
 */
function isTravelPerKm(rate: PublicRate): boolean {
  return rate.unit === "km";
}

/**
 * Converts a public rate into the SelectedService shape used by calcPriceRange.
 * @param rate - Public rate from the API
 * @returns Selected service object
 */
function rateToService(rate: PublicRate): SelectedService {
  return {
    label: rate.label,
    type: rate.ratePerHour !== null ? "hourly" : "flat",
    flatRate: rate.flatRate,
    ratePerHour: rate.ratePerHour,
  };
}

/**
 * Multi-step pricing wizard that fetches live rates and calculates an estimate range.
 * @returns Pricing wizard element
 */
export function PricingWizard(): React.ReactElement {
  const [rates, setRates] = useState<PublicRate[]>([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>("services");
  const [selectedServices, setSelectedServices] = useState<SelectedService[]>([]);
  const [suburb, setSuburb] = useState("");
  const [travelMins, setTravelMins] = useState(0);
  const [urgency, setUrgency] = useState<Urgency | null>(null);
  const [duration, setDuration] = useState<DurationGuess>(null);
  const [result, setResult] = useState<PriceRange | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    fetch("/api/pricing/rates")
      .then((r) => r.json())
      .then((data: { ok: boolean; rates: PublicRate[] }) => {
        setRates(data.rates ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const selectableRates = rates.filter(
    (r) => !isCallOut(r) && !isTravelPerKm(r) && !(r.ratePerHour !== null && !r.isDefault),
  );
  const afterHoursRate =
    rates.find((r) => r.label.toLowerCase().includes("after") && r.ratePerHour !== null)
      ?.ratePerHour ?? null;

  const hasHourly = selectedServices.some((s) => s.type === "hourly");
  const steps = hasHourly ? STEPS_WITH_DURATION : STEPS_NO_DURATION;
  const stepIndex = steps.indexOf(step);
  const totalSteps = steps.length - 1;

  /**
   * Toggles a rate's selection in the services step.
   * @param rate - Public rate to toggle
   */
  function toggleService(rate: PublicRate): void {
    const service = rateToService(rate);
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.label === service.label);
      return exists ? prev.filter((s) => s.label !== service.label) : [...prev, service];
    });
  }

  /**
   * Advances to the next wizard step, fetching drive time when leaving the suburb step.
   */
  async function nextStep(): Promise<void> {
    let mins = travelMins;

    if (step === "suburb" && suburb.trim()) {
      setIsCalculating(true);
      try {
        const res = await fetch("/api/pricing/travel-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destination: suburb.trim() }),
        });
        const data = (await res.json()) as { durationMins?: number };
        mins = data.durationMins ?? 0;
        setTravelMins(mins);
      } catch {
        mins = 0;
      }
      setIsCalculating(false);
    }

    const currentIdx = steps.indexOf(step);
    const next = steps[currentIdx + 1];
    if (next === "results") {
      const range = calcPriceRange(
        selectedServices,
        urgency ?? "flexible",
        duration ?? "unsure",
        mins,
        afterHoursRate,
      );
      setResult(range);
    }
    if (next) setStep(next);
  }

  /**
   * Returns to the previous wizard step.
   */
  function prevStep(): void {
    const currentIdx = steps.indexOf(step);
    const prev = steps[currentIdx - 1];
    if (prev) setStep(prev);
  }

  /**
   * Resets all wizard state back to the first step.
   */
  function reset(): void {
    setStep("services");
    setSelectedServices([]);
    setSuburb("");
    setTravelMins(0);
    setUrgency(null);
    setDuration(null);
    setResult(null);
  }

  /**
   * Returns whether the current step has a valid selection to advance.
   * @returns True if the user can proceed to the next step
   */
  function canAdvance(): boolean {
    if (step === "services") return selectedServices.length > 0;
    if (step === "suburb") return true;
    if (step === "urgency") return urgency !== null;
    if (step === "duration") return duration !== null;
    return true;
  }

  const displayStepCount = stepIndex < totalSteps ? stepIndex + 1 : totalSteps;

  if (loading) {
    return <div className="py-8 text-center text-sm text-slate-400">Loading calculator...</div>;
  }

  if (selectableRates.length === 0) return <></>;

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
            {displayStepCount} / {totalSteps}
          </span>
        </div>
      )}

      {step === "services" && (
        <div>
          <h3 className={cn("text-russian-violet mb-1 text-lg font-bold")}>
            What do you need help with?
          </h3>
          <p className="mb-4 text-sm text-slate-500">Select all that apply</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {selectableRates.map((rate) => {
              const selected = selectedServices.some((s) => s.label === rate.label);
              return (
                <button
                  key={rate.label}
                  onClick={() => toggleService(rate)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-all",
                    selected
                      ? "border-russian-violet bg-russian-violet/5 ring-russian-violet ring-1"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <p
                    className={cn(
                      "font-medium",
                      selected ? "text-russian-violet" : "text-slate-700",
                    )}
                  >
                    {rate.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {rate.ratePerHour !== null
                      ? `${formatNZD(rate.ratePerHour)}/hr`
                      : rate.flatRate !== null
                        ? `From ${formatNZD(rate.flatRate)}`
                        : ""}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === "suburb" && (
        <div>
          <h3 className={cn("text-russian-violet mb-1 text-lg font-bold")}>
            Where are you located?
          </h3>
          <p className="mb-4 text-sm text-slate-500">
            Enter your suburb to factor in drive time, or leave blank to skip.
          </p>
          <input
            type="text"
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void nextStep();
            }}
            placeholder="e.g. Papanui, Halswell, Rolleston..."
            className={cn(
              "w-full rounded-xl border px-4 py-3 text-sm text-slate-700 outline-none transition-all",
              "border-seasalt-400/80 bg-white",
              "focus:border-russian-violet focus:ring-russian-violet focus:ring-1",
            )}
          />
        </div>
      )}

      {step === "urgency" && (
        <div>
          <h3 className={cn("text-russian-violet mb-1 text-lg font-bold")}>When do you need it?</h3>
          <p className="mb-4 text-sm text-slate-500">Urgent jobs may attract after-hours rates</p>
          <div className="flex flex-col gap-3">
            {URGENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setUrgency(opt.value)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-all",
                  urgency === opt.value
                    ? "border-russian-violet bg-russian-violet/5 ring-russian-violet ring-1"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                <p
                  className={cn(
                    "font-medium",
                    urgency === opt.value ? "text-russian-violet" : "text-slate-700",
                  )}
                >
                  {opt.label}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "duration" && (
        <div>
          <h3 className={cn("text-russian-violet mb-1 text-lg font-bold")}>
            How long do you think it might take?
          </h3>
          <p className="mb-4 text-sm text-slate-500">
            A rough guess is fine - I'll confirm before starting
          </p>
          <div className="flex flex-col gap-3">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.value ?? "unsure"}
                onClick={() => setDuration(opt.value)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-all",
                  duration === opt.value
                    ? "border-russian-violet bg-russian-violet/5 ring-russian-violet ring-1"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                <p
                  className={cn(
                    "font-medium",
                    duration === opt.value ? "text-russian-violet" : "text-slate-700",
                  )}
                >
                  {opt.label}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "results" && result && (
        <div>
          <div className="border-russian-violet/20 bg-russian-violet/5 mb-6 rounded-2xl border p-6 text-center">
            <p className="mb-1 text-sm font-medium text-slate-500">Estimated cost range</p>
            <p className="text-russian-violet text-4xl font-extrabold">
              {formatNZD(result.low)} - {formatNZD(result.high)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {result.includesTravel && "Includes drive time. "}
              {result.includesAfterHours && "After-hours rate applied. "}
              All prices in NZD.
            </p>
          </div>

          {result.breakdown.length > 0 && (
            <div className={cn(SOFT_CARD, "mb-4")}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Breakdown
              </p>
              <div className="divide-y divide-slate-100">
                {result.breakdown.map((line, i) => (
                  <div key={i} className="flex items-baseline justify-between py-1.5">
                    <span className="text-slate-700">
                      {line.label}
                      {line.note && (
                        <span className="ml-1 text-xs text-amber-600">({line.note})</span>
                      )}
                    </span>
                    <span className="ml-4 whitespace-nowrap font-medium text-slate-700">
                      {line.low === line.high
                        ? formatNZD(line.low)
                        : `${formatNZD(line.low)} - ${formatNZD(line.high)}`}
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
          {stepIndex > 0 && (
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
            {isCalculating
              ? "Calculating..."
              : steps[stepIndex + 1] === "results"
                ? "Get estimate"
                : "Next"}
          </button>
        </div>
      )}
    </div>
  );
}
