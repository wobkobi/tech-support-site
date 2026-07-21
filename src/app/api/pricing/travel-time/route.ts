// src/app/api/pricing/travel-time/route.ts
/**
 * @description Public, rate-limited travel-time endpoint. POST looks up both
 * drive legs via {@link lookupDriveRoundTrip}, each traffic-aware at its own
 * departure. Returns zero durations for no match, 503 on misconfig, 502 on
 * upstream errors. Each request costs two Google Distance Matrix elements;
 * the 5/min rate limit keeps that within quota.
 */

import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
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
 * The next weekday at `hour` NZ time. Used when the caller has no chosen slot,
 * so travel is quoted against a realistic visit rather than live traffic at
 * page-load (an estimate opened at 11pm would otherwise price an empty motorway).
 * @param hour - NZ-local hour to price against (live scheduling.travelQuoteHour).
 * @param now - Reference time (defaults to now).
 * @returns A UTC Date for that NZ-local moment.
 */
function representativeDepartureTime(hour: number, now: Date = new Date()): Date {
  const [y, m, d] = now
    .toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" })
    .split("-")
    .map(Number);

  // Weekday maths on a UTC-midnight cursor built from the NZ calendar date, so
  // the day-of-week is the NZ one rather than the server's.
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
 * POST /api/pricing/travel-time - both drive legs between the base address
 * and a destination. Optional `departureTimeIso` / `returnDepartureTimeIso`
 * pin each leg's traffic prediction; missing/malformed ones quote against
 * {@link representativeDepartureTime} (return 60 min later) so a late-night
 * estimate doesn't price an empty motorway for a mid-afternoon job.
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

  // With no slot chosen (the /pricing wizard), quoting live traffic means an
  // estimate opened at 11pm prices an empty motorway for a job that will
  // actually happen mid-afternoon. Fall back to a representative bookable time
  // instead of "now".
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
