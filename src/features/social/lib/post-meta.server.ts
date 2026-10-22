// src/features/social/lib/post-meta.server.ts
// Server-only: writes a post's side fields (its email link, tags and next caption) without
// touching updatedAt, so the open composer doesn't remount and the posts list keeps its order.

import { prisma } from "@/shared/lib/prisma";
import type { SocialPost } from "@prisma/client";

/** The side fields a post can have written without counting as an edit. */
export interface PostMetaFields {
  campaignId?: string | null;
  emailSkipped?: boolean;
  tagIds?: string[];
  nextCaption?: number;
}

/**
 * Writes a post's side fields without bumping updatedAt, which would remount the open composer
 * and drop its unsaved edits. Written conditionally on updatedAt and re-read on a race.
 * @param id - Post id.
 * @param change - Given the stored post, the fields to write, or null to refuse.
 * @returns "done", "refused" when change said no, or "missing" when the post is gone.
 */
export async function writePostMeta(
  id: string,
  change: (post: SocialPost) => PostMetaFields | null,
): Promise<"done" | "refused" | "missing"> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const post = await prisma.socialPost.findUnique({ where: { id } });
    if (!post) return "missing";
    const data = change(post);
    if (!data) return "refused";
    const result = await prisma.socialPost.updateMany({
      where: { id, updatedAt: post.updatedAt },
      data: { ...data, updatedAt: post.updatedAt },
    });
    if (result.count > 0) return "done";
  }
  throw new Error(`Post ${id} kept changing while its side fields were written.`);
}
