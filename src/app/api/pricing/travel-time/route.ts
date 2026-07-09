// src/app/api/pricing/travel-time/route.ts
/**
 * @description Public, rate-limited travel-time endpoint. POST looks up both
 * legs of the drive between the base address and a destination via
 * {@link lookupDriveRoundTrip} - outbound at `departureTimeIso`, return at
 * `returnDepartureTimeIso` - each traffic-aware. Returns zero durations for
 * no match, 503 on misconfig, and 502 on upstream errors. Each request costs
 * two Google Distance Matrix elements (one per leg); the 5/min rate limit
 * keeps that within quota.
 */

import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * Parses an optional ISO timestamp body field into a Date.
 * @param value - Raw body value.
 * @returns Parsed Date, or undefined when missing/malformed.
 */
function parseIsoField(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * POST /api/pricing/travel-time - Both drive legs between the base address
 * and a destination. Optional `departureTimeIso` / `returnDepartureTimeIso`
 * pin each leg's traffic prediction; malformed/missing values fall back to
 * "now" and "departure + 60 min" respectively.
 * @param request - Body: `{ destination: string, departureTimeIso?: string, returnDepartureTimeIso?: string }`.
 * @returns `{ ok: true, durationMinsThere, durationMinsBack, distanceKm }` on
 *   success (distanceKm is the outbound leg), zero durations when
 *   unresolvable, and `{ ok: false, error }` with 503 on misconfig / 502 on
 *   upstream errors so the operator notices.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "travel-time", 5, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    destination?: unknown;
    departureTimeIso?: unknown;
    returnDepartureTimeIso?: unknown;
  } | null;
  const raw = body?.destination;

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return errorResponse("destination is required", 400);
  }

  const departureTime = parseIsoField(body?.departureTimeIso);
  const returnTime = parseIsoField(body?.returnDepartureTimeIso);

  const result = await lookupDriveRoundTrip(raw, departureTime, returnTime);
  switch (result.status) {
    case "ok":
      return okResponse({
        durationMinsThere: result.data.there.durationMins,
        durationMinsBack: result.data.back.durationMins,
        distanceKm: result.data.there.distanceKm,
      });
    case "no_match":
      return okResponse({ durationMinsThere: 0, durationMinsBack: 0 });
    case "misconfig":
      console.error("[travel-time] Base address or Google Maps key is not set");
      return errorResponse("Travel lookup is temporarily unavailable.", 503);
    case "error":
      return errorResponse("Travel lookup failed. Please try again.", 502);
  }
}
