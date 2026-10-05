// src/app/api/admin/social/[id]/route.ts
// One social post. PATCH is a sparse update (only fields present in the body are
// written) and only touches drafts and presets: what was posted stays as it was posted.
// DELETE can take the post down from its platforms first.

import { parseObjectId } from "@/features/business/lib/validation";
import { mergeTargets, parsePostPatch } from "@/features/social/lib/parse";
import { toPostRow } from "@/features/social/lib/post-row";
import { takeDownPost } from "@/features/social/lib/publish";
import { takeDownDue } from "@/features/social/lib/targets";
import { PLATFORM_LABEL, type SocialPlatformKey } from "@/features/social/lib/validate";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/social/[id]
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ post }`.
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return errorResponse("Post not found.", 404);
  return okResponse({ post: toPostRow(post) });
}

/**
 * PATCH /api/admin/social/[id] - edits a draft or preset.
 * @param request - Incoming request with the changed fields.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ post }`.
 */
export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);

  const parsed = parsePostPatch(await request.json().catch(() => null));
  if ("error" in parsed) return errorResponse(parsed.error, 400);

  const editable = { id, OR: [{ isPreset: true }, { status: "draft" as const }] };
  let targets = undefined;
  if (parsed.targets) {
    const current = await prisma.socialPost.findFirst({ where: editable });
    if (current) targets = mergeTargets(current.targets, parsed.targets);
  }
  // The status guard sits in the write itself, so an edit racing a publish can't
  // change a post that has already started going out.
  const updated = await prisma.socialPost.updateMany({
    where: editable,
    data: { ...parsed.patch, ...(targets ? { targets } : {}) },
  });
  if (updated.count === 0) {
    const exists = await prisma.socialPost.count({ where: { id } });
    return exists
      ? errorResponse("Only drafts can be edited. Cancel the schedule first.", 409)
      : errorResponse("Post not found.", 404);
  }
  const post = await prisma.socialPost.findUniqueOrThrow({ where: { id } });
  return okResponse({ post: toPostRow(post) });
}

// Statuses where nothing of the post is up on any platform, so the record can go
// without leaving something online that can no longer be taken down from here.
const NOTHING_UP = ["draft", "scheduled", "failed", "removed"] as const;

/**
 * DELETE /api/admin/social/[id] - removes a post from this list. By default it's
 * taken down from every platform it's up on first, and kept here if any platform
 * refuses, so nothing is left online without a record of it. The server decides this
 * from the stored post, not the list the browser loaded, since a scheduled post may
 * have gone out since. `?keepOnline=1` (the operator unticked the box) deletes only
 * the record. Refused while it is posting or being taken down.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ ok }`.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);

  const keepOnline = request.nextUrl.searchParams.get("keepOnline") === "1";
  if (!keepOnline) {
    const post = await prisma.socialPost.findUnique({ where: { id } });
    if (!post) return errorResponse("Post not found.", 404);
    if (takeDownDue(post.targets).length > 0) {
      try {
        const result = await takeDownPost(id);
        if (!result.ok) return errorResponse(result.error, result.status);
        const left = takeDownDue(result.targets);
        if (left.length > 0) {
          const reasons = left
            .map(
              (t) =>
                `${PLATFORM_LABEL[t.platform as SocialPlatformKey] ?? t.platform}: ${t.error ?? "failed"}`,
            )
            .join(" ");
          return errorResponse(
            `Couldn't take it down everywhere, so the post was kept. ${reasons}`,
            502,
          );
        }
      } catch (error) {
        console.error("[admin/social] Take-down before delete failed:", error);
        return errorResponse("Something went wrong taking it down. The post was kept.", 500);
      }
    }
  }

  // The status guard is in the delete itself: a post that went out between the
  // take-down check and here is still up, so it stays.
  const deleted = await prisma.socialPost.deleteMany({
    where: keepOnline
      ? { id, status: { notIn: ["posting", "removing"] } }
      : { id, status: { in: [...NOTHING_UP] } },
  });
  if (deleted.count === 0) {
    return errorResponse(
      "This post is going out, being taken down or has just gone up, so it wasn't deleted. Reload the page and try again.",
      409,
    );
  }
  return okResponse();
}
