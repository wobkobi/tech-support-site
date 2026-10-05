// src/features/social/lib/validate.ts
// What each platform will refuse, checked before anything is sent. Pure and free of
// server imports, so the composer runs the same rules live that publishing enforces.
// The limits come from the Graph API docs (Instagram content publishing, Pages posts).

import type { PromoWording } from "@/features/mailing/lib/render";

/** Platforms a post can go to. Google joins once its API access is approved. */
export const SOCIAL_PLATFORMS = ["facebook", "instagram"] as const;
export type SocialPlatformKey = (typeof SOCIAL_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<SocialPlatformKey, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
};

/** The parts of a post the rules look at. */
export interface PostDraft {
  body: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  linkUrl: string | null;
  targets: { platform: string; enabled: boolean; textOverride: string | null }[];
}

/** One finding. Errors block publishing; warnings only inform. */
export interface Issue {
  level: "error" | "warning";
  message: string;
}

export const FACEBOOK_MAX_CHARS = 63_206;
export const INSTAGRAM_MAX_CHARS = 2_200;
const INSTAGRAM_MAX_HASHTAGS = 30;
const INSTAGRAM_MAX_MENTIONS = 20;
// Instagram's accepted aspect range, width / height: 4:5 portrait to 1.91:1 landscape.
const INSTAGRAM_MIN_RATIO = 4 / 5;
const INSTAGRAM_MAX_RATIO = 1.91;
const INSTAGRAM_MIN_WIDTH = 320;
const INSTAGRAM_MAX_WIDTH = 1440;

const PROMO_KEYS: ReadonlySet<string> = new Set(["promo", "promoOffer", "promoEnds"]);
const PLACEHOLDER_RE = /\{(\w+)\}/g;
// A hashtag or @mention starts a word, so an email address's "@" doesn't count.
const HASHTAG_RE = /(?:^|\s)#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /(?:^|\s)@[\w.]+/g;

/**
 * The text a platform gets before placeholders are filled: its override when one
 * has been typed, otherwise the shared body.
 * @param post - The post.
 * @param platform - Platform key.
 * @returns Unfilled text.
 */
export function textFor(post: PostDraft, platform: string): string {
  const override = post.targets.find((t) => t.platform === platform)?.textOverride;
  return override?.trim() ? override : post.body;
}

/**
 * Fills the promo placeholders. Used by both the composer preview and publishing,
 * so what the preview shows is what goes out. Name placeholders and unknown `{word}`s
 * stay visible; the validator blocks them before anything is posted.
 * @param text - Unfilled text.
 * @param promo - Promo wording, or null (promo placeholders then go blank).
 * @returns The filled text.
 */
export function fillPromo(text: string, promo: PromoWording | null): string {
  const values: Record<string, string> = {
    promo: promo?.summary ?? "",
    promoOffer: promo?.offer ?? "",
    promoEnds: promo?.ends ?? "",
  };
  return text.replace(PLACEHOLDER_RE, (whole, key: string) => values[key] ?? whole);
}

/**
 * Placeholder problems shared by every platform. Only the promo placeholders mean
 * anything in a post, since it isn't addressed to one person.
 * @param text - Unfilled text.
 * @param hasPromo - Whether a promo will be there to fill the promo placeholders.
 * @returns Issues found.
 */
function placeholderIssues(text: string, hasPromo: boolean): Issue[] {
  const issues: Issue[] = [];
  const keys = new Set(Array.from(text.matchAll(PLACEHOLDER_RE), (m) => m[1]!));
  for (const key of keys) {
    if (key === "firstName" || key === "name") {
      issues.push({
        level: "error",
        message: `{${key}} only works in emails; a post isn't addressed to one person.`,
      });
    } else if (!PROMO_KEYS.has(key)) {
      issues.push({ level: "error", message: `{${key}} isn't a placeholder. Check the spelling.` });
    } else if (!hasPromo) {
      issues.push({
        level: "error",
        message: `{${key}} needs a running promo, and there isn't one.`,
      });
    }
  }
  return issues;
}

/**
 * Facebook rules: something to post, and under the length limit.
 * @param text - Unfilled text.
 * @param post - The post.
 * @returns Issues found.
 */
function facebookIssues(text: string, post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  if (!text.trim() && !post.imageUrl) {
    issues.push({ level: "error", message: "Add some text or a picture." });
  }
  if (text.length > FACEBOOK_MAX_CHARS) {
    issues.push({ level: "error", message: `Facebook allows ${FACEBOOK_MAX_CHARS} characters.` });
  }
  return issues;
}

/**
 * Instagram rules: a JPEG of an accepted shape and width, and a caption within the
 * character, hashtag and mention limits.
 * @param text - Unfilled text.
 * @param post - The post.
 * @returns Issues found.
 */
function instagramIssues(text: string, post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  if (!post.imageUrl) {
    issues.push({ level: "error", message: "Instagram needs a picture." });
  } else {
    if (!/\.jpe?g$/i.test(new URL(post.imageUrl, "https://x.invalid").pathname)) {
      issues.push({ level: "error", message: "Instagram only takes JPEG pictures." });
    }
    const { imageWidth: w, imageHeight: h } = post;
    if (!w || !h) {
      issues.push({
        level: "error",
        message: "The picture's size is unknown. Upload it again to post to Instagram.",
      });
    } else {
      const ratio = w / h;
      if (ratio < INSTAGRAM_MIN_RATIO - 0.005 || ratio > INSTAGRAM_MAX_RATIO + 0.005) {
        issues.push({
          level: "error",
          message:
            "Instagram needs a picture between 4:5 portrait and 1.91:1 landscape. Crop it and upload it again.",
        });
      }
      if (w < INSTAGRAM_MIN_WIDTH || w > INSTAGRAM_MAX_WIDTH) {
        issues.push({
          level: "error",
          message: `Instagram needs a picture ${INSTAGRAM_MIN_WIDTH} to ${INSTAGRAM_MAX_WIDTH} pixels wide.`,
        });
      }
    }
  }
  if (text.length > INSTAGRAM_MAX_CHARS) {
    issues.push({ level: "error", message: `Instagram allows ${INSTAGRAM_MAX_CHARS} characters.` });
  }
  if ((text.match(HASHTAG_RE) ?? []).length > INSTAGRAM_MAX_HASHTAGS) {
    issues.push({
      level: "error",
      message: `Instagram allows ${INSTAGRAM_MAX_HASHTAGS} hashtags.`,
    });
  }
  if ((text.match(MENTION_RE) ?? []).length > INSTAGRAM_MAX_MENTIONS) {
    issues.push({
      level: "error",
      message: `Instagram allows ${INSTAGRAM_MAX_MENTIONS} @mentions.`,
    });
  }
  if (post.linkUrl) {
    issues.push({
      level: "warning",
      message: "Instagram doesn't make links clickable, so the link is left off there.",
    });
  }
  return issues;
}

const PLATFORM_RULES: Record<SocialPlatformKey, (text: string, post: PostDraft) => Issue[]> = {
  facebook: facebookIssues,
  instagram: instagramIssues,
};

/**
 * Every enabled platform's issues.
 * @param post - The post.
 * @param hasPromo - Whether a promo will be there to fill the promo placeholders.
 * @returns Issues per enabled platform; disabled platforms are left out.
 */
export function validatePost(
  post: PostDraft,
  hasPromo: boolean,
): Partial<Record<SocialPlatformKey, Issue[]>> {
  const out: Partial<Record<SocialPlatformKey, Issue[]>> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    if (!post.targets.some((t) => t.platform === platform && t.enabled)) continue;
    const text = textFor(post, platform);
    out[platform] = [...placeholderIssues(text, hasPromo), ...PLATFORM_RULES[platform](text, post)];
  }
  return out;
}

/**
 * Whether anything blocks publishing: an error on any enabled platform, or no
 * platform enabled at all.
 * @param issues - Output of {@link validatePost}.
 * @returns The blocking messages, prefixed with the platform name.
 */
export function blockingIssues(issues: Partial<Record<SocialPlatformKey, Issue[]>>): string[] {
  const platforms = Object.keys(issues) as SocialPlatformKey[];
  if (platforms.length === 0) return ["Pick at least one platform."];
  return platforms.flatMap((p) =>
    (issues[p] ?? [])
      .filter((i) => i.level === "error")
      .map((i) => `${PLATFORM_LABEL[p]}: ${i.message}`),
  );
}
