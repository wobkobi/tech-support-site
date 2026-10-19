// src/features/social/lib/open-post.ts
// Server-side loader for the composer's open post and everything around it.

import { insertDetailsOf, type InsertDetails } from "@/features/admin/lib/insertables";
import { promoWording } from "@/features/mailing/lib/context";
import type { PromoWording } from "@/features/mailing/lib/render";
import { docHash, parseDesignDoc } from "@/features/social-design/lib/doc";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
import { PLATFORMS } from "@/features/social/lib/platforms";
import { toPostRow, type SocialPostRow } from "@/features/social/lib/post-row";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { canUploadImages } from "@/shared/lib/image-upload";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { SocialPost } from "@prisma/client";

/** The post maker design linked to a post. */
export interface PostDesign {
  id: string;
  /** The picture no longer matches the design: the design or its live values changed, or it was swapped. */
  stale: boolean;
}

/** Everything the composer needs for one post. */
export interface OpenPost {
  post: SocialPostRow;
  promo: PromoWording | null;
  promoTitle: string | null;
  canUpload: boolean;
  missingEnv: Record<SocialPlatformKey, string[]>;
  details: InsertDetails;
  design: PostDesign | null;
}

/**
 * The design last linked to a post, and whether the post still shows its pictures.
 * @param post - Post as stored.
 * @returns Linked design, or null.
 */
async function linkedDesign(post: SocialPost): Promise<PostDesign | null> {
  const design = await prisma.socialDesign.findFirst({
    where: { postId: post.id, isTemplate: false },
    orderBy: { updatedAt: "desc" },
  });
  if (!design) return null;
  const parsed = parseDesignDoc(design.doc);
  if ("error" in parsed) return { id: design.id, stale: true };
  const hash = docHash(parsed.doc, await loadBoundValues());
  const feed = design.renders.find((r) => r.format === "feed-4x5");
  return { id: design.id, stale: !feed || feed.docHash !== hash || post.imageUrl !== feed.url };
}

/**
 * Loads the composer's data for a post.
 * @param post - Post as stored.
 * @returns Composer data.
 */
export async function loadOpenPost(post: SocialPost): Promise<OpenPost> {
  const [{ promo }, linked, { identity }, design] = await Promise.all([
    promoWording(post.promoId),
    post.promoId
      ? prisma.promo.findUnique({ where: { id: post.promoId }, select: { title: true } })
      : Promise.resolve(null),
    getSettings(),
    linkedDesign(post),
  ]);
  return {
    post: toPostRow(post),
    promo,
    promoTitle: linked?.title ?? null,
    canUpload: canUploadImages(),
    missingEnv: Object.fromEntries(
      SOCIAL_PLATFORMS.map((p) => [p, PLATFORMS[p].missingEnv()]),
    ) as Record<SocialPlatformKey, string[]>,
    details: insertDetailsOf(identity, getSiteUrl()),
    design,
  };
}
