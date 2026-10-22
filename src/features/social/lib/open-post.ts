// src/features/social/lib/open-post.ts
// Server-side loader for the composer's open post and everything around it.

import { insertDetailsOf, type InsertDetails } from "@/features/admin/lib/insertables";
import { promoWording } from "@/features/mailing/lib/context";
import type { PromoWording } from "@/features/mailing/lib/render";
import { docHash, parseDesignDoc } from "@/features/social-design/lib/doc";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
import {
  designEmailPicture,
  loadPostEmail,
  type EmailPicture,
  type PostEmail,
} from "@/features/social/lib/email-step.server";
import { PLATFORMS } from "@/features/social/lib/platforms";
import { toPostRow, type SocialPostRow } from "@/features/social/lib/post-row";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { aiConfigured } from "@/shared/lib/ai/json-completion";
import { canUploadImages } from "@/shared/lib/image-upload";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { HashtagsDefault, WatermarkSettings } from "@/shared/lib/settings/types";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { SocialPost } from "@prisma/client";

/** The post maker design linked to a post. */
export interface PostDesign {
  id: string;
  /** The picture no longer matches the design: the design or its live values changed, or it was swapped. */
  stale: boolean;
}

/** Write with AI's starting choices, from the brand profile. */
export interface CaptionAiSetup {
  hashtags: HashtagsDefault;
  emoji: boolean;
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
  /** Null when no AI key is set, which hides Write with AI. */
  captionAi: CaptionAiSetup | null;
  /** The email linked to the post, either way round. */
  email: PostEmail | null;
  /** Email this too was turned down, so publishing doesn't offer it. */
  emailSkipped: boolean;
  /** The linked design's current wide picture, which Email this too can open with. */
  emailPicture: EmailPicture | null;
  /** How Add my logo marks a photo, and whether new uploads get it. */
  watermark: WatermarkSettings;
}

/**
 * The design last linked to a post, whether the post still shows its pictures, and its wide
 * picture for email.
 * @param post - Post as stored.
 * @returns Linked design and email picture, each null when there's none.
 */
async function linkedDesign(
  post: SocialPost,
): Promise<{ design: PostDesign | null; emailPicture: EmailPicture | null }> {
  const design = await prisma.socialDesign.findFirst({
    where: { postId: post.id, isTemplate: false },
    orderBy: { updatedAt: "desc" },
  });
  if (!design) return { design: null, emailPicture: null };
  const parsed = parseDesignDoc(design.doc);
  if ("error" in parsed) return { design: { id: design.id, stale: true }, emailPicture: null };
  const bound = await loadBoundValues();
  const hash = docHash(parsed.doc, bound);
  const feed = design.renders.find((r) => r.format === "feed-4x5");
  return {
    design: {
      id: design.id,
      stale: !feed || feed.docHash !== hash || post.imageUrl !== feed.url,
    },
    emailPicture: designEmailPicture(design, bound),
  };
}

/**
 * Loads the composer's data for a post.
 * @param post - Post as stored.
 * @returns Composer data.
 */
export async function loadOpenPost(post: SocialPost): Promise<OpenPost> {
  const [{ promo }, linked, { identity, social }, { design, emailPicture }, email] =
    await Promise.all([
      promoWording(post.promoId),
      post.promoId
        ? prisma.promo.findUnique({ where: { id: post.promoId }, select: { title: true } })
        : Promise.resolve(null),
      getSettings(),
      linkedDesign(post),
      loadPostEmail(post),
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
    captionAi: aiConfigured()
      ? { hashtags: social.brand.hashtagsOn, emoji: social.brand.emojiOn }
      : null,
    email,
    emailSkipped: post.emailSkipped === true,
    emailPicture,
    watermark: social.watermark,
  };
}
