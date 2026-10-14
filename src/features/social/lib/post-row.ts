// src/features/social/lib/post-row.ts
// Plain-data social post shape for the server > client boundary and the social API.

import { dateKey, type GooglePostCta, type GooglePostType } from "@/features/social/lib/validate";
import type { SocialPost } from "@prisma/client";

/** Post lifecycle, mirroring the SocialPostStatus enum. */
export type SocialPostStatus =
  "draft" | "scheduled" | "posting" | "posted" | "partial" | "failed" | "removing" | "removed";

/** One platform's copy of a post as the admin UI sees it. */
export interface SocialTargetRow {
  platform: "facebook" | "instagram" | "google";
  enabled: boolean;
  textOverride: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  cropApprovedFor: string | null;
  status: "pending" | "posted" | "failed" | "skipped" | "removed";
  permalink: string | null;
  error: string | null;
  postedAt: string | null;
  removedAt: string | null;
}

/** A social post as the admin UI sees it. */
export interface SocialPostRow {
  id: string;
  name: string;
  body: string;
  imageUrl: string | null;
  imageAlt: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  linkUrl: string | null;
  isPreset: boolean;
  status: SocialPostStatus;
  scheduledAt: string | null;
  postedAt: string | null;
  promoId: string | null;
  campaignId: string | null;
  targets: SocialTargetRow[];
  googleType: GooglePostType;
  googleCta: GooglePostCta | null;
  googleTitle: string | null;
  /** Offer dates as YYYY-MM-DD. */
  offerStart: string | null;
  offerEnd: string | null;
  couponCode: string | null;
  updatedAt: string;
}

/**
 * Maps a post to its plain shape.
 * @param p - Post as stored.
 * @returns The plain shape.
 */
export function toPostRow(p: SocialPost): SocialPostRow {
  return {
    id: p.id,
    name: p.name,
    body: p.body,
    imageUrl: p.imageUrl,
    imageAlt: p.imageAlt,
    imageWidth: p.imageWidth,
    imageHeight: p.imageHeight,
    linkUrl: p.linkUrl,
    isPreset: p.isPreset,
    status: p.status,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    postedAt: p.postedAt?.toISOString() ?? null,
    promoId: p.promoId,
    campaignId: p.campaignId,
    targets: p.targets.map((t) => ({
      platform: t.platform,
      enabled: t.enabled,
      textOverride: t.textOverride,
      imageUrl: t.imageUrl,
      imageAlt: t.imageAlt,
      imageWidth: t.imageWidth,
      imageHeight: t.imageHeight,
      cropApprovedFor: t.cropApprovedFor,
      status: t.status,
      permalink: t.permalink,
      error: t.error,
      postedAt: t.postedAt?.toISOString() ?? null,
      removedAt: t.removedAt?.toISOString() ?? null,
    })),
    googleType: p.googleType,
    googleCta: p.googleCta,
    googleTitle: p.googleTitle,
    offerStart: dateKey(p.offerStart),
    offerEnd: dateKey(p.offerEnd),
    couponCode: p.couponCode,
    updatedAt: p.updatedAt.toISOString(),
  };
}
