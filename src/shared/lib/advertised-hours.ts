// src/shared/lib/advertised-hours.ts
// The opening hours the business advertises. The site's JSON-LD and the Google Business Profile
// both read this, so search results and the Google listing can't disagree.

import type { AvailabilitySettings, IdentitySettings } from "@/shared/lib/settings/types";
import type { Weekday } from "@/shared/lib/timezone-utils";

/** One advertised day, with whole NZ-local hours. */
export interface AdvertisedDay {
  day: Weekday;
  open: number;
  close: number;
}

/** Listings show the week Monday first. */
const ADVERTISED_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/**
 * The advertised week: the days the schedule opens, each narrowed to the published-hours
 * override when one is set. Days track the real schedule; only the times can differ.
 * @param identity - Identity settings, for the published-hours override.
 * @param availability - Availability settings, for which days open and their real hours.
 * @returns One entry per open day, Monday first.
 */
export function advertisedHours(
  identity: Pick<IdentitySettings, "publishedHours">,
  availability: Pick<AvailabilitySettings, "schedule">,
): AdvertisedDay[] {
  const published = identity.publishedHours;
  return ADVERTISED_ORDER.filter((d) => availability.schedule[d].enabled).map((d) => ({
    day: d,
    open: published?.open ?? availability.schedule[d].open,
    close: published?.close ?? availability.schedule[d].close,
  }));
}
