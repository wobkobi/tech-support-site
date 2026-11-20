// src/app/api/cron/check-running-late/route.ts
// Cron pushing when traffic means you can't reach a customer job on time. Every 10 min in the
// day for the live check; once at 07:00 with ?mode=morning for today's tight gaps.

import { runRunningLateCheck } from "@/features/calendar/lib/running-late.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/check-running-late[?mode=morning]
 * @param request - Incoming cron request.
 * @returns JSON `{ ok, mode, checked, alerted, failed, errors }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  const mode = request.nextUrl.searchParams.get("mode") === "morning" ? "morning" : "live";
  try {
    const result = await runRunningLateCheck(mode, new Date());
    console.log(
      `[cron/check-running-late] ${mode}: checked=${result.checked} alerted=${result.alerted} failed=${result.failed}${result.skipped ? ` skipped=${result.skipped}` : ""}`,
    );
    // A calendar that didn't answer or a push that didn't land flags the run on cron-job.org.
    const ok = result.failed === 0 && result.skipped !== "calendar-unavailable";
    return NextResponse.json({ ok, mode, ...result }, { status: ok ? 200 : 500 });
  } catch (error) {
    console.error("[cron/check-running-late] error:", error);
    return NextResponse.json({ ok: false, error: "Running-late check failed" }, { status: 500 });
  }
}
