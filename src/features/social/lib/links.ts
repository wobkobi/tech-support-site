// src/features/social/lib/links.ts
// Admin addresses for the Social pages, posts and content items.

export const SOCIAL_POSTS_PATH = "/admin/social/posts";
export const SOCIAL_CONTENT_PATH = "/admin/social/content";

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
