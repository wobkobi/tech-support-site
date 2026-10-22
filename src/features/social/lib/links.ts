// src/features/social/lib/links.ts
// Admin addresses for the Social pages, posts, content items and schedules.

export const SOCIAL_POSTS_PATH = "/admin/social/posts";
export const SOCIAL_CONTENT_PATH = "/admin/social/content";
export const SOCIAL_SCHEDULES_PATH = "/admin/social/schedules";

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
