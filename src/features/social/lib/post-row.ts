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
  /** The picture before the logo went on, when it has one. */
  imageOriginalUrl: string | null;
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
  /** The picture before the logo went on, when it has one. */
  imageOriginalUrl: string | null;
  linkUrl: string | null;
  tagIds: string[];
  isPreset: boolean;
  status: SocialPostStatus;
  scheduledAt: string | null;
  postedAt: string | null;
  promoId: string | null;
  campaignId: string | null;
  targets: SocialTargetRow[];
  googleType: GooglePostType;
  googleCta: GooglePostCta | null;
  /** Where Google's button goes, when it isn't the Link. */
  googleUrl: string | null;
  googleTitle: string | null;
  /** Offer and event dates as YYYY-MM-DD. */
  offerStart: string | null;
  offerEnd: string | null;
  /** Event times as NZ "HH:MM", or null for all day. */
  eventStartTime: string | null;
  eventEndTime: string | null;
  couponCode: string | null;
  /** A content item: a library post that goes out as postings. */
  isContent: boolean;
  /** A posting's content item, the caption it used, and whether it was edited by hand. */
  sourceId: string | null;
  captionIndex: number | null;
  detached: boolean;
  /** A content item's other captions; body is caption 1. */
  altCaptions: string[];
  nextCaption: number | null;
  recycle: boolean;
  /** A content item's last day to post as YYYY-MM-DD, or null. */
  expiresAt: string | null;
  maxPosts: number | null;
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
    imageOriginalUrl: p.imageOriginalUrl,
    linkUrl: p.linkUrl,
    tagIds: p.tagIds ?? [],
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
      imageOriginalUrl: t.imageOriginalUrl,
      cropApprovedFor: t.cropApprovedFor,
      status: t.status,
      permalink: t.permalink,
      error: t.error,
      postedAt: t.postedAt?.toISOString() ?? null,
      removedAt: t.removedAt?.toISOString() ?? null,
    })),
    googleType: p.googleType,
    googleCta: p.googleCta,
    googleUrl: p.googleUrl,
    googleTitle: p.googleTitle,
    offerStart: dateKey(p.offerStart),
    offerEnd: dateKey(p.offerEnd),
    eventStartTime: p.eventStartTime,
    eventEndTime: p.eventEndTime,
    couponCode: p.couponCode,
    isContent: p.isContent === true,
    sourceId: p.sourceId,
    captionIndex: p.captionIndex,
    detached: p.detached === true,
    altCaptions: p.altCaptions ?? [],
    nextCaption: p.nextCaption,
    recycle: p.recycle === true,
    expiresAt: dateKey(p.expiresAt),
    maxPosts: p.maxPosts,
    updatedAt: p.updatedAt.toISOString(),
  };
}
