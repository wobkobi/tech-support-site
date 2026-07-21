// src/features/calendar/lib/travel-time.ts
/**
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
 * Travel time between two addresses, in minutes (ceiling). Driving lookups use
 * Google's traffic prediction (duration_in_traffic) for the sampled departure.
 * Arrive-by (useArrivalTime) differs by mode: Distance Matrix supports
 * arrival_time only for TRANSIT; for DRIVING Google ignores it, so the drive
 * is priced departing AT the target arrival, then re-priced departing that
 * many minutes earlier so the sampled traffic matches the real leave time.
 * @param origin - Starting address or coordinates.
 * @param destination - Destination address or coordinates.
 * @param departureTime - Departure time, or the target arrival when useArrivalTime is set.
 * @param options - Optional flags.
 * @param options.useArrivalTime - Treat departureTime as the target arrival, not the departure.
 * @param options.mode - Travel mode (default: "driving").
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
  // apiKey is a string past the guard, but TS won't carry that narrowing into the
  // nested query() closure, so capture the narrowed value here.
  const key = apiKey;

  const mode: TransportMode = options?.mode ?? "driving";
  const wantArrival = options?.useArrivalTime === true;
  // Google rejects a past time anchor. A retained past job (kept on the schedule for
  // the record) is priced at a near-future proxy - drive time between fixed points
  // barely changes - so its block still gets a sensible length.
  const anchor =
    departureTime.getTime() > Date.now() ? departureTime : new Date(Date.now() + 30 * 60_000);

  /**
   * One Distance Matrix lookup at a fixed anchor time. Prefers Google's
   * traffic-aware prediction (driving + departure_time) over free-flow duration.
   * @param timeParam - Which time anchor to send.
   * @param epochSeconds - The anchor as a Unix timestamp (seconds).
   * @returns Travel minutes (ceiling), or null on failure.
   */
  async function query(
    timeParam: "arrival_time" | "departure_time",
    epochSeconds: number,
  ): Promise<number | null> {
    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    url.searchParams.set("origins", origin);
    url.searchParams.set("destinations", destination);
    url.searchParams.set("mode", mode);
    url.searchParams.set(timeParam, Math.floor(epochSeconds).toString());
    // best_guess traffic for driving: Google's most-likely duration for the
    // departure time. The settings travelRoundBufferMin already pads blocks for
    // bad runs, so pessimistic on top double-counted the safety margin.
    // traffic_model is only valid for driving departure lookups.
    if (mode === "driving" && timeParam === "departure_time") {
      url.searchParams.set("traffic_model", "best_guess");
    }
    url.searchParams.set("key", key);

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
            // Present for driving lookups with a future departure_time -
            // Google's traffic prediction for that time.
            duration_in_traffic?: { value: number };
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

      // Prefer the traffic-aware prediction when Google returned one; free-flow
      // duration is the fallback. The settings travel-round buffer pads on top.
      const seconds = element.duration_in_traffic?.value ?? element.duration.value;
      return Math.ceil(seconds / 60);
    } catch (error) {
      console.error("[travel-time] Failed to calculate travel time:", error);
      return null;
    }
  }

  // Transit supports arrival_time directly; snap far-future departures onto a
  // date whose schedule data is published.
  if (mode === "transit") {
    const effective = toReliableDeparture(anchor, new Date());
    return query(wantArrival ? "arrival_time" : "departure_time", effective.getTime() / 1000);
  }

  // Driving "arrive by": Google ignores arrival_time for driving, so iterate the
  // departure. Price the drive departing AT the target arrival (rough), then
  // re-price departing that many minutes earlier so the sampled traffic is for
  // when you'd actually set off. Clamp to just ahead of now - Distance Matrix
  // rejects a past departure_time (imminent jobs).
  if (mode === "driving" && wantArrival) {
    const targetSec = anchor.getTime() / 1000;
    const rough = await query("departure_time", targetSec);
    if (rough === null) return null;
    const departSec = Math.max(targetSec - rough * 60, Date.now() / 1000 + 60);
    return (await query("departure_time", departSec)) ?? rough;
  }

  // Driving depart-at, walking, cycling: a single lookup at the departure time.
  return query("departure_time", anchor.getTime() / 1000);
}
