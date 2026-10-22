// src/app/api/admin/social/content/[id]/postings/route.ts
// A content item's postings: list them, or make one that goes out now or at a set time.
// Quiet hours don't apply: a post wakes nobody.

import { parseObjectId } from "@/features/business/lib/validation";
import { IS_CONTENT } from "@/features/social/lib/filters";
import { toPostRow } from "@/features/social/lib/post-row";
import { createPosting } from "@/features/social/lib/postings.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/social/content/[id]/postings - newest first.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the content item id.
 * @returns JSON `{ postings }`.
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Content item not found.", 404);
  const item = await prisma.socialPost.count({ where: { id, ...IS_CONTENT } });
  if (!item) return errorResponse("Content item not found.", 404);
  const postings = await prisma.socialPost.findMany({
    where: { sourceId: id },
    orderBy: { id: "desc" },
  });
  return okResponse({ postings: postings.map(toPostRow) });
}

/**
 * POST /api/admin/social/content/[id]/postings
 * Body: `{ when: "now" | ISO string, captionIndex?, queueId? }`; the item's next caption when
 * left out, and `queueId` when the time is a schedule's open time being filled.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the content item id.
 * @returns JSON `{ posting, status?, targets? }`, the last two when it went out now.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Content item not found.", 404);
  const body = (await request.json().catch(() => null)) as {
    when?: unknown;
    captionIndex?: unknown;
    queueId?: unknown;
  } | null;

  let when: "now" | Date;
  if (body?.when === "now") when = "now";
  else {
    const at = typeof body?.when === "string" ? new Date(body.when) : null;
    if (!at || Number.isNaN(at.getTime())) return errorResponse("Pick a date and time.", 400);
    if (at.getTime() < Date.now() + 60_000) {
      return errorResponse("Pick a time at least a minute from now.", 400);
    }
    when = at;
  }
  const captionIndex = body?.captionIndex;
  if (
    captionIndex !== undefined &&
    captionIndex !== null &&
    (!Number.isInteger(captionIndex) || (captionIndex as number) < 0)
  ) {
    return errorResponse("captionIndex must be a caption number from 0.", 400);
  }
  let queueId: string | undefined;
  if (body?.queueId !== undefined && body.queueId !== null) {
    queueId = parseObjectId(body.queueId) ?? undefined;
    if (!queueId) return errorResponse("That schedule no longer exists.", 404);
    if (when === "now") return errorResponse("A schedule's time is a set time, not now.", 400);
  }

  try {
    const result = await createPosting(id, {
      when,
      ...(typeof captionIndex === "number" ? { captionIndex } : {}),
      ...(queueId ? { queueId } : {}),
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    const published = result.published?.ok ? result.published : null;
    return okResponse(
      {
        posting: toPostRow(result.posting),
        ...(published ? { status: published.status, targets: published.targets } : {}),
      },
      201,
    );
  } catch (error) {
    console.error("[admin/social/content/postings] Error:", error);
    return errorResponse(
      "Something went wrong making the posting. Check the posts list for its status.",
      500,
    );
  }
}
