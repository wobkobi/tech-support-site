// src/app/api/admin/social/[id]/email/route.ts
// Email this too: draft a linked mailing-list email from a post, turn the offer down, or unlink.
// Only ever makes a draft; sending stays in Mailing.

import { parseObjectId } from "@/features/business/lib/validation";
import {
  draftEmailForPost,
  setEmailSkipped,
  unlinkPostEmail,
  type EmailPictureSource,
} from "@/features/social/lib/email-step.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

const PICTURE_SOURCES: readonly EmailPictureSource[] = ["design", "photo", "none"];

/**
 * POST /api/admin/social/[id]/email
 * Body: `{ picture: "design" | "photo" | "none" }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ campaignId }` (201), 409 when the post already has an email.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);
  const body = (await request.json().catch(() => null)) as { picture?: unknown } | null;
  const picture = PICTURE_SOURCES.find((p) => p === body?.picture);
  if (!picture) return errorResponse('picture must be "design", "photo" or "none".', 400);

  try {
    const result = await draftEmailForPost(id, { picture });
    if (!result.ok) return errorResponse(result.error, result.status);
    return okResponse({ campaignId: result.campaignId }, 201);
  } catch (error) {
    console.error("[admin/social/email] Draft failed:", error);
    return errorResponse("Couldn't make the email.", 500);
  }
}

/**
 * PATCH /api/admin/social/[id]/email
 * Body: `{ skipped: boolean }`: whether publishing should stop offering the email.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ ok }`.
 */
export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);
  const body = (await request.json().catch(() => null)) as { skipped?: unknown } | null;
  if (typeof body?.skipped !== "boolean")
    return errorResponse("skipped must be true or false.", 400);
  if (!(await setEmailSkipped(id, body.skipped))) return errorResponse("Post not found.", 404);
  return okResponse();
}

/**
 * DELETE /api/admin/social/[id]/email - unlinks the post's email; the email stays in Mailing.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ ok }`.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);
  if (!(await unlinkPostEmail(id))) return errorResponse("Post not found.", 404);
  return okResponse();
}
