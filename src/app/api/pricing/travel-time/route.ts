// src/app/api/pricing/travel-time/route.ts
// Public travel-time endpoint: both drive legs, traffic-aware. Each request costs two
// Distance Matrix elements; the 5/min rate limit keeps that within quota.

import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getPacificAucklandOffset, nzDateParts } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

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
 * The next weekday at `hour` NZ time, so a slot-less quote uses realistic traffic.
 * @param hour - NZ-local hour to price against.
 * @param now - Reference time (defaults to now).
 * @returns A UTC Date for that NZ-local moment.
 */
function representativeDepartureTime(hour: number, now: Date = new Date()): Date {
  const [y, m, d] = nzDateParts(now);

  // UTC-midnight cursor from the NZ date, so day-of-week is NZ's, not the server's.
  const cursor = new Date(Date.UTC(y, m - 1, d));
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const yy = cursor.getUTCFullYear();
  const mm = cursor.getUTCMonth() + 1;
  const dd = cursor.getUTCDate();
  const offset = getPacificAucklandOffset(yy, mm, dd);
  return new Date(Date.UTC(yy, mm - 1, dd, hour - offset, 0, 0));
}

/**
 * POST /api/pricing/travel-time - missing departure times fall back to
 * {@link representativeDepartureTime} (return 60 min later).
 * @param request - Body: `{ destination: string, departureTimeIso?: string, returnDepartureTimeIso?: string }`.
 * @returns Leg durations and outbound distanceKm; zero durations when unresolvable,
 *   503 on misconfig, 502 on upstream errors.
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

  const { scheduling } = await getSettings();
  const departureTime =
    parseIsoField(body?.departureTimeIso) ??
    representativeDepartureTime(scheduling.travelQuoteHour);
  const returnTime =
    parseIsoField(body?.returnDepartureTimeIso) ??
    new Date(departureTime.getTime() + 60 * 60 * 1000);

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
