// src/app/api/cron/refresh-public-holidays/route.ts
// Cron endpoint to refresh the `PublicHoliday` table from Google's public NZ holidays
// calendar. Called monthly via cron-job.org. Keeps real public holidays (nationwide and
// Auckland) plus Christmas Eve and New Year's Eve; other observances (Guy Fawkes,
// Mother's Day...) aren't billed at the holiday rate.

import { SURCHARGED_OBSERVANCES } from "@/features/business/lib/holiday-calendar";
import { HOME_REGION, NZ_REGION } from "@/features/business/lib/pricing-policy";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { calendar as googleCalendar } from "@googleapis/calendar";
import { NextRequest, NextResponse } from "next/server";

const NZ_HOLIDAYS_CALENDAR_ID = "en.new_zealand#holiday@group.v.calendar.google.com";

// Eves billed at the holiday rate, matched on Google's event name; the offline fallback
// reads the same list, so the price never depends on the table being reachable.
const SURCHARGED_NAMES = new Set(SURCHARGED_OBSERVANCES.map((o) => o.name));

/**
 * Returns the region label for a holiday event. Google tags each description
 * "Public holiday", "Regional holiday in <region>" or "Observance"; anything off
 * that allow-list (observances, a missing description) is skipped.
 * @param description - Event description text from the Google calendar.
 * @returns NZ_REGION for nationwide, HOME_REGION for Auckland, or null to skip.
 */
function regionFor(description: string | null | undefined): string | null {
  const lower = description?.toLowerCase() ?? "";
  if (lower.includes("regional holiday")) {
    return lower.includes("auckland") ? HOME_REGION : null;
  }
  if (lower.includes("public holiday")) return NZ_REGION;
  return null;
}

/**
 * GET /api/cron/refresh-public-holidays
 * Upserts this and next year's NZ public holidays into `PublicHoliday`, then prunes
 * rows in those years that Google no longer lists as a public holiday. Idempotent.
 * @param request - The incoming cron request.
 * @returns JSON `{ ok, upserted, pruned, years }` or an error.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  // Server-only key; GOOGLE_MAPS_API_KEY is public, so never fall back to it.
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing GOOGLE_MAPS_SERVER_KEY" },
      { status: 503 },
    );
  }

  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear, thisYear + 1];

  try {
    const calendar = googleCalendar({ version: "v3", auth: apiKey });
    let upserted = 0;
    const seen = new Set<string>();
    for (const year of years) {
      const res = await calendar.events.list({
        calendarId: NZ_HOLIDAYS_CALENDAR_ID,
        timeMin: `${year}-01-01T00:00:00Z`,
        timeMax: `${year + 1}-01-01T00:00:00Z`,
        singleEvents: true,
        // One page holds a whole year (~35 events), so pruning never sees a partial list
        maxResults: 2500,
      });
      for (const event of res.data.items ?? []) {
        const date = event.start?.date;
        const name = event.summary;
        if (!date || !name) continue;
        const region =
          regionFor(event.description) ?? (SURCHARGED_NAMES.has(name) ? NZ_REGION : null);
        if (!region) continue;
        await prisma.publicHoliday.upsert({
          where: { date_region: { date, region } },
          update: { name },
          create: { date, name, region },
        });
        seen.add(`${date}|${region}`);
        upserted++;
      }
    }

    // Prune only after every year fetched cleanly, so a failed list never empties the table
    const existing = await prisma.publicHoliday.findMany({
      where: { date: { gte: `${years[0]}-01-01`, lte: `${years[years.length - 1]}-12-31` } },
      select: { id: true, date: true, region: true },
    });
    const staleIds = existing
      .filter((row) => !seen.has(`${row.date}|${row.region}`))
      .map((row) => row.id);
    const pruned =
      staleIds.length > 0
        ? (await prisma.publicHoliday.deleteMany({ where: { id: { in: staleIds } } })).count
        : 0;
    return NextResponse.json({ ok: true, upserted, pruned, years });
  } catch (err) {
    console.error("[cron/refresh-public-holidays] Refresh failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Refresh failed" },
      { status: 500 },
    );
  }
}
