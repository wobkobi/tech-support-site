// src/features/social/lib/open-post.ts
// Server-side loader for the post open in the Social page's composer: the post, the
// promo wording its placeholders fill with, which env vars each platform still needs,
// and the site address and contact details the Add menu inserts.

import { insertDetailsOf, type InsertDetails } from "@/features/admin/lib/insertables";
import { promoWording } from "@/features/mailing/lib/context";
import type { PromoWording } from "@/features/mailing/lib/render";
import { PLATFORMS } from "@/features/social/lib/platforms";
import { toPostRow, type SocialPostRow } from "@/features/social/lib/post-row";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { canUploadImages } from "@/shared/lib/image-upload";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { SocialPost } from "@prisma/client";

/** Everything the composer needs for one post. */
export interface OpenPost {
  post: SocialPostRow;
  promo: PromoWording | null;
  promoTitle: string | null;
  canUpload: boolean;
  missingEnv: Record<SocialPlatformKey, string[]>;
  details: InsertDetails;
}

/**
 * Loads the composer's data for a post.
 * @param post - Post as stored.
 * @returns Composer data.
 */
export async function loadOpenPost(post: SocialPost): Promise<OpenPost> {
  const [{ promo }, linked, { identity }] = await Promise.all([
    promoWording(post.promoId),
    post.promoId
      ? prisma.promo.findUnique({ where: { id: post.promoId }, select: { title: true } })
      : Promise.resolve(null),
    getSettings(),
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
  };
}
