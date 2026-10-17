// src/app/api/admin/social/designs/[id]/use/route.ts
// Hands a design's pictures to a social post: the 4:5 picture becomes the post's
// picture (Facebook and Instagram), the 4:3 one Google's own picture. Both match the
// shapes the apps show, so nothing is cut off. Updates the post the design is linked
// to while it's still a draft, otherwise starts a new draft.

import { parseObjectId } from "@/features/business/lib/validation";
import { docHash, parseDesignDoc } from "@/features/social-design/lib/doc";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
import {
  deleteUnusedPictures,
  writeKeepingUpdatedAt,
} from "@/features/social-design/lib/picture-store";
import { autoAltText } from "@/features/social-design/lib/pictures";
import { snapshotBeforeSave } from "@/features/social-design/lib/versions";
import { defaultTargets } from "@/features/social/lib/targets";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { DesignRender } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/social/designs/[id]/use
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the design id.
 * @returns JSON `{ postId, created }`, 409 when the pictures are out of date.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Design not found.", 404);
  const design = await prisma.socialDesign.findUnique({ where: { id } });
  if (!design) return errorResponse("Design not found.", 404);
  if (design.isTemplate) return errorResponse("Start a design from this template first.", 400);
  const parsed = parseDesignDoc(design.doc);
  if ("error" in parsed) return errorResponse(parsed.error, 400);
  const doc = parsed.doc;

  // Checked against the design as stored and the contact details and promo as they are
  // now, so a post never gets pictures showing an old phone number or offer.
  const hash = docHash(doc, await loadBoundValues());
  /**
   * A size's stored picture, when it matches the design as it is now.
   * @param format - Size.
   * @returns The picture, or null when missing or out of date.
   */
  const current = (format: string): DesignRender | null =>
    design.renders.find((r) => r.format === format && r.docHash === hash) ?? null;
  if (!doc.formats.includes("feed-4x5")) {
    return errorResponse(
      "Add the 4:5 size first: it's the picture Facebook and Instagram use.",
      400,
    );
  }
  const feed = current("feed-4x5");
  const google = doc.formats.includes("google-4x3") ? current("google-4x3") : null;
  if (!feed || (doc.formats.includes("google-4x3") && !google)) {
    return errorResponse("The pictures are out of date. Update them first.", 409);
  }

  const alt = (doc.altText.trim() || autoAltText(doc)).slice(0, 1000) || null;
  const caption = doc.caption.trim();

  const linked = design.postId
    ? await prisma.socialPost.findFirst({
        where: { id: design.postId, status: "draft", isPreset: false },
      })
    : null;
  // Facebook and Instagram drop any picture of their own so the 4:5 one shows; Google
  // takes the 4:3 one when the design has that size.
  const targets = (linked?.targets ?? defaultTargets()).map((t) => {
    if (t.platform === "google" && !google) return t;
    const own = t.platform === "google" ? google : null;
    return {
      ...t,
      imageUrl: own?.url ?? null,
      imageAlt: own ? alt : null,
      imageWidth: own?.width ?? null,
      imageHeight: own?.height ?? null,
      cropApprovedFor: null,
    };
  });
  const picture = {
    imageUrl: feed.url,
    imageAlt: alt,
    imageWidth: feed.width,
    imageHeight: feed.height,
    targets,
  };

  let postId: string;
  if (linked) {
    await prisma.socialPost.update({
      where: { id: linked.id },
      // The caption only fills an empty post: words already written there stay.
      data: { ...picture, ...(linked.body.trim() ? {} : { body: caption }) },
    });
    postId = linked.id;
  } else {
    const created = await prisma.socialPost.create({
      data: { name: design.name, body: caption, ...picture },
    });
    postId = created.id;
  }

  await writeKeepingUpdatedAt(id, () => ({ postId }));
  await snapshotBeforeSave(id, true).catch((error: unknown) =>
    console.error(`[social-design] ${id} version copy failed:`, error),
  );
  if (linked) {
    await deleteUnusedPictures([linked.imageUrl, ...linked.targets.map((t) => t.imageUrl)]);
  }
  return okResponse({ postId, created: !linked });
}
