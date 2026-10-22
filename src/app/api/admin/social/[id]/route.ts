// src/app/api/admin/social/[id]/route.ts
// One social post, preset or content item. PATCH is a sparse update of drafts, presets and
// content items only, apart from tags, which any post can change; DELETE can take the post down
// from its platforms first.

import { parseObjectId } from "@/features/business/lib/validation";
import { deleteUnusedPictures } from "@/features/social-design/lib/picture-store";
import {
  hasContentFields,
  mergeTargets,
  parseContentPatch,
  parsePostPatch,
} from "@/features/social/lib/parse";
import { writePostMeta } from "@/features/social/lib/post-meta.server";
import { toPostRow } from "@/features/social/lib/post-row";
import { deleteLinedUpPostings, syncPostings } from "@/features/social/lib/postings.server";
import { takeDownPost } from "@/features/social/lib/publish";
import { dropFromQueues, skipQueueSlot } from "@/features/social/lib/queue-fill.server";
import { knownTagIds } from "@/features/social/lib/tags.server";
import { takeDownDue } from "@/features/social/lib/targets";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
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
 * PATCH /api/admin/social/[id] - edits a draft, preset or content item. A patch of only `tagIds`
 * works on a post in any state and isn't counted as an edit, so updatedAt stays. Editing a
 * posting by hand detaches it from its content item; editing a content item copies the change
 * to its lined-up postings and returns `postingProblems` for any that now can't go out.
 * @param request - Incoming request with the changed fields.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ post, postingProblems? }`.
 */
export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);

  const raw = await request.json().catch(() => null);
  const parsed = parsePostPatch(raw);
  if ("error" in parsed) return errorResponse(parsed.error, 400);
  // Tags that were deleted meanwhile drop out.
  if (parsed.patch.tagIds) parsed.patch.tagIds = await knownTagIds(parsed.patch.tagIds);

  const keys = Object.keys(parsed.patch);
  if (!parsed.targets && keys.length === 1 && parsed.patch.tagIds) {
    const tagIds = parsed.patch.tagIds;
    if ((await writePostMeta(id, () => ({ tagIds }))) === "missing") {
      return errorResponse("Post not found.", 404);
    }
    const post = await prisma.socialPost.findUniqueOrThrow({ where: { id } });
    return okResponse({ post: toPostRow(post) });
  }

  const kind = await prisma.socialPost.findUnique({
    where: { id },
    select: { isContent: true, sourceId: true },
  });
  if (!kind) return errorResponse("Post not found.", 404);
  let content = {};
  if (hasContentFields(raw)) {
    if (!kind.isContent) {
      return errorResponse("Only a content item has more captions and recycling.", 400);
    }
    const parsedContent = parseContentPatch(raw);
    if ("error" in parsedContent) return errorResponse(parsedContent.error, 400);
    content = parsedContent.patch;
  }

  const editable = { id, OR: [{ isPreset: true }, { status: "draft" as const }] };
  let targets = undefined;
  if (parsed.targets) {
    const current = await prisma.socialPost.findFirst({ where: editable });
    if (current) targets = mergeTargets(current.targets, parsed.targets);
  }
  // Status guard in the write itself, so an edit can't race a publish.
  const updated = await prisma.socialPost.updateMany({
    where: editable,
    data: {
      ...parsed.patch,
      ...content,
      ...(targets ? { targets } : {}),
      ...(kind.sourceId ? { detached: true } : {}),
    },
  });
  if (updated.count === 0) {
    const exists = await prisma.socialPost.count({ where: { id } });
    return exists
      ? errorResponse("Only drafts can be edited. Cancel the schedule first.", 409)
      : errorResponse("Post not found.", 404);
  }
  const post = await prisma.socialPost.findUniqueOrThrow({ where: { id } });
  if (!post.isContent) return okResponse({ post: toPostRow(post) });
  return okResponse({ post: toPostRow(post), postingProblems: await syncPostings(post) });
}

// Statuses where nothing is up on any platform, so the record can safely go.
const NOTHING_UP = ["draft", "scheduled", "failed", "removed"] as const;

/**
 * DELETE /api/admin/social/[id] - takes the post down everywhere first (kept if any platform
 * refuses), or with `?keepOnline=1` deletes only the record. Refused mid-post or mid-take-down.
 * A content item takes its lined-up postings with it; ones already out stay as plain posts.
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
            .map((t) => `${PLATFORM_LABEL[t.platform] ?? t.platform}: ${t.error ?? "failed"}`)
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

  const pictures = keepOnline
    ? null
    : await prisma.socialPost.findUnique({
        where: { id },
        select: { imageUrl: true, isContent: true, targets: { select: { imageUrl: true } } },
      });
  const postingPictures = pictures?.isContent ? await deleteLinedUpPostings(id) : [];
  const slot = await prisma.socialPost.findUnique({
    where: { id },
    select: { queueId: true, status: true, scheduledAt: true },
  });
  // Status guard in the delete itself, so a post that just went out stays.
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
  // A schedule's lined-up posting deleted by hand leaves its slot empty instead of refilled.
  if (slot?.queueId && slot.status === "scheduled" && slot.scheduledAt) {
    await skipQueueSlot(slot.queueId, slot.scheduledAt);
  }
  if (pictures?.isContent) await dropFromQueues([id]);
  // Post maker pictures only this post used go too. Kept when the post stays online.
  if (pictures) {
    await deleteUnusedPictures([
      pictures.imageUrl,
      ...pictures.targets.map((t) => t.imageUrl),
      ...postingPictures,
    ]);
  }
  return okResponse();
}
