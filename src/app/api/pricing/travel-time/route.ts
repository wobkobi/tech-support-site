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
 * Hour (NZ local) a no-slot estimate is priced at - mid-window of the 10am-6pm
 * bookable day, so the quote reflects typical daytime traffic rather than
 * whenever the customer happened to open the page.
 */
const REPRESENTATIVE_HOUR_NZ = 14;

/**
 * The next weekday at {@link REPRESENTATIVE_HOUR_NZ} NZ time. Used when the
 * caller has no chosen slot, so travel is quoted against a realistic visit
 * rather than live traffic at page-load.
 * @param now - Reference time (defaults to now).
 * @returns A UTC Date for that NZ-local moment.
 */
function representativeDepartureTime(now: Date = new Date()): Date {
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
  return new Date(Date.UTC(yy, mm - 1, dd, REPRESENTATIVE_HOUR_NZ - offset, 0, 0));
}

/**
 * POST /api/pricing/travel-time - Both drive legs between the base address
 * and a destination. Optional `departureTimeIso` / `returnDepartureTimeIso`
 * pin each leg's traffic prediction. When they're missing or malformed the
 * drive is quoted against {@link representativeDepartureTime} (return 60 min
 * later) rather than live traffic, so a late-night estimate doesn't price an
 * empty motorway for a job that will happen mid-afternoon.
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
  const departureTime = parseIsoField(body?.departureTimeIso) ?? representativeDepartureTime();
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
