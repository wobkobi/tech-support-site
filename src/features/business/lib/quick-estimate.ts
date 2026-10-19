// src/features/business/lib/quick-estimate.ts
// Client-safe one-shot estimate for the booking form, using the /pricing wizard's endpoints
// and priceRangeFor so they stay in sync; logs it for the booking snapshot.

import { priceRangeFor, remoteRateDelta } from "@/features/business/lib/estimate-range";
import { calcTravelCharge, FALLBACK_BASE_RATE } from "@/features/business/lib/pricing-policy";
import {
  applyPromoToHourlyRate,
  applyPromoToQuote,
  normalisePromoCode,
  promoForAppointment,
  promoForSpend,
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
  /** Picked slot's start, so the drive matches the booking snapshot; omitted prices a typical weekday. */
  departureTimeIso?: string;
  /** End of the visit; the return leg is quoted from here. */
  returnDepartureTimeIso?: string;
  /** Weekend or public holiday labour uplift as a fraction (e.g. 0.1); omitted or 0 for none. */
  surchargeUplift?: number;
  /** Entered promo code; a valid one beats the automatic promo, an invalid one is ignored. */
  promoCode?: string | null;
  /** Booking email, so a per-customer code is judged as the booking will judge it. */
  email?: string | null;
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
 * Runs the full public-estimate flow (rates + promo + AI duration + travel + date surcharge),
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
  const email = input.email?.trim() || null;
  const startAt = input.departureTimeIso ?? null;

  const [ratesRes, promoRes, codeRes, travelRes, estimateRes] = await Promise.allSettled([
    fetch("/api/pricing/rates").then((r) => r.json() as Promise<{ rates?: PublicRate[] }>),
    fetch("/api/promos/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startAt, email }),
    }).then((r) => r.json() as Promise<{ promo?: ActivePromo | null }>),
    // Both promos are asked for at once, so an entered code costs no latency.
    code
      ? fetch("/api/promos/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, startAt, email }),
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
  // Same precedence as server resolvePromo. Display only: /api/booking/request re-resolves
  // the code, so a fabricated one buys nothing.
  const resolved: ActivePromo | null = codePromo ?? autoPromo;
  // Day-restricted promos apply only once a slot is picked, customer-limited ones only once
  // an email is entered, so the estimate never promises a discount the booking won't honour.
  const dateGated = promoForAppointment(resolved, startAt ? new Date(startAt) : null, {
    customerChecked: email != null,
  });
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

  // Live base + remote delta, resolved even when the AI duration call fails.
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

  const effectiveMins = Math.max(minBillableMins, estimatedMins);
  const rawTravel = calcTravelCharge(
    travelMins,
    travelMinsBack,
    travelRatePerHour,
    minTravelCharge,
  );
  // Price undiscounted first: spend thresholds and tiers are judged on its low end,
  // so the quoted discount is one the job is certain to reach.
  const undiscounted = priceRangeFor(
    effectiveMins,
    fullRate,
    confidence,
    estimatorRange,
    lowEndFloorFactor,
  );
  // Date surcharge: full-rate labour no promo discounts, counted towards the spend threshold
  // (calcJobTotal's order). Low rounds down, high up.
  const uplift = Math.max(0, input.surchargeUplift ?? 0);
  const surchargeLow = Math.floor(undiscounted.low * uplift);
  const surchargeHigh = Math.ceil(undiscounted.high * uplift);
  const promo = promoForSpend(dateGated, undiscounted.low + surchargeLow + rawTravel);

  const promoRate = applyPromoToHourlyRate(fullRate, promo, baseStandard);
  const band = priceRangeFor(
    effectiveMins,
    promoRate,
    confidence,
    estimatorRange,
    lowEndFloorFactor,
  );
  // Quote-level promo types apply here; rate-based ones already applied above.
  const discounted = applyPromoToQuote(
    { labourLow: band.low, labourHigh: band.high, travel: rawTravel },
    promo,
  );
  const travel = discounted.travel;
  // The customer sees the labour band with travel on its own line; the log keeps the all-in total.
  const low = discounted.labourLow + surchargeLow;
  const high = discounted.labourHigh + surchargeHigh;
  const totalLow = low + travel;
  const totalHigh = high + travel;

  // Labour-time band from the price's confidence factors, in 5-min steps; travel excluded.
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
