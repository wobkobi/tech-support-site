// src/app/api/location/owntracks/route.ts
// Receives your phone's location from the OwnTracks app (HTTP mode, Basic auth) and runs the
// live running-late check from there, at most once per Settings > Comms phoneCheckGapMin.

import { basicAuthPassword, parseOwnTracksLocation } from "@/features/calendar/lib/running-late";
import {
  OWNER_LOCATION_KEY,
  runRunningLateCheck,
} from "@/features/calendar/lib/running-late.server";
import { isOwnTracksPassword } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { isFailureLimited, recordFailure } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

/** Wrong passwords an IP gets per window before every report from it is refused. */
const WRONG_PASSWORD_LIMIT = 10;
const WRONG_PASSWORD_WINDOW_MS = 15 * 60_000;

/** Setting row holding when a location report last ran the check. */
const LAST_CHECK_KEY = "running-late:last-location-check";

/**
 * Claims the right to run the check now: true when the last location-run check is at least
 * `gapMs` old. The update matches the value read, so a burst of reports runs it once.
 * @param now - Current time.
 * @param gapMs - Fewest ms between checks run by location reports.
 * @returns True when this report should run the check.
 */
async function claimCheck(now: Date, gapMs: number): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: LAST_CHECK_KEY } });
  if (!row) {
    try {
      await prisma.setting.create({ data: { key: LAST_CHECK_KEY, value: now.toISOString() } });
      return true;
    } catch {
      return false; // Another report created it first.
    }
  }
  if (now.getTime() - new Date(row.value).getTime() < gapMs) return false;
  const res = await prisma.setting.updateMany({
    where: { key: LAST_CHECK_KEY, value: row.value },
    data: { value: now.toISOString() },
  });
  return res.count === 1;
}

/**
 * Short description of a report that held no location, for the logs: its message type(s) and
 * top-level keys, never coordinates.
 * @param body - Parsed body, or null when it wasn't JSON.
 * @returns The description.
 */
function describeReport(body: unknown): string {
  if (body === null) return "not JSON";
  /**
   * One message's type and keys.
   * @param m - A message from the body.
   * @returns The description.
   */
  const one = (m: unknown): string => {
    if (!m || typeof m !== "object") return typeof m;
    const r = m as Record<string, unknown>;
    return `${String(r._type)} {${Object.keys(r).join(",")}}`;
  };
  return Array.isArray(body) ? `array of ${body.length}: ${body.map(one).join("; ")}` : one(body);
}

/**
 * POST /api/location/owntracks
 * OwnTracks expects a JSON array back on success; `[]` sends it nothing to act on.
 * @param request - OwnTracks report.
 * @returns `[]`, 401 on a missing or wrong password, or 429 once an IP has guessed wrong too often.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isFailureLimited(request, "owntracks-password", WRONG_PASSWORD_LIMIT)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const header = request.headers.get("authorization");
  if (!isOwnTracksPassword(basicAuthPassword(header))) {
    // Only a wrong password counts: the phone's first try has no header, by design.
    if (header) recordFailure(request, "owntracks-password", WRONG_PASSWORD_WINDOW_MS);
    console.warn(`[owntracks] 401: ${header ? "wrong password" : "no Authorization header"}`);
    // The Basic challenge makes iOS URLSession resend with the stored user and password; without
    // it the iPhone app never sends them.
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Basic realm="OwnTracks", charset="UTF-8"' } },
    );
  }

  const now = new Date();
  const body: unknown = await request.json().catch(() => null);
  // A batch arrives as an array; the newest location in it wins.
  const loc = (Array.isArray(body) ? body : [body])
    .map((m) => parseOwnTracksLocation(m, now.getTime()))
    .filter((l) => l !== null)
    .reduce<ReturnType<typeof parseOwnTracksLocation>>(
      (best, l) => (best && best.at >= l.at ? best : l),
      null,
    );
  if (!loc) {
    console.info(`[owntracks] no location in report: ${describeReport(body)}`);
    return NextResponse.json([]);
  }

  try {
    const data = { lat: loc.lat, lng: loc.lng, accuracyM: loc.accuracyM, at: loc.at };
    // OwnTracks resends queued reports after a dead zone; only a later reading replaces one.
    const updated = await prisma.operatorLocation.updateMany({
      where: { key: OWNER_LOCATION_KEY, at: { lte: loc.at } },
      data,
    });
    if (updated.count === 0) {
      await prisma.operatorLocation
        .create({ data: { key: OWNER_LOCATION_KEY, ...data } })
        .catch(() => console.info("[owntracks] kept a newer stored location"));
    }
    console.info(`[owntracks] stored location, accuracy ${loc.accuracyM ?? "?"} m`);
    const { comms } = await getSettings();
    if (await claimCheck(now, comms.phoneCheckGapMin * 60_000)) {
      const result = await runRunningLateCheck("live", now, "location");
      console.log(
        `[owntracks] check: checked=${result.checked} alerted=${result.alerted} failed=${result.failed}`,
      );
    }
  } catch (error) {
    // Still 200: a non-2xx makes OwnTracks queue and resend the report.
    console.error("[owntracks] report failed:", error);
  }
  return NextResponse.json([]);
}
