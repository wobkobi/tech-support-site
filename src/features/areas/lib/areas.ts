// src/features/areas/lib/areas.ts
// Pure helpers for the /areas page: region anchors, which suburbs get travel figures, and
// the travel figure itself. Client-safe, so the suburb check prices exactly like the page.

import { calcTravelCharge } from "@/features/business/lib/pricing-policy";
import { roundCents } from "@/shared/lib/money";
import type { SuburbGroup } from "@/shared/lib/served-suburbs";

/** A travel charge before and after any promo travel discount. */
export interface TravelFigure {
  /** Average of the two legs, so "N min each way" matches the round-trip charge. */
  eachWayMins: number;
  /** Standard round-trip charge. */
  full: number;
  /** What is actually charged once a travel promo applies; equals `full` without one. */
  charged: number;
}

/**
 * Anchor id for a region ("East Auckland" > "east-auckland"). Macrons fold to plain
 * letters so the id stays ASCII; a group with no region heading is "other-areas".
 * @param region - Region heading from the served-suburbs setting, or null.
 * @returns A lowercase, hyphenated anchor id.
 */
export function regionSlug(region: string | null): string {
  const slug = (region ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "other-areas";
}

/**
 * The suburbs that get a travel figure: the first few as listed, so reordering the
 * "Served suburbs" setting chooses them.
 * @param group - One region's suburbs.
 * @param count - How many to take.
 * @returns Up to `count` suburb names.
 */
export function commonSuburbs(group: SuburbGroup, count = 3): string[] {
  return group.suburbs.slice(0, count);
}

/**
 * Round-trip travel charge for known drive times, the same maths invoices use, with a
 * promo's travel factor applied on top like the price estimator does.
 * @param thereMins - Outbound drive minutes.
 * @param backMins - Return drive minutes.
 * @param travelRatePerHour - Live travel rate.
 * @param minTravelCharge - Live travel minimum.
 * @param travelFactor - Promo travel factor (1 = no promo, 0 = free travel).
 * @returns The figure, or null when there are no drive minutes (address not resolved).
 */
export function travelFigure(
  thereMins: number,
  backMins: number,
  travelRatePerHour: number,
  minTravelCharge: number,
  travelFactor: number,
): TravelFigure | null {
  if (thereMins + backMins <= 0) return null;
  const full = calcTravelCharge(thereMins, backMins, travelRatePerHour, minTravelCharge);
  return {
    eachWayMins: Math.round((thereMins + backMins) / 2),
    full,
    charged: roundCents(full * travelFactor),
  };
}
