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
  /**
   * When the customer has already picked a slot, the drive is quoted at that
   * time so the estimate matches what the booking will snapshot. Omitted before
   * a slot is chosen, in which case the route prices a representative weekday.
   */
  departureTimeIso?: string;
  /** End of the visit; the return leg is quoted from here. */
  returnDepartureTimeIso?: string;
}

/** Result of a one-shot estimate. `estimateId` is null when logging failed. */
export interface QuickEstimateResult {
  /** Labour-only price band (travel excluded - see the travelCharge field). */
  low: number;
  high: number;
  /** Round-trip travel charge (0 for remote or when the address didn't resolve); shown on its own line. */
  travelCharge: number;
  /** AI-estimated labour minutes (travel excluded); drives the "about N hours" display. */
  estimatedMins: number;
  /** Labour-time band (5-min steps, travel excluded) for the "15 - 30 min" range. */
  minsLow: number;
  minsHigh: number;
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
          body: JSON.stringify({
            destination: dest,
            departureTimeIso: input.departureTimeIso,
            returnDepartureTimeIso: input.returnDepartureTimeIso,
          }),
        }).then(
          (r) => r.json() as Promise<{ durationMinsThere?: number; durationMinsBack?: number }>,
        )
      : Promise.resolve({ durationMinsThere: 0, durationMinsBack: 0 }),
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
  // Both legs quoted at "now"-ish traffic (no job time exists here; the
  // server defaults the return to +60 min, matching the fallback duration).
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

  // Resolve the live base + remote delta regardless of the AI duration call's
  // outcome, so a failed/timed-out estimate still prices against the operator's
  // current rate instead of the hardcoded $65 fallback.
  const baseStandard =
    rates.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
    rates.find((r) => r.ratePerHour !== null)?.ratePerHour ??
    65;
  const fullRate = baseStandard + remoteRateDelta(rates, meeting);

  let estimatedMins = 60;
  let confidence: EstimateConfidence = "medium";
  let explanation = "";
  let tasks: { label: string; mins: number }[] = [];
  if (estimateRes.status === "fulfilled" && estimateRes.value.ok && estimateRes.value.result) {
    const ai = estimateRes.value.result;
    estimatedMins = ai.estimatedMins;
    confidence = ai.confidence ?? "medium";
    explanation = ai.explanation;
    tasks = Array.isArray(ai.tasks) ? ai.tasks : [];
  }

  const travelRatePerHour =
    rates.find((r) => r.unit === "travel-hour" && r.ratePerHour !== null)?.ratePerHour ?? 40;
  const promoRate = applyPromoToHourlyRate(fullRate, promo);
  const effectiveMins = Math.max(minBillableMins, estimatedMins);
  const band = priceRangeFor(effectiveMins, promoRate, confidence, estimatorRange);
  const travel = calcTravelCharge(travelMins, travelMinsBack, travelRatePerHour, minTravelCharge);
  // Labour band is the range shown to the customer; travel is a (mostly fixed)
  // add-on surfaced on its own line rather than folded into the range. The
  // logged price below stays the all-in total so the booking snapshot is
  // unchanged.
  const low = band.low;
  const high = band.high;
  const totalLow = band.low + travel;
  const totalHigh = band.high + travel;

  // Labour-time band from the same confidence factors that widen the price,
  // rounded to 5-min steps so the card can show a range ("15 - 30 min") that
  // lines up with the price range. Travel is not counted here - it's a price
  // add-on, not time the customer is billed for on-site work.
  const timeBand = estimatorRange[confidence] ?? estimatorRange.medium;
  const minsLow = Math.max(5, Math.round((effectiveMins * timeBand.lowFactor) / 5) * 5);
  const minsHigh = Math.max(minsLow + 5, Math.round((effectiveMins * timeBand.highFactor) / 5) * 5);

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
        travelMinsBack,
        meetingType: meeting === "in-person" ? "in_person" : "remote",
        hourlyRate: promoRate,
        priceLow: totalLow,
        priceHigh: totalHigh,
        travelCharge: travel,
      }),
    }).then((r) => r.json() as Promise<{ id?: string }>);
    if (logged?.id) estimateId = logged.id;
  } catch {
    // Logging is best-effort; the range still shows without an id.
  }

  return {
    low,
    high,
    travelCharge: travel,
    estimatedMins,
    minsLow,
    minsHigh,
    estimateId,
    confidence,
    explanation,
  };
}
