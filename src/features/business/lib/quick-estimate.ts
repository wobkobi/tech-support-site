// src/features/business/lib/quick-estimate.ts
/**
 * @description Client-safe one-shot price estimate used by the booking form's
 * inline "get a rough estimate" affordance (for customers who skipped the
 * /pricing wizard). Orchestrates the same public endpoints the wizard uses and
 * reuses {@link priceRangeFor} so the two stay in sync, then logs the estimate
 * to capture an id the booking can snapshot.
 */

import { priceRangeFor, remoteRateDelta } from "@/features/business/lib/estimate-range";
import { calcTravelCharge } from "@/features/business/lib/pricing-policy";
import { applyPromoToHourlyRate, type ActivePromo } from "@/features/business/lib/promos";
import type { PublicRate } from "@/features/business/types/pricing";
import type { EstimateConfidence, EstimatorRange } from "@/shared/lib/settings/types";

/** Inputs for a one-shot estimate from the booking form. */
export interface QuickEstimateInput {
  description: string;
  meeting: "in-person" | "remote";
  address?: string;
  estimatorRange: EstimatorRange;
  minBillableMins: number;
  minTravelCharge: number;
}

/** Result of a one-shot estimate. `estimateId` is null when logging failed. */
export interface QuickEstimateResult {
  low: number;
  high: number;
  estimateId: string | null;
  confidence: EstimateConfidence;
  explanation: string;
}

/**
 * Runs the full public-estimate flow (rates + promo + AI duration + travel),
 * computes the confidence-scaled range, logs it, and returns the range + log id.
 * @param input - Description, meeting mode, address, and live pricing settings.
 * @returns The price range, the logged estimate id, and the AI confidence/explanation.
 */
export async function fetchQuickEstimate(input: QuickEstimateInput): Promise<QuickEstimateResult> {
  const { description, meeting, address, estimatorRange, minBillableMins, minTravelCharge } = input;
  const dest =
    meeting === "remote"
      ? ""
      : (address ?? "")
          .trim()
          .replace(/,?\s*New Zealand$/i, "")
          .trim();

  const [ratesRes, promoRes, travelRes, estimateRes] = await Promise.allSettled([
    fetch("/api/pricing/rates").then((r) => r.json() as Promise<{ rates?: PublicRate[] }>),
    fetch("/api/promos/active").then((r) => r.json() as Promise<{ promo?: ActivePromo | null }>),
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
      body: JSON.stringify({ description }),
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

  const rates: PublicRate[] = ratesRes.status === "fulfilled" ? (ratesRes.value.rates ?? []) : [];
  const promo: ActivePromo | null =
    promoRes.status === "fulfilled" ? (promoRes.value.promo ?? null) : null;
  const travelMins =
    meeting === "remote"
      ? 0
      : travelRes.status === "fulfilled"
        ? (travelRes.value.durationMins ?? 0)
        : 0;

  let estimatedMins = 60;
  let confidence: EstimateConfidence = "medium";
  let explanation = "";
  let tasks: { label: string; mins: number }[] = [];
  let fullRate = 65;
  if (estimateRes.status === "fulfilled" && estimateRes.value.ok && estimateRes.value.result) {
    const ai = estimateRes.value.result;
    estimatedMins = ai.estimatedMins;
    confidence = ai.confidence ?? "medium";
    explanation = ai.explanation;
    tasks = Array.isArray(ai.tasks) ? ai.tasks : [];
    const baseStandard =
      rates.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
      rates.find((r) => r.ratePerHour !== null)?.ratePerHour ??
      65;
    fullRate = baseStandard + remoteRateDelta(rates, meeting);
  }

  const travelRatePerHour =
    rates.find((r) => r.unit === "travel-hour" && r.ratePerHour !== null)?.ratePerHour ?? 40;
  const promoRate = applyPromoToHourlyRate(fullRate, promo);
  const effectiveMins = Math.max(minBillableMins, estimatedMins);
  const band = priceRangeFor(effectiveMins, promoRate, confidence, estimatorRange);
  const travel = calcTravelCharge(travelMins, travelRatePerHour, minTravelCharge);
  const low = band.low + travel;
  const high = band.high + travel;

  // Log the estimate (best effort) to capture the id for the booking snapshot.
  let estimateId: string | null = null;
  try {
    const logged = await fetch("/api/pricing/log-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        aiEstimatedMins: estimatedMins,
        aiExplanation: explanation,
        aiTasks: tasks,
        address: dest || null,
        travelMins,
        meetingType: meeting === "in-person" ? "in_person" : "remote",
        hourlyRate: promoRate,
        priceLow: low,
        priceHigh: high,
      }),
    }).then((r) => r.json() as Promise<{ id?: string }>);
    if (logged?.id) estimateId = logged.id;
  } catch {
    // Logging is best-effort; the range still shows without an id.
  }

  return { low, high, estimateId, confidence, explanation };
}
