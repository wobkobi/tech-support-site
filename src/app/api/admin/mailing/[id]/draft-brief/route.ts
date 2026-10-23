// src/app/api/admin/mailing/[id]/draft-brief/route.ts
// Keeps an email's last Draft with AI brief on the email, so the dialog opens with it on any
// device. The brief is the dialog's memory rather than a change to the email, so the email's
// Edited time stays where it was.

import { parseObjectId } from "@/features/business/lib/validation";
import { readDraftBrief } from "@/features/mailing/lib/draft-brief";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/admin/mailing/[id]/draft-brief - replaces a draft's or preset's kept brief.
 * @param request - Incoming request with the brief.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the campaign id.
 * @returns JSON `{ ok }`.
 */
export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Email not found.", 404);
  const brief = readDraftBrief(await request.json().catch(() => null));
  if (!brief) return errorResponse("brief must be text.", 400);

  // Written with the updatedAt it was read with, so Edited doesn't move. A save or a send landing
  // in between moves updatedAt and misses the guard, so read it again; the status guard rides on
  // the same check.
  for (let tries = 0; tries < 3; tries++) {
    const current = await prisma.campaign.findUnique({
      where: { id },
      select: { updatedAt: true, isPreset: true, status: true },
    });
    if (!current) return errorResponse("Email not found.", 404);
    if (!current.isPreset && current.status !== "draft") {
      return errorResponse("Only drafts can be drafted with AI.", 409);
    }
    const saved = await prisma.campaign.updateMany({
      where: { id, updatedAt: current.updatedAt },
      data: { draftBrief: { ...brief }, updatedAt: current.updatedAt },
    });
    if (saved.count > 0) return okResponse();
  }
  return errorResponse("The email kept changing while the brief was saved. Try again.", 409);
}
