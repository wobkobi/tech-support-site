// src/features/areas/lib/area-travel.server.ts
// Drive times for the /areas common-suburb figures, cached for a day so the page never
// spends a Distance Matrix lookup per visit.

import "server-only";

import {
  lookupDriveRoundTrip,
  representativeDepartureTime,
} from "@/features/business/lib/travel-distance";
import { SETTINGS_TAG } from "@/shared/lib/settings/get-settings";
import { unstable_cache } from "next/cache";

/** Both drive legs for one suburb, in minutes. */
export interface SuburbTravel {
  thereMins: number;
  backMins: number;
}

/**
 * Round-trip drive minutes from the base address to a suburb, at the same weekday hour the
 * public travel check quotes. Cached per suburb for a day; a settings save clears it, since
 * the base address lives there.
 * @param suburb - Suburb name from the served-suburbs setting.
 * @param quoteHour - NZ-local hour to price traffic at (scheduling.travelQuoteHour).
 * @returns Drive minutes, or null when the suburb can't be routed or the lookup is down.
 */
export async function getSuburbTravel(
  suburb: string,
  quoteHour: number,
): Promise<SuburbTravel | null> {
  const lookup = unstable_cache(
    async (): Promise<SuburbTravel | null> => {
      const depart = representativeDepartureTime(quoteHour);
      const result = await lookupDriveRoundTrip(
        `${suburb}, Auckland`,
        depart,
        new Date(depart.getTime() + 60 * 60 * 1000),
      );
      // Throw on outages so unstable_cache doesn't store them; only "can't route" caches as null.
      if (result.status === "misconfig" || result.status === "error") {
        throw new Error(`area travel lookup ${result.status} for ${suburb}`);
      }
      if (result.status === "no_match") return null;
      return {
        thereMins: result.data.there.durationMins,
        backMins: result.data.back.durationMins,
      };
    },
    ["area-travel", suburb.toLowerCase(), String(quoteHour)],
    { revalidate: 86_400, tags: [SETTINGS_TAG] },
  );
  try {
    return await lookup();
  } catch (err) {
    console.warn("[areas]", err instanceof Error ? err.message : err);
    return null;
  }
}
