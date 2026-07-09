// src/features/business/lib/travel-distance.ts
/**
 * @description Round-trip driving distance + duration lookup against the
 * Google Distance Matrix API: base address > destination at the departure
 * time, destination > base address at the return time, both traffic-aware.
 * Used by /api/pricing/travel-time (public estimator + calculator), the
 * parse-job route, the booking snapshot, and the late-cancel invoice. Never
 * throws - returns a discriminated status so the caller can decide whether
 * to skip the travel charge or surface an error.
 */

import { getIdentity } from "@/shared/lib/business-identity.server";

interface DistanceMatrixElement {
  status: string;
  duration: { value: number; text: string };
  distance: { value: number; text: string };
  // Present only when departure_time is set on the request - reflects Google's
  // traffic prediction at that time.
  duration_in_traffic?: { value: number; text: string };
}

interface DistanceMatrixResponse {
  status: string;
  rows: { elements: DistanceMatrixElement[] }[];
}

/**
 * Result of a successful one-leg lookup. Both fields are positive numbers.
 */
export interface DriveDistance {
  /** Drive duration in minutes (rounded). */
  durationMins: number;
  /** One-way distance in kilometres (one decimal). */
  distanceKm: number;
}

/** Both legs of a round trip, each quoted at its own departure time. */
export interface DriveRoundTrip {
  /** Base address > destination at the outbound departure time. */
  there: DriveDistance;
  /** Destination > base address at the return departure time. */
  back: DriveDistance;
}

/**
 * Discriminated outcome from {@link lookupDriveRoundTrip}. Lets callers
 * distinguish "the API or env is broken" (should surface to the operator)
 * from "we asked and got nothing" (charge $0 travel and move on).
 */
export type DriveRoundTripResult =
  | { status: "ok"; data: DriveRoundTrip }
  | { status: "no_match" } // API responded but couldn't resolve the address
  | { status: "misconfig" } // Base address or Google Maps key missing
  | { status: "error" }; // Network / parse failure

/** Internal per-leg result reusing the round-trip statuses. */
type LegResult = { status: "ok"; data: DriveDistance } | { status: "no_match" | "error" };

/** Fallback return departure when the caller supplies none: one billable hour. */
const DEFAULT_JOB_DURATION_MS = 60 * 60 * 1000;

/**
 * One Distance Matrix call for a single leg, traffic-aware.
 * best_guess model: Google's most-likely duration for that departure time.
 * (Pessimistic was trialled and over-quoted rush-hour legs by ~50%; free-flow
 * with no departure_time under-quoted. best_guess tracked real trips closest.)
 * @param origin - Leg origin address.
 * @param destination - Leg destination address.
 * @param apiKey - Google Maps server key.
 * @param departMs - Epoch ms departure; caller has already clamped it to the future.
 * @returns One leg's duration + distance, or a failure status.
 */
async function lookupLeg(
  origin: string,
  destination: string,
  apiKey: string,
  departMs: number,
): Promise<LegResult> {
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("units", "metric");
  url.searchParams.set("departure_time", Math.floor(departMs / 1000).toString());
  url.searchParams.set("traffic_model", "best_guess");

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
    console.error("[travel-distance] leg lookup failed:", err);
    return { status: "error" };
  }
}

/**
 * Looks up both legs of the drive between the business base address and the
 * given destination. Appends ", New Zealand" to the destination string so the
 * Distance Matrix API resolves NZ addresses reliably. Always traffic-aware:
 * each leg quotes Google's pessimistic prediction at its own departure time.
 * A missing or past `departAt` means "leaving about now"; a missing
 * `returnAt` defaults to one billable hour after departure (the estimators'
 * fallback job length) and is clamped to never precede the outbound leg.
 * When the outbound leg resolves but the return leg fails, the return
 * mirrors the outbound figures - the same symmetric assumption the old
 * single-lookup doubling made, so a flaky second call can never quote worse.
 * @param destination - Free-text destination address (1-100 chars).
 * @param departAt - Outbound departure time; omitted or past means now.
 * @param returnAt - Return departure time; omitted means departure + 60 min.
 * @returns Discriminated result so callers can tell misconfig (operator
 *   error, should surface) from a legitimate no-match (charge $0 travel).
 */
export async function lookupDriveRoundTrip(
  destination: string,
  departAt?: Date,
  returnAt?: Date,
): Promise<DriveRoundTripResult> {
  // Travel origin is the unified business base address (defaults to HOME_ADDRESS env).
  const origin = (await getIdentity()).baseAddress.line || process.env.HOME_ADDRESS;
  // Server-only key (no referrer restriction) preferred; falls back to the
  // client key when the split env isn't set up.
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!origin || !apiKey) return { status: "misconfig" };

  const trimmed = destination.trim().slice(0, 100);
  if (!trimmed) return { status: "no_match" };

  const fullDestination = `${trimmed}, New Zealand`;

  // Distance Matrix only accepts a future departure_time, and without one
  // Google omits duration_in_traffic entirely - the quote would silently
  // degrade to free-flow times. Clamp both legs to the future and keep the
  // return leg at or after the outbound one.
  const departMs = Math.max(departAt?.getTime() ?? 0, Date.now() + 60_000);
  const returnMs = returnAt
    ? Math.max(returnAt.getTime(), departMs)
    : departMs + DEFAULT_JOB_DURATION_MS;

  const [there, back] = await Promise.all([
    lookupLeg(origin, fullDestination, apiKey, departMs),
    lookupLeg(fullDestination, origin, apiKey, returnMs),
  ]);

  // Outbound failure keeps its own status - same semantics as the old
  // single-leg lookup, so callers' error handling is unchanged.
  if (there.status !== "ok") return { status: there.status };

  return {
    status: "ok",
    data: {
      there: there.data,
      back: back.status === "ok" ? back.data : there.data,
    },
  };
}
