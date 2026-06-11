// src/features/calendar/lib/travel-time.ts
/**
 * @file travel-time.ts
 * @description Calculates public-transport travel time using the Google Maps Distance Matrix API.
 */

/**
 * Transit schedule data is only reliable within this many days from now.
 * Departures further out are proxied to the nearest matching day-of-week.
 */
const SCHEDULE_HORIZON_DAYS = 7;

/**
 * Returns a departure time the Distance Matrix transit API can reliably use.
 * If {@link departureTime} is more than {@link SCHEDULE_HORIZON_DAYS} in the future,
 * returns the nearest upcoming date with the same UTC day-of-week and time-of-day,
 * preserving weekday vs. weekend transit patterns without using a date whose
 * schedule data is not yet published.
 * @param departureTime - The intended departure time.
 * @param now - Current time reference.
 * @returns A departure time within the reliable scheduling horizon.
 */
function toReliableDeparture(departureTime: Date, now: Date): Date {
  const msAhead = departureTime.getTime() - now.getTime();
  if (msAhead <= SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000) {
    return departureTime;
  }

  const targetDow = departureTime.getUTCDay();

  // Start from tomorrow so the candidate never lands on today-already-passed
  const candidate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  candidate.setUTCHours(departureTime.getUTCHours(), departureTime.getUTCMinutes(), 0, 0);

  // Advance to the next day whose UTC day-of-week matches the target
  const daysToAdd = (targetDow - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysToAdd);

  // Safety: if the candidate somehow landed in the past (e.g. time-of-day
  // already passed today), bump forward a full week
  if (candidate.getTime() <= now.getTime() + 60 * 60 * 1000) {
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  }

  return candidate;
}

/** Valid Google Distance Matrix travel modes. */
export type TransportMode = "transit" | "driving" | "walking" | "bicycling";

/**
 * Travel time between two addresses, in minutes (ceiling).
 * Transit lookups beyond {@link SCHEDULE_HORIZON_DAYS} snap to the nearest
 * same-day-of-week within range so schedule data is available.
 * @param origin - Starting address or coordinates.
 * @param destination - Destination address or coordinates.
 * @param departureTime - Departure (or arrival) time for transit schedule lookup.
 * @param options - Optional flags.
 * @param options.useArrivalTime - When true, uses arrival_time instead of departure_time.
 * @param options.mode - Travel mode (default: "transit").
 * @returns Travel time in minutes, or null on misconfig / failure.
 */
export async function calculateTravelMinutes(
  origin: string,
  destination: string,
  departureTime: Date,
  options?: { useArrivalTime?: boolean; mode?: TransportMode },
): Promise<number | null> {
  // Server-only key (no referrer restriction) is preferred for Distance Matrix
  // calls; falls back to the client key when running in dev without the split.
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn(
      "[travel-time] No GOOGLE_MAPS_SERVER_KEY or GOOGLE_MAPS_API_KEY set - skipping travel time calculation",
    );
    return null;
  }

  const mode: TransportMode = options?.mode ?? "driving";
  // Only apply the schedule-horizon proxy for transit - driving/walking/cycling don't need it
  const effectiveDeparture =
    mode === "transit" ? toReliableDeparture(departureTime, new Date()) : departureTime;

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("mode", mode);
  // arrival_time is only supported for transit mode
  const timeParam =
    options?.useArrivalTime && mode === "transit" ? "arrival_time" : "departure_time";
  url.searchParams.set(timeParam, Math.floor(effectiveDeparture.getTime() / 1000).toString());
  url.searchParams.set("key", apiKey);

  try {
    // 8s ceiling so a hung Distance Matrix call can't block booking renders.
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error(`[travel-time] Distance Matrix API HTTP error: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      status: string;
      rows: Array<{
        elements: Array<{
          status: string;
          duration: { value: number }; // seconds
        }>;
      }>;
    };

    if (data.status !== "OK") {
      console.warn(`[travel-time] Distance Matrix API status: ${data.status}`);
      return null;
    }

    const element = data.rows[0]?.elements[0];
    if (!element || element.status !== "OK") {
      console.warn(`[travel-time] Element status: ${element?.status ?? "missing"}`);
      return null;
    }

    return Math.ceil(element.duration.value / 60);
  } catch (error) {
    console.error("[travel-time] Failed to calculate travel time:", error);
    return null;
  }
}
