// src/app/api/cron/refresh-public-holidays/route.ts
/**
 * @file route.ts
 * @description Cron endpoint to refresh the `PublicHoliday` table from
 * Google's public NZ holidays calendar. Called monthly via cron-job.org.
 */

import { HOME_REGION, NZ_REGION } from "@/features/business/lib/pricing-policy";
import { isCronAuthorized } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

const NZ_HOLIDAYS_CALENDAR_ID = "en.new_zealand#holiday@group.v.calendar.google.com";

/**
 * Returns the region label for a holiday event. Auckland regional anniversary
 * lives on the same Google calendar as nationwide holidays; the description
 * field tags regional ones with "Regional holiday in <region>".
 * @param description - Event description text from the Google calendar.
 * @returns NZ_REGION for nationwide, HOME_REGION for Auckland, or null to skip.
 */
function regionFor(description: string | null | undefined): string | null {
  if (!description) return NZ_REGION;
  const lower = description.toLowerCase();
  if (!lower.includes("regional holiday")) return NZ_REGION;
  if (lower.includes("auckland")) return HOME_REGION;
  return null;
}

/**
 * GET /api/cron/refresh-public-holidays
 * Fetches NZ public holidays for the current and next calendar year from the
 * Google holidays calendar, upserts each into `PublicHoliday`. Idempotent.
 * @param request - The incoming cron request.
 * @returns JSON `{ ok, upserted, years }` or an error.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing GOOGLE_MAPS_SERVER_KEY / GOOGLE_MAPS_API_KEY" },
      { status: 503 },
    );
  }

  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear, thisYear + 1];

  try {
    const calendar = google.calendar({ version: "v3", auth: apiKey });
    let upserted = 0;
    for (const year of years) {
      const res = await calendar.events.list({
        calendarId: NZ_HOLIDAYS_CALENDAR_ID,
        timeMin: `${year}-01-01T00:00:00Z`,
        timeMax: `${year + 1}-01-01T00:00:00Z`,
        singleEvents: true,
      });
      for (const event of res.data.items ?? []) {
        const date = event.start?.date;
        const name = event.summary;
        if (!date || !name) continue;
        const region = regionFor(event.description);
        if (!region) continue;
        await prisma.publicHoliday.upsert({
          where: { date_region: { date, region } },
          update: { name },
          create: { date, name, region },
        });
        upserted++;
      }
    }
    return NextResponse.json({ ok: true, upserted, years });
  } catch (err) {
    console.error("[cron/refresh-public-holidays] Refresh failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Refresh failed" },
      { status: 500 },
    );
  }
}
