// src/app/api/admin/social/content/route.ts
// Content items: list them with how often each has gone out, or make one blank or from a post,
// preset or another item. Reading, editing and deleting one go through /api/admin/social/[id].

import { parseObjectId } from "@/features/business/lib/validation";
import { toContentRow } from "@/features/social/lib/content-row";
import { copyPostFields } from "@/features/social/lib/copy-post";
import { IS_CONTENT } from "@/features/social/lib/filters";
import { toPostRow } from "@/features/social/lib/post-row";
import { NO_STATS } from "@/features/social/lib/postings-core";
import { contentStats } from "@/features/social/lib/postings.server";
import { defaultTargets } from "@/features/social/lib/targets";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/social/content - every content item, last edited first.
 * @param request - Incoming request.
 * @returns JSON `{ items }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const items = await prisma.socialPost.findMany({
    where: IS_CONTENT,
    orderBy: { updatedAt: "desc" },
  });
  const stats = await contentStats(items.map((i) => i.id));
  const now = new Date();
  return okResponse({
    items: items.map((i) => toContentRow(i, stats.get(i.id) ?? NO_STATS, now)),
  });
}

/**
 * POST /api/admin/social/content - makes a content item.
 * Body: `{ source: "blank" | "copy", sourceId? }`, where a copy can be of a post, a preset or
 * another content item.
 * @param request - Incoming request.
 * @returns JSON `{ item }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    source?: string;
    sourceId?: unknown;
  } | null;

  try {
    if (body?.source === "blank") {
      const created = await prisma.socialPost.create({
        data: { name: "New content item", body: "", isContent: true, targets: defaultTargets() },
      });
      return okResponse({ item: toPostRow(created) }, 201);
    }

    if (body?.source === "copy") {
      const sourceId = parseObjectId(body.sourceId);
      if (!sourceId) return errorResponse("sourceId isn't a valid id.", 400);
      const source = await prisma.socialPost.findUnique({ where: { id: sourceId } });
      if (!source) return errorResponse("That post no longer exists.", 404);
      // Another item's captions and recycling come too; a post or preset brings its words only.
      const fromItem = source.isContent === true;
      const created = await prisma.socialPost.create({
        data: {
          ...copyPostFields(source),
          name: fromItem ? `${source.name} (copy)` : source.name,
          isContent: true,
          ...(fromItem
            ? {
                altCaptions: source.altCaptions,
                recycle: source.recycle,
                expiresAt: source.expiresAt,
                maxPosts: source.maxPosts,
              }
            : {}),
        },
      });
      return okResponse({ item: toPostRow(created) }, 201);
    }

    return errorResponse('source must be "blank" or "copy".', 400);
  } catch (error) {
    console.error("[admin/social/content] Create failed:", error);
    return errorResponse("Couldn't make the content item.", 500);
  }
}
