// src/features/social/lib/library.ts
// The Content library's search, filters, sorts and summary figures. Pure and client-safe.

import type { ContentListRow } from "@/features/social/lib/content-row";
import { coverOf } from "@/features/social/lib/cover";
import { captionsOf } from "@/features/social/lib/postings-core";
import type { SocialPlatformKey } from "@/features/social/lib/validate";
import { addDaysToDateKey, nzDateKey } from "@/shared/lib/timezone-utils";

export const LIBRARY_SORTS = ["newest", "oldest", "az", "most", "longest"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const LIBRARY_SORT_LABEL: Record<LibrarySort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  az: "Name A-Z",
  most: "Most postings",
  longest: "Longest since posted",
};

/** Days ahead a last day to post counts as ending soon. */
export const ENDING_SOON_DAYS = 14;

/** What the library shows. Each "any" leaves that filter off. */
export interface LibraryFilter {
  search: string;
  /** Items with any of these tags; empty for every item. */
  tagIds: string[];
  picture: "any" | "with" | "without";
  recycling: "any" | "on" | "off";
  /** Active items can still go out; finished ones have run their course. */
  state: "any" | "active" | "finished";
  platform: SocialPlatformKey | "any";
}

export const NO_FILTER: LibraryFilter = {
  search: "",
  tagIds: [],
  picture: "any",
  recycling: "any",
  state: "any",
  platform: "any",
};

/**
 * Text folded for matching: lower case with accents and macrons off, so "maori" finds "Māori".
 * @param text - Text to fold.
 * @returns The folded text.
 */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-NZ");
}

/**
 * Whether a filter narrows anything.
 * @param filter - The filter.
 * @returns True when any part is set.
 */
export function isFiltered(filter: LibraryFilter): boolean {
  return (
    filter.search.trim() !== "" ||
    filter.tagIds.length > 0 ||
    filter.picture !== "any" ||
    filter.recycling !== "any" ||
    filter.state !== "any" ||
    filter.platform !== "any"
  );
}

/**
 * Whether a row passes a filter. Every word of the search must appear somewhere in the name,
 * the captions or the tag names.
 * @param row - The row.
 * @param filter - The filter.
 * @param words - The search folded and split into words.
 * @param tagNames - Tag names by id.
 * @returns True when it shows.
 */
function passes(
  row: ContentListRow,
  filter: LibraryFilter,
  words: string[],
  tagNames: ReadonlyMap<string, string>,
): boolean {
  const { item } = row;
  if (filter.tagIds.length > 0 && !filter.tagIds.some((id) => item.tagIds.includes(id))) {
    return false;
  }
  if (filter.picture !== "any" && (coverOf(item) !== null) !== (filter.picture === "with")) {
    return false;
  }
  if (filter.recycling !== "any" && item.recycle !== (filter.recycling === "on")) return false;
  if (filter.state !== "any" && row.spent !== (filter.state === "finished")) return false;
  if (
    filter.platform !== "any" &&
    !item.targets.some((t) => t.platform === filter.platform && t.enabled)
  ) {
    return false;
  }
  if (words.length === 0) return true;
  const haystack = foldText(
    [item.name, ...captionsOf(item), ...item.tagIds.map((id) => tagNames.get(id) ?? "")].join("\n"),
  );
  return words.every((w) => haystack.includes(w));
}

/**
 * Orders two rows for a sort; ties fall back to the name.
 * @param a - One row.
 * @param b - Another.
 * @param sort - The sort.
 * @returns Negative when a comes first.
 */
function compare(a: ContentListRow, b: ContentListRow, sort: LibrarySort): number {
  const byName = a.item.name.localeCompare(b.item.name, "en-NZ", { sensitivity: "base" });
  switch (sort) {
    case "newest":
      return b.createdAt.localeCompare(a.createdAt) || byName;
    case "oldest":
      return a.createdAt.localeCompare(b.createdAt) || byName;
    case "az":
      return byName;
    case "most":
      return b.stats.count - a.stats.count || byName;
    case "longest": {
      // Never posted counts as longest of all. ISO times sort as text.
      const at = a.stats.lastPostedAt ?? "";
      const bt = b.stats.lastPostedAt ?? "";
      return at.localeCompare(bt) || byName;
    }
  }
}

/**
 * The rows a filter and sort show.
 * @param rows - Every content item.
 * @param filter - What to show.
 * @param sort - The order.
 * @param tagNames - Tag names by id, for searching by tag.
 * @returns The rows to show, in order.
 */
export function filterLibrary(
  rows: readonly ContentListRow[],
  filter: LibraryFilter,
  sort: LibrarySort,
  tagNames: ReadonlyMap<string, string>,
): ContentListRow[] {
  const words = foldText(filter.search).split(/\s+/).filter(Boolean);
  return rows.filter((r) => passes(r, filter, words, tagNames)).sort((a, b) => compare(a, b, sort));
}

/** The library's summary figures. */
export interface LibrarySummary {
  items: number;
  /** Set to post again and again, and not finished. */
  recycling: number;
  /** Postings from these items that went out this month. */
  postedThisMonth: number;
  /** Not finished, with a last day to post in the next {@link ENDING_SOON_DAYS} days. */
  endingSoon: number;
}

/**
 * The summary figures for every item.
 * @param rows - Every content item.
 * @param postedThisMonth - Postings that went out this month, counted on the server.
 * @param now - Today, for ending soon.
 * @returns The figures.
 */
export function librarySummary(
  rows: readonly ContentListRow[],
  postedThisMonth: number,
  now: Date,
): LibrarySummary {
  const today = nzDateKey(now);
  const horizon = addDaysToDateKey(today, ENDING_SOON_DAYS);
  return {
    items: rows.length,
    recycling: rows.filter((r) => r.item.recycle && !r.spent).length,
    postedThisMonth,
    endingSoon: rows.filter(
      (r) =>
        !r.spent &&
        r.item.expiresAt !== null &&
        r.item.expiresAt >= today &&
        r.item.expiresAt <= horizon,
    ).length,
  };
}
