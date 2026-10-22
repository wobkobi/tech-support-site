// src/features/social/lib/postings-core.ts
// Pure helpers for content items and their postings: the captions in turn, what a posting copies
// from its item, and when an item has run its course. Client-safe.

import type { TargetState } from "@/features/social/lib/targets";
import { dateKey, type SocialPlatformKey } from "@/features/social/lib/validate";
import { formatDateShort } from "@/shared/lib/date-format";
import { nzDateKey } from "@/shared/lib/timezone-utils";
import type { SocialPost } from "@prisma/client";

/** Captions one content item can have, the post's own words included. */
export const MAX_CAPTIONS = 10;
/** Highest "Stop after N posts". */
export const MAX_POSTS_LIMIT = 999;

/** Posting statuses that count as having gone out, or being lined up to. */
export const COUNTED_STATUSES = [
  "scheduled",
  "posting",
  "posted",
  "partial",
  "removing",
  "removed",
] as const;

/** How many postings a content item has, when one last went out, and when the next goes. */
export interface ContentStats {
  /** Postings that went out or are lined up; drafts and failures don't count. */
  count: number;
  lastPostedAt: Date | null;
  nextAt: Date | null;
}

export const NO_STATS: ContentStats = { count: 0, lastPostedAt: null, nextAt: null };

/**
 * A content item's captions in order; caption 1 is the body.
 * @param item - The item's words.
 * @param item.body - Caption 1.
 * @param item.altCaptions - The rest.
 * @returns Every caption, blanks included so the numbers stay put.
 */
export function captionsOf(item: {
  body: string;
  altCaptions?: readonly string[] | null;
}): string[] {
  return [item.body, ...(item.altCaptions ?? [])];
}

/**
 * The caption to use from an index on, skipping blank ones and going round to the start. An
 * index past the end (a caption was removed) starts from caption 1.
 * @param captions - From {@link captionsOf}.
 * @param index - The caption wanted, or null for the first.
 * @returns A caption index; 0 when every caption is blank.
 */
export function clampCaption(
  captions: readonly string[],
  index: number | null | undefined,
): number {
  const n = captions.length;
  const start =
    typeof index === "number" && Number.isInteger(index) && index >= 0 && index < n ? index : 0;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (captions[i]?.trim()) return i;
  }
  return 0;
}

/**
 * The caption after one that was just used, for the item's next posting.
 * @param captions - From {@link captionsOf}.
 * @param used - The caption the posting took.
 * @returns The next index, ready for {@link clampCaption}.
 */
export function captionAfter(captions: readonly string[], used: number): number {
  return captions.length > 0 ? (used + 1) % captions.length : 0;
}

/**
 * What a posting takes from its content item: name, words, kind, media, link, promo and the Google
 * card. Caption 1 keeps each app's own words; any other caption replaces them, since they were
 * written to go with caption 1. Targets start fresh, as nothing has gone out yet.
 * @param item - The content item.
 * @param captionIndex - The caption the posting uses.
 * @param platforms - Apps to post to, when fewer than the item's; the item's own on/off still wins.
 * @returns Fields for a create or an update.
 */
export function postingContent(
  item: SocialPost,
  captionIndex: number,
  platforms?: readonly SocialPlatformKey[],
): Pick<
  SocialPost,
  | "name"
  | "body"
  | "captionIndex"
  | "format"
  | "imageUrl"
  | "imageAlt"
  | "imageWidth"
  | "imageHeight"
  | "imageOriginalUrl"
  | "moreImages"
  | "video"
  | "linkUrl"
  | "promoId"
  | "googleType"
  | "googleCta"
  | "googleUrl"
  | "googleTitle"
  | "offerStart"
  | "offerEnd"
  | "eventStartTime"
  | "eventEndTime"
  | "couponCode"
> & { targets: TargetState[] } {
  const captions = captionsOf(item);
  return {
    name: item.name,
    body: captions[captionIndex] ?? item.body,
    captionIndex,
    format: item.format,
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    imageOriginalUrl: item.imageOriginalUrl,
    moreImages: item.moreImages ?? [],
    video: item.video,
    linkUrl: item.linkUrl,
    promoId: item.promoId,
    googleType: item.googleType,
    googleCta: item.googleCta,
    googleUrl: item.googleUrl,
    googleTitle: item.googleTitle,
    offerStart: item.offerStart,
    offerEnd: item.offerEnd,
    eventStartTime: item.eventStartTime,
    eventEndTime: item.eventEndTime,
    couponCode: item.couponCode,
    targets: item.targets.map((t) => ({
      ...t,
      enabled: t.enabled && (!platforms || (platforms as readonly string[]).includes(t.platform)),
      textOverride: captionIndex === 0 ? t.textOverride : null,
      status: "pending",
      externalId: null,
      permalink: null,
      error: null,
      postedAt: null,
      removedAt: null,
      containerId: null,
      containerCreatedAt: null,
    })),
  };
}

/**
 * Everything a new posting is made with: {@link postingContent}, the item's tags, the link back,
 * draft or scheduled, and the schedule that lined it up. The email link and its skip stay on the
 * item.
 * @param item - The content item.
 * @param opts - How it goes out.
 * @param opts.captionIndex - The caption it uses.
 * @param opts.scheduledAt - When it goes out, or null for a draft posted straight away.
 * @param opts.platforms - Apps to post to, when fewer than the item's.
 * @param opts.queueId - The schedule filling a slot with it, if any.
 * @returns Fields for the create.
 */
export function postingFields(
  item: SocialPost,
  opts: {
    captionIndex: number;
    scheduledAt: Date | null;
    platforms?: readonly SocialPlatformKey[];
    queueId?: string;
  },
): ReturnType<typeof postingContent> &
  Pick<SocialPost, "tagIds" | "sourceId" | "status" | "scheduledAt" | "queueId"> {
  return {
    ...postingContent(item, opts.captionIndex, opts.platforms),
    tagIds: item.tagIds,
    sourceId: item.id,
    status: opts.scheduledAt ? "scheduled" : "draft",
    scheduledAt: opts.scheduledAt,
    queueId: opts.queueId ?? null,
  };
}

/**
 * Why a content item can't go out at a time: past its last day, or posted as often as allowed.
 * @param item - The item's limits.
 * @param item.expiresAt - Last day to post (UTC midnight of the NZ date), or null.
 * @param item.maxPosts - Most postings, or null for no limit.
 * @param stats - From contentStats.
 * @param at - When the posting would go out.
 * @returns The reason, or null when it can go.
 */
export function spentReason(
  item: { expiresAt: Date | null; maxPosts: number | null },
  stats: ContentStats,
  at: Date,
): string | null {
  const lastDay = dateKey(item.expiresAt);
  if (lastDay && nzDateKey(at) > lastDay) {
    return `Its last day to post was ${formatDateShort(item.expiresAt!)}. Change Last day to post it again.`;
  }
  if (item.maxPosts && stats.count >= item.maxPosts) {
    return `It has ${stats.count === 1 ? "1 posting" : `${stats.count} postings`}, which is its limit. Raise Stop after to post it again.`;
  }
  return null;
}

/**
 * Whether a content item has run its course, so no more postings are made from it.
 * @param item - The item's limits.
 * @param item.expiresAt - Last day to post, or null.
 * @param item.maxPosts - Most postings, or null.
 * @param stats - From contentStats.
 * @param now - The time to judge at.
 * @returns True when it's past its last day or at its limit.
 */
export function isSpent(
  item: { expiresAt: Date | null; maxPosts: number | null },
  stats: ContentStats,
  now: Date,
): boolean {
  return spentReason(item, stats, now) !== null;
}
