// src/features/social/lib/links.ts
// Admin addresses for the Social pages, posts, content items, schedules and calendar views.

import type { CalendarView, ColourMode } from "@/features/social/lib/calendar";

export const SOCIAL_OVERVIEW_PATH = "/admin/social";
export const SOCIAL_POSTS_PATH = "/admin/social/posts";
export const SOCIAL_CALENDAR_PATH = "/admin/social/calendar";
export const SOCIAL_CONTENT_PATH = "/admin/social/content";
export const SOCIAL_SCHEDULES_PATH = "/admin/social/schedules";

/**
 * The calendar's address for a view, day and colour, leaving out the defaults.
 * @param opts - What to show.
 * @param opts.view - The view.
 * @param opts.date - The day it's on; today when left out.
 * @param opts.colour - What colour stands for.
 * @returns The admin address.
 */
export function calendarHref(opts: {
  view: CalendarView;
  date?: string;
  colour: ColourMode;
}): string {
  const params = new URLSearchParams();
  if (opts.view !== "month") params.set("view", opts.view);
  if (opts.date) params.set("date", opts.date);
  if (opts.colour !== "status") params.set("colour", opts.colour);
  const query = params.toString();
  return query ? `${SOCIAL_CALENDAR_PATH}?${query}` : SOCIAL_CALENDAR_PATH;
}

/**
 * Where a post or content item opens in the admin.
 * @param post - The row.
 * @param post.id - Its id.
 * @param post.isContent - Whether it's a content item, which has its own page.
 * @returns The admin address.
 */
export function postHref(post: { id: string; isContent?: boolean | null }): string {
  return post.isContent
    ? `${SOCIAL_CONTENT_PATH}/${post.id}`
    : `${SOCIAL_POSTS_PATH}?post=${post.id}`;
}
