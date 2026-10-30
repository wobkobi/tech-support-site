// scripts/check-quick-estimate.ts
// The booking form's estimate: the AI's minutes priced into a band at the promo rate plus the
// date surcharge, and an Extended session picked on purpose lifting the band to cover it.
// Network calls are stubbed, so this runs offline.
// Run with: npm test -- quick-estimate

import type { ActivePromo } from "@/features/business/lib/promos";
import {
  fetchQuickEstimate,
  type QuickEstimateInput,
} from "@/features/business/lib/quick-estimate";
import type { PublicRate } from "@/features/business/types/pricing";
import { expectEqual, finish } from "./lib/harness.js";

const RATES: PublicRate[] = [
  {
    label: "Standard",
    ratePerHour: 100,
    flatRate: null,
    hourlyDelta: null,
    unit: "hour",
    isDefault: true,
  },
  {
    label: "Remote",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -25,
    unit: "modifier",
    isDefault: false,
  },
];

const FLAT_65: ActivePromo = {
  id: "promo",
  title: "Current rates locked in",
  description: null,
  startAt: "2026-01-01T00:00:00.000Z",
  endAt: "2027-01-01T00:00:00.000Z",
  kind: "automatic",
  code: null,
  discountType: "flat_hourly",
  flatHourlyRate: 65,
  percentDiscount: null,
  fixedAmount: null,
  travelPercent: null,
  minSpend: null,
  tiers: [],
  activeWeekdays: [],
  activeFromMinute: null,
  activeToMinute: null,
};

/**
 * Answers the estimate flow's requests with fixed bodies: the AI's two tasks at medium
 * confidence, a short drive and the $65 promo.
 * @param url - The requested path.
 * @returns A response carrying the stub body.
 */
async function stubFetch(url: string | URL | Request): Promise<Response> {
  const path = String(url);
  const body: Record<string, unknown> = path.includes("/api/pricing/rates")
    ? { rates: RATES }
    : path.includes("/api/promos/active")
      ? { promo: FLAT_65 }
      : path.includes("/api/pricing/travel-time")
        ? { durationMinsThere: 7, durationMinsBack: 7 }
        : path.includes("/api/pricing/estimate-duration")
          ? {
              ok: true,
              result: {
                estimatedMins: 70,
                confidence: "medium",
                explanation: "",
                tasks: [
                  { label: "Modem setup", mins: 45 },
                  { label: "Family apps and controls setup", mins: 25 },
                ],
              },
            }
          : { id: "estimate" };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

/** Bobbie's booking: in person, 7pm Thursday (after hours, $10/hr), live pricing settings. */
const BOBBIE: QuickEstimateInput = {
  description: "Set up a new modem and parental controls",
  meeting: "in-person",
  address: "1 Queen Street, Auckland",
  estimatorRange: {
    high: { lowFactor: 0.85, highFactor: 1.2 },
    medium: { lowFactor: 0.7, highFactor: 1.35 },
    low: { lowFactor: 0.55, highFactor: 1.6 },
    minSpread: 20,
  },
  minBillableMins: 30,
  minTravelCharge: 10,
  travelRatePerHour: 40,
  lowEndFloorFactor: 0.75,
  departureTimeIso: "2026-10-30T06:00:00.000Z",
  returnDepartureTimeIso: "2026-10-30T08:00:00.000Z",
  surchargePerHour: 10,
};

/** Runs every estimate fixture and reports the tally. */
async function main(): Promise<void> {
  console.log("quick estimate fixtures\n");
  globalThis.fetch = stubFetch as typeof fetch;

  // $55 - $105 for 70 min at $65, plus $9 - $16 of the $10/hr surcharge.
  const standard = await fetchQuickEstimate(BOBBIE);
  expectEqual(
    "Standard session prices the AI's 70 min",
    [standard.low, standard.high, standard.travelCharge],
    [64, 121, 10],
  );

  // $100 - $180 for 120 min at $65, plus $15 - $27 of surcharge.
  const extended = await fetchQuickEstimate({ ...BOBBIE, bookedMins: 120 });
  expectEqual(
    "Extended session lifts the band to cover 2 hours",
    [extended.low, extended.high, extended.travelCharge],
    [115, 207, 10],
  );
  expectEqual("the AI's own minutes are still reported", extended.estimatedMins, 70);

  const shortBooked = await fetchQuickEstimate({ ...BOBBIE, bookedMins: 60 });
  expectEqual(
    "a booked length under the estimate changes nothing",
    [shortBooked.low, shortBooked.high],
    [standard.low, standard.high],
  );

  finish();
}

void main();
