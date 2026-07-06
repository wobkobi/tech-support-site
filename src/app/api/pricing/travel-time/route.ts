// src/app/api/pricing/travel-time/route.ts
/**
 * @description Public, rate-limited travel-time endpoint. POST looks up the
 * drive time and distance from HOME_ADDRESS to a destination via
 * {@link lookupDriveDistance}, with an optional departureTimeIso for
 * traffic-aware quoting. Returns durationMins 0 for no match, 503 on misconfig,
 * and 502 on upstream errors.
 */

import { lookupDriveDistance } from "@/features/business/lib/travel-distance";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/pricing/travel-time - Drive time from HOME_ADDRESS to destination.
 * Optional `departureTimeIso` enables traffic-aware quoting; malformed/missing
 * values fall back to "now".
 * @param request - Body: `{ destination: string, departureTimeIso?: string }`.
 * @returns `{ ok: true, durationMins, distanceKm }` on success, durationMins: 0
 *   when unresolvable, and `{ ok: false, error }` with 503 on misconfig / 502 on
 *   upstream errors so the operator notices.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "travel-time", 5, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    destination?: unknown;
    departureTimeIso?: unknown;
  } | null;
  const raw = body?.destination;

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return errorResponse("destination is required", 400);
  }

  let departureTime: Date | undefined;
  if (typeof body?.departureTimeIso === "string" && body.departureTimeIso.trim()) {
    const parsed = new Date(body.departureTimeIso);
    if (!isNaN(parsed.getTime())) departureTime = parsed;
  }

  const result = await lookupDriveDistance(raw, departureTime);
  switch (result.status) {
    case "ok":
      return okResponse({ ...result.data });
    case "no_match":
      return okResponse({ durationMins: 0 });
    case "misconfig":
      console.error("[travel-time] HOME_ADDRESS or Google Maps key is not set");
      return errorResponse("Travel lookup is temporarily unavailable.", 503);
    case "error":
      return errorResponse("Travel lookup failed. Please try again.", 502);
  }
}
