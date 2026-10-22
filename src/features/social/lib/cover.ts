// src/features/social/lib/cover.ts
// The picture that stands for a post or content item on a card. Pure and client-safe.

import type { SocialPostRow } from "@/features/social/lib/post-row";

/** A card's picture. */
export interface Cover {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/**
 * A post's cover: a reel's or story's video frame, its own picture (picture 1 of a carousel), or
 * else the first app picture of an app it's on (Facebook, then Instagram, then Google).
 * @param post - The post.
 * @returns The cover, or null when it has no picture anywhere.
 */
export function coverOf(
  post: Pick<SocialPostRow, "imageUrl" | "imageAlt" | "imageWidth" | "imageHeight" | "targets"> &
    Partial<Pick<SocialPostRow, "format" | "video">>,
): Cover | null {
  if (post.format !== "feed" && post.format !== "cover" && post.video?.coverUrl) {
    return {
      url: post.video.coverUrl,
      alt: post.video.alt ?? "",
      width: post.video.width,
      height: post.video.height,
    };
  }
  if (post.imageUrl) {
    return {
      url: post.imageUrl,
      alt: post.imageAlt ?? "",
      width: post.imageWidth,
      height: post.imageHeight,
    };
  }
  const own = post.targets.find((t) => t.enabled && t.imageUrl);
  return own?.imageUrl
    ? { url: own.imageUrl, alt: own.imageAlt ?? "", width: own.imageWidth, height: own.imageHeight }
    : null;
}
