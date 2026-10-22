// src/features/social/lib/content-row.ts
// Plain-data content item shapes for the server > client boundary: the item, how often it has
// gone out, and the schedules it's in.

import { toPostRow, type SocialPostRow } from "@/features/social/lib/post-row";
import { isSpent, type ContentStats } from "@/features/social/lib/postings-core";
import type { SocialPost } from "@prisma/client";

/** How often a content item has gone out, as plain data. */
export interface ContentStatsRow {
  count: number;
  lastPostedAt: string | null;
  nextAt: string | null;
}

/** A content item in the library. */
export interface ContentListRow {
  item: SocialPostRow;
  /** When it was made, as an ISO time. */
  createdAt: string;
  stats: ContentStatsRow;
  /** Past its last day or at its limit, so nothing more goes out from it. */
  spent: boolean;
  /** Lined-up postings still following it, which go when it's deleted. */
  linedUp: number;
  /** The schedules it's in. */
  queueIds: string[];
  /** Average views a posting, once any posting's figures are read. */
  views: number | null;
}

/**
 * Maps stats to plain data.
 * @param stats - From contentStats.
 * @returns The plain shape.
 */
export function toStatsRow(stats: ContentStats): ContentStatsRow {
  return {
    count: stats.count,
    lastPostedAt: stats.lastPostedAt?.toISOString() ?? null,
    nextAt: stats.nextAt?.toISOString() ?? null,
  };
}

/**
 * Maps a content item and its stats to its library row.
 * @param item - Item as stored.
 * @param stats - Its stats.
 * @param linedUp - Its lined-up postings still following it.
 * @param queueIds - The schedules it's in.
 * @param now - The time to judge spent at.
 * @param views - Average views a posting, or null before any are read.
 * @returns The library row.
 */
export function toContentRow(
  item: SocialPost,
  stats: ContentStats,
  linedUp: number,
  queueIds: string[],
  now: Date,
  views: number | null,
): ContentListRow {
  return {
    item: toPostRow(item),
    createdAt: item.createdAt.toISOString(),
    stats: toStatsRow(stats),
    spent: isSpent(item, stats, now),
    linedUp,
    queueIds,
    views,
  };
}
