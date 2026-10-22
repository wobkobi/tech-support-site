// src/features/social/lib/media.ts
// Post kinds (ordinary post, reel, story, cover photo), which apps take each, the limits on
// pictures and videos, and when a run waiting on a platform's processing is due a check. Pure
// and client-safe.

import type { SocialPlatformKey } from "@/features/social/lib/validate";

/** Kinds of post, mirroring the SocialFormat enum; a stored null is "feed". */
export const SOCIAL_FORMATS = ["feed", "reel", "story", "cover"] as const;
export type SocialFormatKey = (typeof SOCIAL_FORMATS)[number];

export const FORMAT_LABEL: Record<SocialFormatKey, string> = {
  feed: "Post",
  reel: "Reel",
  story: "Story",
  cover: "Cover photo",
};

/** The kind as it reads mid-sentence: "Google doesn't take stories". */
export const FORMAT_PLURAL: Record<SocialFormatKey, string> = {
  feed: "posts",
  reel: "reels",
  story: "stories",
  cover: "cover photos",
};

/** The apps that take each kind. Google only shows ordinary posts; only a Page has a cover. */
export const FORMAT_PLATFORMS: Record<SocialFormatKey, readonly SocialPlatformKey[]> = {
  feed: ["facebook", "instagram", "google"],
  reel: ["facebook", "instagram"],
  story: ["facebook", "instagram"],
  cover: ["facebook"],
};

/** Pictures one post can carry, the first included. */
export const MAX_PICTURES = 10;
export const VIDEO_MIN_MS = 3_000;
export const VIDEO_MAX_MS = 90_000;
/** Facebook refuses longer video stories; Instagram's limit is the same. */
export const STORY_VIDEO_MAX_MS = 60_000;
export const VIDEO_MAX_BYTES = 250 * 1024 * 1024;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
/** Blob path prefix of uploaded videos and their cover frames; clean-up may delete under it. */
export const VIDEO_PREFIX = "social/video/";

/** A run waiting on a platform's processing is checked again this long after it last ran. */
export const RESUME_AFTER_MS = 4 * 60 * 1000;
/** Instagram drops a container this long after it was made. */
export const CONTAINER_TTL_MS = 24 * 60 * 60 * 1000;

/** A picture after the first, or a video, as the composer and API pass it. */
export interface MediaItem {
  kind: "image" | "video";
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number | null;
  /** A video's cover frame. */
  coverUrl: string | null;
}

/**
 * A stored format as a key.
 * @param format - Stored value; null and unknown read as an ordinary post.
 * @returns The format key.
 */
export function formatOf(format: string | null | undefined): SocialFormatKey {
  return (SOCIAL_FORMATS as readonly string[]).includes(format ?? "")
    ? (format as SocialFormatKey)
    : "feed";
}

/**
 * Whether an app takes a kind of post.
 * @param format - The kind.
 * @param platform - The app.
 * @returns True when it can go there.
 */
export function formatTakes(format: SocialFormatKey, platform: SocialPlatformKey): boolean {
  return FORMAT_PLATFORMS[format].includes(platform);
}

/**
 * Whether a kind of post can be deleted from the apps once it's up. Stories run out on their
 * own after a day and can't be deleted early; a cover photo stays until it's changed.
 * @param format - The kind.
 * @returns True for posts and reels.
 */
export function canTakeDown(format: SocialFormatKey): boolean {
  return format === "feed" || format === "reel";
}

/**
 * Whether a kind of post shows its words. Stories and cover photos have no caption.
 * @param format - The kind.
 * @returns True for posts and reels.
 */
export function usesText(format: SocialFormatKey): boolean {
  return format === "feed" || format === "reel";
}

/**
 * Whether an address is an uploaded video or one of its cover frames.
 * @param url - Blob address.
 * @returns True when it's under {@link VIDEO_PREFIX}.
 */
export function isVideoFile(url: string): boolean {
  return new URL(url, "https://x.invalid").pathname.startsWith(`/${VIDEO_PREFIX}`);
}

/**
 * Whether a run waiting on a platform is due a check: its wait is over, or, with no wait set,
 * it stalled part-way (no update for the stuck window).
 * @param post - The post's timing.
 * @param post.resumeAfter - When the wait ends, or null.
 * @param post.postingStartedAt - When the run last claimed it.
 * @param now - The time to judge at.
 * @param stuckAfterMs - How long a run without a wait may go quiet.
 * @returns True when the cron should pick it up.
 */
export function resumeDue(
  post: { resumeAfter: Date | null; postingStartedAt: Date | null },
  now: Date,
  stuckAfterMs: number,
): boolean {
  if (post.resumeAfter) return post.resumeAfter.getTime() <= now.getTime();
  return (
    post.postingStartedAt !== null && post.postingStartedAt.getTime() < now.getTime() - stuckAfterMs
  );
}

/**
 * Whether a platform has dropped what it was processing.
 * @param createdAt - When the container was made, or null when unknown.
 * @param now - The time to judge at.
 * @returns True once {@link CONTAINER_TTL_MS} has passed; an unknown age never expires.
 */
export function containerExpired(createdAt: Date | null, now: Date): boolean {
  return createdAt !== null && now.getTime() - createdAt.getTime() >= CONTAINER_TTL_MS;
}

/**
 * Every stored file a post points at, for clean-up once it's gone or replaced.
 * @param post - The post's media.
 * @param post.imageUrl - Picture 1.
 * @param post.targets - Each app's own picture.
 * @param post.moreImages - Pictures 2 onwards.
 * @param post.video - The video and its cover frame.
 * @returns The addresses, nulls included.
 */
export function mediaUrlsOf(post: {
  imageUrl: string | null;
  targets: { imageUrl: string | null }[];
  moreImages?: { url: string }[] | null;
  video?: { url: string; coverUrl: string | null } | null;
}): (string | null)[] {
  return [
    post.imageUrl,
    ...post.targets.map((t) => t.imageUrl),
    ...(post.moreImages ?? []).map((m) => m.url),
    post.video?.url ?? null,
    post.video?.coverUrl ?? null,
  ];
}

/** Prisma select for {@link mediaUrlsOf}. */
export const MEDIA_SELECT = {
  imageUrl: true,
  targets: { select: { imageUrl: true } },
  moreImages: { select: { url: true } },
  video: { select: { url: true, coverUrl: true } },
} as const;
