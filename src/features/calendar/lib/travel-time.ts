// src/features/calendar/lib/travel-time.ts
// Calculates public-transport travel time using the Google Maps Distance Matrix API.

import { prisma } from "@/shared/lib/prisma";

/**
 * Transit schedule data is only reliable within this many days from now.
 * Departures further out are proxied to the nearest matching day-of-week.
 */
const SCHEDULE_HORIZON_DAYS = 7;

/**
 * Departure time the transit API can use: beyond {@link SCHEDULE_HORIZON_DAYS},
 * the nearest upcoming date with the same UTC weekday and time-of-day.
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

  // If the candidate is still in the past, bump forward a week
  if (candidate.getTime() <= now.getTime() + 60 * 60 * 1000) {
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  }

  return candidate;
}

/** Valid Google Distance Matrix travel modes. */
export type TransportMode = "transit" | "driving" | "walking" | "bicycling";

/** Setting key holding origin|destination|mode pairs Distance Matrix cannot route. */
const UNROUTABLE_KEY = "travel:unroutable";

/** How long a "no route" verdict stands before the pair is tried again. */
const UNROUTABLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Per-process copy of the unroutable set. Without it the twice-hourly refresh
 * re-queries dead routes (4 failing legs = ~192 wasted calls a day).
 */
let unroutable: Record<string, string> | null = null;

/**
 * Identity of a route lookup, independent of when it was asked.
 * @param origin - Start address.
 * @param destination - End address.
 * @param mode - Transport mode.
 * @returns Stable key for the pair.
 */
function routeKey(origin: string, destination: string, mode: TransportMode): string {
  return `${origin.trim().toLowerCase()}|${destination.trim().toLowerCase()}|${mode}`;
}

/**
 * Whether this pair failed to route recently enough to skip retrying.
 * @param key - Route key from {@link routeKey}.
 * @returns True when a fresh "no route" verdict stands.
 */
async function isKnownUnroutable(key: string): Promise<boolean> {
  if (unroutable === null) {
    try {
      const row = await prisma.setting.findUnique({ where: { key: UNROUTABLE_KEY } });
      const parsed: unknown = row ? JSON.parse(row.value) : {};
      unroutable =
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, string>)
          : {};
    } catch {
      // Never let a cache read stop a real lookup.
      unroutable = {};
    }
  }
  const at = unroutable[key];
  return at !== undefined && Date.now() - new Date(at).getTime() < UNROUTABLE_TTL_MS;
}

/**
 * Records that Distance Matrix cannot route this pair, dropping stale entries
 * so an address the operator has since corrected is retried.
 * @param key - Route key from {@link routeKey}.
 */
async function rememberUnroutable(key: string): Promise<void> {
  const now = Date.now();
  const next: Record<string, string> = {
    ...(unroutable ?? {}),
    [key]: new Date(now).toISOString(),
  };
  for (const [k, at] of Object.entries(next)) {
    if (now - new Date(at).getTime() >= UNROUTABLE_TTL_MS) delete next[k];
  }
  unroutable = next;
  try {
    const value = JSON.stringify(next);
    await prisma.setting.upsert({
      where: { key: UNROUTABLE_KEY },
      create: { key: UNROUTABLE_KEY, value },
      update: { value },
    });
  } catch {
    // In-process copy still spares the retries for this instance's lifetime.
  }
}

/**
 * Travel time in minutes (ceiling), traffic-aware for driving. Google ignores
 * arrival_time for driving, so arrive-by drives are iterated (see below).
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
  // Server-only key; GOOGLE_MAPS_API_KEY is published to the browser, so no fallback.
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    console.warn("[travel-time] No GOOGLE_MAPS_SERVER_KEY set - skipping travel time calculation");
    return null;
  }
  // TS drops the narrowing inside the query() closure, so capture it.
  const key = apiKey;

  const mode: TransportMode = options?.mode ?? "driving";
  const wantArrival = options?.useArrivalTime === true;
  // Google rejects a past anchor, so a past job is priced at a near-future proxy.
  const anchor =
    departureTime.getTime() > Date.now() ? departureTime : new Date(Date.now() + 30 * 60_000);

  /**
   * One Distance Matrix lookup at a fixed anchor time, traffic-aware when available.
   * @param timeParam - Which time anchor to send.
   * @param epochSeconds - The anchor as a Unix timestamp (seconds).
   * @returns Travel minutes (ceiling), or null on failure.
   */
  async function query(
    timeParam: "arrival_time" | "departure_time",
    epochSeconds: number,
  ): Promise<number | null> {
    const key0 = routeKey(origin, destination, mode);
    if (await isKnownUnroutable(key0)) return null;

    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    url.searchParams.set("origins", origin);
    url.searchParams.set("destinations", destination);
    url.searchParams.set("mode", mode);
    url.searchParams.set(timeParam, Math.floor(epochSeconds).toString());
    // best_guess, not pessimistic: travelRoundBufferMin already pads for bad runs.
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
            // Present for driving with a future departure_time.
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
        const status = element?.status ?? "missing";
        // ZERO_RESULTS and NOT_FOUND are address faults that never recover on
        // retry; other element errors stay retryable.
        console.warn(`[travel-time] Element status: ${status} for "${origin}" > "${destination}"`);
        if (status === "ZERO_RESULTS" || status === "NOT_FOUND") {
          await rememberUnroutable(key0);
        }
        return null;
      }

      // Traffic-aware prediction first, free-flow duration as fallback.
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

  // Driving arrive-by: price leaving AT the arrival, then re-price leaving that many
  // minutes earlier so traffic matches. Clamped ahead of now (no past departure_time).
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
