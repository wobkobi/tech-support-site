// src/features/social/components/social-list-helpers.ts
// Wording helpers shared by the Social page's start buttons, in-progress chips and
// Posted list.

import type { SocialPostRow } from "@/features/social/lib/post-row";
import { formatDateTimeShort } from "@/shared/lib/date-format";

/**
 * Where an unfinished post is at, for its chip.
 * @param p - Post row.
 * @returns Wording and colour.
 */
export function chipStatus(p: SocialPostRow): { text: string; className: string } {
  switch (p.status) {
    case "scheduled":
      return {
        text: `Posts ${formatDateTimeShort(p.scheduledAt ?? p.updatedAt)}`,
        className: "text-russian-violet",
      };
    case "posting":
      return { text: "Going out now", className: "text-amber-800" };
    case "removing":
      return { text: "Being taken down", className: "text-amber-800" };
    case "partial":
      return { text: "Only partly posted", className: "text-amber-800" };
    case "failed":
      return { text: "Didn't post", className: "text-red-700" };
    default:
      return {
        text: `Draft, edited ${formatDateTimeShort(p.updatedAt)}`,
        className: "text-admin-muted",
      };
  }
}

/**
 * The date that matters for a row: when it went or will go out, else last edit.
 * @param p - Post row.
 * @returns Label for the date line.
 */
export function dateLabel(p: SocialPostRow): string {
  if (p.status === "posting") return "Going out now";
  if (p.status === "failed") return `Didn't post ${formatDateTimeShort(p.postedAt ?? p.updatedAt)}`;
  if (p.postedAt) return `Posted ${formatDateTimeShort(p.postedAt)}`;
  if (p.scheduledAt) return `Posts ${formatDateTimeShort(p.scheduledAt)}`;
  return `Edited ${formatDateTimeShort(p.updatedAt)}`;
}

/**
 * First line of a post's text, for a one-line summary.
 * @param body - Post text.
 * @returns The first non-empty line, or "".
 */
export function firstLine(body: string): string {
  return body.split("\n").find((l) => l.trim()) ?? "";
}
