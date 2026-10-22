// src/app/api/admin/social/content/bulk/route.ts
// One change to many content items at once: add or take off a tag, turn recycling on or off, or
// delete them with their lined-up postings. Ids that aren't content items are left alone.

import { parseObjectId } from "@/features/business/lib/validation";
import { IS_CONTENT } from "@/features/social/lib/filters";
import { writePostMeta } from "@/features/social/lib/post-meta.server";
import { deleteContentItems } from "@/features/social/lib/postings.server";
import { MAX_POST_TAGS } from "@/features/social/lib/tags";
import { knownTagIds } from "@/features/social/lib/tags.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Most items one request can change. */
const MAX_IDS = 200;

const ACTIONS = ["tag", "untag", "recycle-on", "recycle-off", "delete"] as const;
type BulkAction = (typeof ACTIONS)[number];

/**
 * POST /api/admin/social/content/bulk
 * Body: `{ ids, action, tagId? }`, where tag and untag need the tag.
 * @param request - Incoming request.
 * @returns JSON `{ changed }`, the items changed; one already tagged or untagged isn't counted.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    ids?: unknown;
    action?: unknown;
    tagId?: unknown;
  } | null;

  if (!Array.isArray(body?.ids) || body.ids.length === 0) {
    return errorResponse("Pick at least one content item.", 400);
  }
  if (body.ids.length > MAX_IDS) {
    return errorResponse(`Pick ${MAX_IDS} content items at most.`, 400);
  }
  const ids = [...new Set(body.ids.map(parseObjectId))];
  if (ids.some((id) => id === null)) return errorResponse("ids holds an invalid id.", 400);
  const action = body.action as BulkAction;
  if (!ACTIONS.includes(action)) {
    return errorResponse(`action must be one of ${ACTIONS.join(", ")}.`, 400);
  }
  const itemIds = ids as string[];

  try {
    if (action === "delete") {
      return okResponse({ changed: await deleteContentItems(itemIds) });
    }

    if (action === "recycle-on" || action === "recycle-off") {
      const updated = await prisma.socialPost.updateMany({
        where: { id: { in: itemIds }, ...IS_CONTENT },
        data: { recycle: action === "recycle-on" },
      });
      return okResponse({ changed: updated.count });
    }

    const tagId = parseObjectId(body.tagId);
    if (!tagId || (await knownTagIds([tagId])).length === 0) {
      return errorResponse("That tag no longer exists.", 404);
    }
    // Tags are side fields, so tagging doesn't count as editing the item.
    let changed = 0;
    for (const id of itemIds) {
      const result = await writePostMeta(id, (p) => {
        if (p.isContent !== true) return null;
        const has = p.tagIds.includes(tagId);
        if (action === "tag") {
          return has || p.tagIds.length >= MAX_POST_TAGS ? null : { tagIds: [...p.tagIds, tagId] };
        }
        return has ? { tagIds: p.tagIds.filter((t) => t !== tagId) } : null;
      });
      if (result === "done") changed++;
    }
    return okResponse({ changed });
  } catch (error) {
    console.error("[admin/social/content/bulk] Bulk change failed:", error);
    return errorResponse(
      "Couldn't change the content items. Reload the page to see where it got to.",
      500,
    );
  }
}
