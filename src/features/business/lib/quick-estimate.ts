// src/features/business/lib/quick-estimate.ts
/**
 * @description Client-safe one-shot price estimate for the booking form's
 * inline "get a rough estimate" affordance. Orchestrates the same public
 * endpoints the /pricing wizard uses and reuses {@link priceRangeFor} so the
 * two stay in sync, then logs the estimate for the booking to snapshot.
 */

import { priceRangeFor, remoteRateDelta } from "@/features/business/lib/estimate-range";
import { calcTravelCharge, FALLBACK_BASE_RATE } from "@/features/business/lib/pricing-policy";
import {
  applyPromoToHourlyRate,
  applyPromoToQuote,
  normalisePromoCode,
  promoForAppointment,
  type ActivePromo,
} from "@/features/business/lib/promos";
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
  /** Travel $/hr (live pricing setting); prices the round trip. */
  travelRatePerHour: number;
  lowEndFloorFactor: number;
  /**
   * When the customer has already picked a slot, the drive is quoted at that
   * time so the estimate matches what the booking will snapshot. Omitted before
   * a slot is chosen, in which case the route prices a representative weekday.
   */
  departureTimeIso?: string;
  /** End of the visit; the return leg is quoted from here. */
  returnDepartureTimeIso?: string;
  /**
   * A promo code the customer entered. A valid one beats the automatic promo;
   * an invalid one is ignored and the automatic promo still applies.
   */
  promoCode?: string | null;
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
  const {
    description,
    meeting,
    address,
    estimatorRange,
    minBillableMins,
    minTravelCharge,
    travelRatePerHour,
    lowEndFloorFactor,
  } = input;
  const dest =
    meeting === "remote"
      ? ""
      : (address ?? "")
          .trim()
          .replace(/,?\s*New Zealand$/i, "")
          .trim();

  const code = normalisePromoCode(input.promoCode);

  const [ratesRes, promoRes, codeRes, travelRes, estimateRes] = await Promise.allSettled([
    fetch("/api/pricing/rates").then((r) => r.json() as Promise<{ rates?: PublicRate[] }>),
    fetch("/api/promos/active").then((r) => r.json() as Promise<{ promo?: ActivePromo | null }>),
    // Both promos are asked for at once, so an entered code costs no latency.
    code
      ? fetch("/api/promos/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        }).then((r) => r.json() as Promise<{ valid?: boolean; promo?: ActivePromo | null }>)
      : Promise.resolve({ valid: false, promo: null }),
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
  const autoPromo: ActivePromo | null =
    promoRes.status === "fulfilled" ? (promoRes.value.promo ?? null) : null;
  const codePromo: ActivePromo | null =
    codeRes.status === "fulfilled" && codeRes.value.valid ? (codeRes.value.promo ?? null) : null;
  // Same precedence as resolvePromo on the server: a valid code wins, an
  // invalid one falls through rather than blocking the automatic promo. This is
  // the displayed figure only - /api/booking/request re-resolves the code
  // itself and prices from that, so a fabricated code buys nothing.
  const resolved: ActivePromo | null = codePromo ?? autoPromo;
  // A promo restricted to certain days is priced in only once a slot is picked,
  // because that is the appointment it has to be checked against. Before then it
  // is advertised but not applied, so the estimate never promises a discount the
  // booking will not honour.
  const promo = promoForAppointment(
    resolved,
    input.departureTimeIso ? new Date(input.departureTimeIso) : null,
  );
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
  // current rate instead of the shared fallback rate.
  const baseStandard =
    rates.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
    rates.find((r) => r.ratePerHour !== null)?.ratePerHour ??
    FALLBACK_BASE_RATE;
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

  const promoRate = applyPromoToHourlyRate(fullRate, promo);
  const effectiveMins = Math.max(minBillableMins, estimatedMins);
  const band = priceRangeFor(
    effectiveMins,
    promoRate,
    confidence,
    estimatorRange,
    lowEndFloorFactor,
  );
  const rawTravel = calcTravelCharge(
    travelMins,
    travelMinsBack,
    travelRatePerHour,
    minTravelCharge,
  );
  // Quote-level promo types act here, after the band and travel are priced.
  // The rate-based types already applied above and are a no-op at this stage.
  const discounted = applyPromoToQuote(
    { labourLow: band.low, labourHigh: band.high, travel: rawTravel },
    promo,
  );
  const travel = discounted.travel;
  // The labour band is the range shown to the customer; travel is a mostly fixed add-on on
  // its own line rather than folded in. The logged price below stays the all-in total, so
  // the booking snapshot is unchanged.
  const low = discounted.labourLow;
  const high = discounted.labourHigh;
  const totalLow = discounted.labourLow + travel;
  const totalHigh = discounted.labourHigh + travel;

  // Labour-time band from the same confidence factors that widen the price, rounded to
  // 5-min steps so the card's range ("15 - 30 min") lines up with the price range. Travel
  // is excluded - it's a price add-on, not on-site time.
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
