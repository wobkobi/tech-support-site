// src/app/api/admin/social/schedules/route.ts
// Lists schedules, or makes one and lines up its first postings.

import { parseQueueInput, type QueueInput } from "@/features/social/lib/queues";
import { createQueue, loadQueueSummaries } from "@/features/social/lib/queues.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/social/schedules
 * @param request - Incoming request.
 * @returns JSON `{ schedules }`, A to Z, each with its lined-up count and next posting.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  return okResponse({ schedules: await loadQueueSummaries() });
}

/**
 * POST /api/admin/social/schedules
 * Body: `{ name, colour?, paused?, platforms?, slots?, order?, minGapDays?, itemIds? }`.
 * @param request - Incoming request.
 * @returns 201 JSON `{ schedule, cleared, fill }`; fill is null while another fill runs.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const parsed = parseQueueInput(await request.json().catch(() => null), false);
  if ("error" in parsed) return errorResponse(parsed.error, 400);
  try {
    const { social } = await getSettings();
    const saved = await createQueue(
      parsed.data as QueueInput,
      new Date(),
      social.schedules.fillDays,
    );
    return okResponse({ schedule: saved.row, cleared: saved.cleared, fill: saved.fill }, 201);
  } catch (error) {
    console.error("[admin/social/schedules] Create failed:", error);
    return errorResponse("Couldn't make the schedule. Try again.", 500);
  }
}
