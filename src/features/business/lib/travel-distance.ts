// src/features/business/lib/travel-distance.ts
// Round-trip drive distance and duration via Google Distance Matrix, each leg traffic-aware
// at its own departure time. Never throws; returns a discriminated status.

import { getIdentity } from "@/shared/lib/business-identity.server";

interface DistanceMatrixElement {
  status: string;
  duration: { value: number; text: string };
  distance: { value: number; text: string };
  // Present only when the request sets departure_time.
  duration_in_traffic?: { value: number; text: string };
}

interface DistanceMatrixResponse {
  status: string;
  rows: { elements: DistanceMatrixElement[] }[];
}

/** Result of a successful one-leg lookup. */
interface DriveDistance {
  /** Drive duration in minutes (rounded). */
  durationMins: number;
  /** One-way distance in kilometres (one decimal). */
  distanceKm: number;
}

/** Both legs of a round trip, each quoted at its own departure time. */
interface DriveRoundTrip {
  /** Base address > destination at the outbound departure time. */
  there: DriveDistance;
  /** Destination > base address at the return departure time. */
  back: DriveDistance;
}

/**
 * Outcome from {@link lookupDriveRoundTrip}: misconfig/error should surface to the
 * operator; no_match means charge $0 travel.
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
 * One Distance Matrix leg. With a departure time it uses best_guess traffic (pessimistic
 * over-quoted rush hour by ~50%); without one, the same address always gives the same route.
 * @param origin - Leg origin address.
 * @param destination - Leg destination address.
 * @param apiKey - Google Maps server key.
 * @param departMs - Epoch ms departure, already clamped to the future; null for no traffic.
 * @returns One leg's duration + distance, or a failure status.
 */
async function lookupLeg(
  origin: string,
  destination: string,
  apiKey: string,
  departMs: number | null,
): Promise<LegResult> {
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("units", "metric");
  if (departMs !== null) {
    url.searchParams.set("departure_time", Math.floor(departMs / 1000).toString());
    url.searchParams.set("traffic_model", "best_guess");
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as DistanceMatrixResponse;
    const element = data?.rows?.[0]?.elements?.[0];
    if (element?.status !== "OK") return { status: "no_match" };

    // Google omits duration_in_traffic beyond its prediction horizon; fall back to free-flow.
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
 * The base address, server Maps key and NZ-suffixed destination, or a failure status.
 * @param destination - Free-text destination address.
 * @returns The lookup inputs, or a failure status.
 */
async function roundTripInputs(
  destination: string,
): Promise<
  | { status: "ok"; origin: string; apiKey: string; fullDestination: string }
  | { status: "misconfig" | "no_match" }
> {
  // Travel origin is the unified business base address (defaults to HOME_ADDRESS env).
  const origin = (await getIdentity()).baseAddress.line || process.env.HOME_ADDRESS;
  // No fallback to GOOGLE_MAPS_API_KEY: next.config.ts publishes that one to the browser.
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!origin || !apiKey) return { status: "misconfig" };

  const trimmed = destination.trim().slice(0, 100);
  if (!trimmed) return { status: "no_match" };
  return { status: "ok", origin, apiKey, fullDestination: `${trimmed}, New Zealand` };
}

/**
 * Combines two legs. A failed return leg mirrors the outbound, so a flaky second call
 * can never quote worse.
 * @param there - Base > destination leg.
 * @param back - Destination > base leg.
 * @returns The round trip, or the outbound leg's failure status.
 */
function roundTripFrom(there: LegResult, back: LegResult): DriveRoundTripResult {
  if (there.status !== "ok") return { status: there.status };
  return {
    status: "ok",
    data: { there: there.data, back: back.status === "ok" ? back.data : there.data },
  };
}

/**
 * Looks up both traffic-aware legs between the base address and a destination. The
 * return is clamped to never precede the outbound.
 * @param destination - Free-text destination address (1-100 chars).
 * @param departAt - Outbound departure time; omitted or past means now.
 * @param returnAt - Return departure time; omitted means departure + 60 min.
 * @returns Discriminated result: misconfig, no_match, error or ok.
 */
export async function lookupDriveRoundTrip(
  destination: string,
  departAt?: Date,
  returnAt?: Date,
): Promise<DriveRoundTripResult> {
  const inputs = await roundTripInputs(destination);
  if (inputs.status !== "ok") return inputs;
  const { origin, apiKey, fullDestination } = inputs;

  // Distance Matrix needs a future departure_time or it silently drops traffic; clamp forward.
  const departMs = Math.max(departAt?.getTime() ?? 0, Date.now() + 60_000);
  const returnMs = returnAt
    ? Math.max(returnAt.getTime(), departMs)
    : departMs + DEFAULT_JOB_DURATION_MS;

  const [there, back] = await Promise.all([
    lookupLeg(origin, fullDestination, apiKey, departMs),
    lookupLeg(fullDestination, origin, apiKey, returnMs),
  ]);
  return roundTripFrom(there, back);
}

/**
 * Round-trip km with no departure time, so an address always gives the same km (for the
 * IRD km log). Durations are free-flow; not for quoting drive time.
 * @param destination - Free-text destination address (1-100 chars).
 * @returns Discriminated result, the same statuses as {@link lookupDriveRoundTrip}.
 */
export async function lookupRoundTripDistance(destination: string): Promise<DriveRoundTripResult> {
  const inputs = await roundTripInputs(destination);
  if (inputs.status !== "ok") return inputs;
  const { origin, apiKey, fullDestination } = inputs;
  const [there, back] = await Promise.all([
    lookupLeg(origin, fullDestination, apiKey, null),
    lookupLeg(fullDestination, origin, apiKey, null),
  ]);
  return roundTripFrom(there, back);
}

/**
 * Looks up a mid-job store run (client > store > client), both legs leaving about now.
 * Same statuses as {@link lookupDriveRoundTrip}.
 * @param from - The client's address.
 * @param store - The store, by name and branch or by address.
 * @returns Discriminated result; "there" is client > store, "back" is store > client.
 */
export async function lookupStoreRun(from: string, store: string): Promise<DriveRoundTripResult> {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) return { status: "misconfig" };
  const origin = from.trim().slice(0, 100);
  const stop = store.trim().slice(0, 100);
  if (!origin || !stop) return { status: "no_match" };
  const fullOrigin = `${origin}, New Zealand`;
  const fullStop = `${stop}, New Zealand`;
  const departMs = Date.now() + 60_000;
  const [there, back] = await Promise.all([
    lookupLeg(fullOrigin, fullStop, apiKey, departMs),
    lookupLeg(fullStop, fullOrigin, apiKey, departMs),
  ]);
  return roundTripFrom(there, back);
}
