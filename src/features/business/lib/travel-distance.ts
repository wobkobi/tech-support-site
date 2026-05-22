// src/features/business/lib/travel-distance.ts
/**
 * @file travel-distance.ts
 * @description One-way driving distance + duration lookup against the Google
 * Distance Matrix API, from HOME_ADDRESS to a free-text destination. Used
 * by /api/pricing/travel-time (returned to the public estimator) and the
 * parse-job route (folds the round trip into the invoice draft). Never
 * throws - returns null on any failure so the caller can decide whether
 * to skip the travel charge or surface an error.
 */

interface DistanceMatrixElement {
  status: string;
  duration: { value: number; text: string };
  distance: { value: number; text: string };
  // Present only when departure_time is set on the request - reflects Google's
  // best-guess traffic prediction at that time.
  duration_in_traffic?: { value: number; text: string };
}

interface DistanceMatrixResponse {
  status: string;
  rows: { elements: DistanceMatrixElement[] }[];
}

/**
 * Result of a successful lookup. Both fields are positive numbers.
 */
export interface DriveDistance {
  /** Drive duration in minutes (rounded). */
  durationMins: number;
  /** One-way distance in kilometres (one decimal). */
  distanceKm: number;
}

/**
 * Discriminated outcome from `lookupDriveDistance`. Lets callers distinguish
 * "the API or env is broken" (should surface to the operator) from
 * "we asked and got nothing" (charge $0 travel and move on).
 */
export type DriveDistanceResult =
  | { status: "ok"; data: DriveDistance }
  | { status: "no_match" } // API responded but couldn't resolve the address
  | { status: "misconfig" } // HOME_ADDRESS or Google Maps key missing
  | { status: "error" }; // Network / parse failure

/**
 * Looks up driving distance + duration from HOME_ADDRESS to the given
 * destination. Appends ", New Zealand" to the destination string so the
 * Distance Matrix API resolves NZ addresses reliably. When `departureTime`
 * is supplied, asks Google for traffic-aware duration at that time and
 * prefers `duration_in_traffic` over the free-flow `duration`.
 * @param destination - Free-text destination address (1-100 chars).
 * @param departureTime - Optional intended departure time for traffic-aware lookup.
 * @returns Discriminated result so callers can tell misconfig (operator
 *   error, should surface) from a legitimate no-match (charge $0 travel).
 */
export async function lookupDriveDistance(
  destination: string,
  departureTime?: Date,
): Promise<DriveDistanceResult> {
  const origin = process.env.HOME_ADDRESS;
  // Server-only key (no referrer restriction) preferred; falls back to the
  // client key when the split env isn't set up.
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!origin || !apiKey) return { status: "misconfig" };

  const trimmed = destination.trim().slice(0, 100);
  if (!trimmed) return { status: "no_match" };

  const fullDestination = `${trimmed}, New Zealand`;

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", fullDestination);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("units", "metric");

  // Distance Matrix only accepts departure_time in the future (or "now"). If
  // the caller asked for a past time, drop it and let Google use real-time.
  if (departureTime && departureTime.getTime() > Date.now()) {
    url.searchParams.set("departure_time", Math.floor(departureTime.getTime() / 1000).toString());
    url.searchParams.set("traffic_model", "best_guess");
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as DistanceMatrixResponse;
    const element = data?.rows?.[0]?.elements?.[0];
    if (element?.status !== "OK") return { status: "no_match" };

    // Prefer the traffic-aware duration when Google returned one; fall back
    // to free-flow duration otherwise. Google may omit duration_in_traffic
    // for far-future departure times outside its prediction horizon.
    const durationValue = element.duration_in_traffic?.value ?? element.duration?.value;
    const distanceValue = element.distance?.value;
    if (typeof durationValue !== "number" || typeof distanceValue !== "number") {
      return { status: "no_match" };
    }

    return {
      status: "ok",
      data: {
        durationMins: Math.round(durationValue / 60),
        distanceKm: Math.round((distanceValue / 1000) * 10) / 10,
      },
    };
  } catch (err) {
    console.error("[travel-distance] lookup failed:", err);
    return { status: "error" };
  }
}
