// src/app/api/admin/social/[id]/to-story/route.ts
// Make a story from this: a new draft story from a post, with the tall picture the browser drew
// from the post's design or padded from its photo. Facebook and Instagram on, Google off.

import { parseObjectId } from "@/features/business/lib/validation";
import { formatTakes } from "@/features/social/lib/media";
import { toPostRow } from "@/features/social/lib/post-row";
import { defaultTargets } from "@/features/social/lib/targets";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { isBlobImageUrl } from "@/shared/lib/blob-image";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const MAX_NAME = 120;

/**
 * A picture side in pixels, or null when it isn't a sensible whole number.
 * @param raw - Value from the body.
 * @returns The size, or null.
 */
function side(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw <= 10000 ? raw : null;
}

/**
 * POST /api/admin/social/[id]/to-story - body `{ imageUrl, imageWidth, imageHeight, imageAlt? }`.
 * The words, tags and promo come along; the story itself shows only the picture.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ post }` with the new draft, 201.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";
  const width = side(body?.imageWidth);
  const height = side(body?.imageHeight);
  if (!isBlobImageUrl(imageUrl) || !width || !height) {
    return errorResponse("Send the story picture's address and size.", 400);
  }
  const alt = typeof body?.imageAlt === "string" ? body.imageAlt.trim().slice(0, 1000) : "";

  const source = await prisma.socialPost.findUnique({ where: { id } });
  if (!source) return errorResponse("That post no longer exists.", 404);
  const created = await prisma.socialPost.create({
    data: {
      name: `Story: ${source.name}`.slice(0, MAX_NAME),
      body: source.body,
      format: "story",
      imageUrl,
      imageAlt: alt || source.imageAlt,
      imageWidth: width,
      imageHeight: height,
      tagIds: source.tagIds,
      promoId: source.promoId,
      targets: defaultTargets().map((t) => ({ ...t, enabled: formatTakes("story", t.platform) })),
    },
  });
  return okResponse({ post: toPostRow(created) }, 201);
}
