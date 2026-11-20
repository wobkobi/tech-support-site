// src/app/api/admin/travel-alerts/run/route.ts
// Runs the running-late check or the morning summary on demand from the Travel alerts page.
// A manual summary sends even when today's has already gone out.

import { runRunningLateCheck } from "@/features/calendar/lib/running-late.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Runs one check now.
 * @param request - Admin request with JSON `{ mode: "live" | "morning" }`.
 * @returns The run result, as the cron route returns it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
  if (body.mode !== "live" && body.mode !== "morning") {
    return errorResponse("mode must be live or morning", 400);
  }
  try {
    const result = await runRunningLateCheck(body.mode, new Date(), "manual");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[travel-alerts/run] Error:", error);
    return errorResponse("The check failed", 500);
  }
}
