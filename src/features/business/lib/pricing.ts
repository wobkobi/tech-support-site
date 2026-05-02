import type {
  SelectedService,
  PriceRange,
  BreakdownLine,
  Urgency,
  DurationGuess,
} from "@/features/business/types/pricing";

const DURATION_RANGES: Record<NonNullable<DurationGuess>, [number, number]> = {
  quick: [20, 45],
  hour: [45, 90],
  "few-hours": [90, 240],
  unsure: [60, 180],
};

/**
 * Rounds a number down to the nearest 10.
 * @param n - Number to round
 * @returns Rounded value
 */
function roundDown10(n: number): number {
  return Math.floor(n / 10) * 10;
}

/**
 * Rounds a number up to the nearest 10.
 * @param n - Number to round
 * @returns Rounded value
 */
function roundUp10(n: number): number {
  return Math.ceil(n / 10) * 10;
}

/**
 * Calculates a price range estimate for selected services.
 * @param selectedServices - Services the customer selected
 * @param urgency - How urgently the job is needed
 * @param durationGuess - Estimated job duration
 * @param travelMins - One-way drive time in minutes (0 = no travel charge)
 * @param afterHoursRate - Hourly after-hours rate, or null if not applicable
 * @returns Price range with breakdown and flags
 */
export function calcPriceRange(
  selectedServices: SelectedService[],
  urgency: Urgency,
  durationGuess: DurationGuess,
  travelMins: number = 0,
  afterHoursRate: number | null = null,
): PriceRange {
  const breakdown: BreakdownLine[] = [];
  let totalLow = 0;
  let totalHigh = 0;
  let includesAfterHours = false;

  for (const service of selectedServices) {
    if (service.type === "flat" && service.flatRate !== null) {
      const low = service.flatRate;
      const high = Math.round(service.flatRate * 1.25);
      breakdown.push({ label: service.label, low, high, note: null });
      totalLow += low;
      totalHigh += high;
    } else if (service.type === "hourly" && service.ratePerHour !== null) {
      const [minMins, maxMins] = DURATION_RANGES[durationGuess ?? "unsure"];
      let rate = service.ratePerHour;

      if (urgency === "asap" && afterHoursRate !== null) {
        rate = afterHoursRate;
        includesAfterHours = true;
      }

      const low = roundDown10((minMins / 60) * rate);
      const high = roundUp10((maxMins / 60) * rate);
      const note =
        urgency === "asap" && afterHoursRate !== null ? "After-hours rate may apply" : null;
      breakdown.push({ label: service.label, low, high, note });
      totalLow += low;
      totalHigh += high;
    }
  }

  let includesTravel = false;

  if (travelMins > 0) {
    const hourlyRate =
      selectedServices.find((s) => s.type === "hourly" && s.ratePerHour !== null)?.ratePerHour ??
      65;
    const travelCost = Math.round((travelMins / 60) * hourlyRate);
    breakdown.push({
      label: `Travel (~${travelMins} min)`,
      low: travelCost,
      high: travelCost,
      note: null,
    });
    totalLow += travelCost;
    totalHigh += travelCost;
    includesTravel = true;
  }

  const low = roundDown10(totalLow);
  let high = roundUp10(totalHigh);

  if (high - low < 30) high = low + 30;

  return { low, high, breakdown, includesTravel, includesAfterHours };
}
