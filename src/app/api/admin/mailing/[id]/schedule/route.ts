// src/app/api/admin/mailing/[id]/schedule/route.ts
// Schedules a draft to send later (the publish-scheduled cron sends it), or cancels the
// schedule, which turns it back into an editable draft. A time inside quiet hours moves
// to the end of them.

import { parseObjectId } from "@/features/business/lib/validation";
import { audienceOf } from "@/features/mailing/lib/audience";
import { missingSendEnv } from "@/features/mailing/lib/context";
import { listProblems } from "@/features/mailing/lib/render";
import { quietHoldUntil } from "@/features/mailing/lib/send";
import { parseExcludedIds } from "@/features/mailing/lib/validate";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/mailing/[id]/schedule
 * Body: `{ scheduledAt: ISO string, excludedContactIds }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the campaign id.
 * @returns JSON `{ scheduledAt }`: the time it will go, after any quiet-hours move.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Email not found.", 404);
  const body = (await request.json().catch(() => null)) as {
    scheduledAt?: unknown;
    excludedContactIds?: unknown;
  } | null;

  const picked = typeof body?.scheduledAt === "string" ? new Date(body.scheduledAt) : null;
  if (!picked || Number.isNaN(picked.getTime())) return errorResponse("Pick a date and time.", 400);
  const when = (await quietHoldUntil(picked)) ?? picked;
  if (when.getTime() < Date.now() + 60_000) {
    return errorResponse("Pick a time at least a minute from now.", 400);
  }
  const excluded = parseExcludedIds(body?.excludedContactIds);
  if (!excluded) return errorResponse("excludedContactIds must be a list of ids.", 400);

  const missing = missingSendEnv();
  if (missing.length > 0) {
    return errorResponse(`Sending is off until ${missing.join(", ")} is set.`, 503);
  }

  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign || campaign.isPreset) return errorResponse("Email not found.", 404);
  // A promo can start after the schedule is set, so promo placeholders are only
  // checked when it actually sends.
  const problems = listProblems(campaign, true, audienceOf(campaign.audience));
  if (problems.length > 0) return errorResponse(problems.join(" "), 400);

  const updated = await prisma.campaign.updateMany({
    where: { id, isPreset: false, status: "draft" },
    data: { status: "scheduled", scheduledAt: when, excludedContactIds: excluded },
  });
  if (updated.count === 0) return errorResponse("Only a draft can be scheduled.", 409);
  return okResponse({ scheduledAt: when.toISOString() });
}

/**
 * DELETE /api/admin/mailing/[id]/schedule - cancels a schedule.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the campaign id.
 * @returns JSON `{ ok }`.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Email not found.", 404);
  const updated = await prisma.campaign.updateMany({
    where: { id, status: "scheduled" },
    data: { status: "draft", scheduledAt: null },
  });
  if (updated.count === 0) {
    return errorResponse("It isn't scheduled any more - it may have just started sending.", 409);
  }
  return okResponse();
}
