// src/app/api/admin/mailing/[id]/route.ts
// One mailing-list email. PATCH is a sparse update (only fields present in the body are
// written) and only touches drafts and presets: what was sent stays as it was sent.

import { parseObjectId } from "@/features/business/lib/validation";
import { toCampaignRow } from "@/features/mailing/lib/campaign-row";
import { parseCampaignPatch } from "@/features/mailing/lib/validate";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/mailing/[id]
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the campaign id.
 * @returns JSON `{ campaign }`.
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Email not found.", 404);
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return errorResponse("Email not found.", 404);
  return okResponse({ campaign: toCampaignRow(campaign) });
}

/**
 * PATCH /api/admin/mailing/[id] - edits a draft or preset.
 * @param request - Incoming request with the changed fields.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the campaign id.
 * @returns JSON `{ campaign }`.
 */
export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Email not found.", 404);

  const parsed = parseCampaignPatch(await request.json().catch(() => null));
  if ("error" in parsed) return errorResponse(parsed.error, 400);

  // The status guard sits in the write itself, so an edit racing a send can't
  // change an email that has already started going out.
  const updated = await prisma.campaign.updateMany({
    where: { id, OR: [{ isPreset: true }, { status: "draft" }] },
    data: parsed.patch,
  });
  if (updated.count === 0) {
    const exists = await prisma.campaign.count({ where: { id } });
    return exists
      ? errorResponse("Only drafts can be edited. Cancel the schedule first.", 409)
      : errorResponse("Email not found.", 404);
  }
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  return okResponse({ campaign: toCampaignRow(campaign) });
}

/**
 * DELETE /api/admin/mailing/[id] - removes an email and its send history.
 * Refused while it is sending.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the campaign id.
 * @returns JSON `{ ok }`.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Email not found.", 404);
  const deleted = await prisma.campaign.deleteMany({ where: { id, status: { not: "sending" } } });
  if (deleted.count === 0) {
    return errorResponse("This email is sending right now, so it can't be deleted.", 409);
  }
  await prisma.campaignSend.deleteMany({ where: { campaignId: id } });
  return okResponse();
}
