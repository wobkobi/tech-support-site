// src/features/social/lib/copy-post.ts
// What a copy of a post, preset or content item carries over, shared by every route that makes one.

import { defaultTargets } from "@/features/social/lib/targets";
import type { SocialPost } from "@prisma/client";

/**
 * The fields a copy takes: words, picture, link, tags, promo, the Google card, and each app's
 * toggle, own words, own picture and crop OK. Past outcomes, the email link, the content item a
 * posting came from, and content item settings don't come along.
 * @param source - The row being copied.
 * @returns Fields for the create, without a name or kind.
 */
export function copyPostFields(
  source: SocialPost,
): Omit<
  SocialPost,
  | "id"
  | "name"
  | "isPreset"
  | "presetKey"
  | "status"
  | "scheduledAt"
  | "postedAt"
  | "postingStartedAt"
  | "campaignId"
  | "emailSkipped"
  | "isContent"
  | "sourceId"
  | "captionIndex"
  | "detached"
  | "altCaptions"
  | "nextCaption"
  | "recycle"
  | "expiresAt"
  | "maxPosts"
  | "createdAt"
  | "updatedAt"
> {
  const targets = defaultTargets().map((t) => {
    const from = source.targets.find((s) => s.platform === t.platform);
    return from
      ? {
          ...t,
          enabled: from.enabled,
          textOverride: from.textOverride,
          imageUrl: from.imageUrl,
          imageAlt: from.imageAlt,
          imageWidth: from.imageWidth,
          imageHeight: from.imageHeight,
          imageOriginalUrl: from.imageOriginalUrl,
          cropApprovedFor: from.cropApprovedFor,
        }
      : t;
  });
  return {
    body: source.body,
    imageUrl: source.imageUrl,
    imageAlt: source.imageAlt,
    imageWidth: source.imageWidth,
    imageHeight: source.imageHeight,
    imageOriginalUrl: source.imageOriginalUrl,
    linkUrl: source.linkUrl,
    tagIds: source.tagIds,
    promoId: source.promoId,
    targets,
    googleType: source.googleType,
    googleCta: source.googleCta,
    googleUrl: source.googleUrl,
    googleTitle: source.googleTitle,
    offerStart: source.offerStart,
    offerEnd: source.offerEnd,
    eventStartTime: source.eventStartTime,
    eventEndTime: source.eventEndTime,
    couponCode: source.couponCode,
  };
}
