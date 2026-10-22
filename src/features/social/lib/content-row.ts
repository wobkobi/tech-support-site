// src/features/social/lib/content-row.ts
// Plain-data content item shapes for the server > client boundary: the item and how often it
// has gone out.

import { toPostRow, type SocialPostRow } from "@/features/social/lib/post-row";
import { isSpent, type ContentStats } from "@/features/social/lib/postings-core";
import type { SocialPost } from "@prisma/client";

/** How often a content item has gone out, as plain data. */
export interface ContentStatsRow {
  count: number;
  lastPostedAt: string | null;
  nextAt: string | null;
}

/** A content item in the list. */
export interface ContentListRow {
  item: SocialPostRow;
  stats: ContentStatsRow;
  /** Past its last day or at its limit, so nothing more goes out from it. */
  spent: boolean;
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
 * Maps a content item and its stats to its list row.
 * @param item - Item as stored.
 * @param stats - Its stats.
 * @param now - The time to judge spent at.
 * @returns The list row.
 */
export function toContentRow(item: SocialPost, stats: ContentStats, now: Date): ContentListRow {
  return { item: toPostRow(item), stats: toStatsRow(stats), spent: isSpent(item, stats, now) };
}
