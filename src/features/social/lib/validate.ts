// src/features/social/lib/validate.ts
// What each platform will refuse, checked before anything is sent. Pure and free of
// server imports, so the composer runs the same rules live that publishing enforces.
// The limits come from the Graph API docs (Instagram content publishing, Pages posts)
// and the Business Profile localPosts reference.

import type { PromoWording } from "@/features/mailing/lib/render";

/** Platforms a post can go to. */
export const SOCIAL_PLATFORMS = ["facebook", "instagram", "google"] as const;
export type SocialPlatformKey = (typeof SOCIAL_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<SocialPlatformKey, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
};

/** Google post kinds, mirroring the GooglePostType enum. */
export type GooglePostType = "STANDARD" | "OFFER" | "EVENT";
/** Google post buttons, mirroring the GooglePostCta enum. */
export type GooglePostCta = "BOOK" | "CALL" | "LEARN_MORE";

export const GOOGLE_CTA_LABEL: Record<GooglePostCta, string> = {
  BOOK: "Book",
  CALL: "Call now",
  LEARN_MORE: "Learn more",
};

/**
 * One platform's settings as the rules see them. A picture here replaces the post's
 * picture on that platform only. cropApprovedFor holds the picture URL the operator
 * agreed may be cut off there, so swapping the picture asks again.
 */
export interface DraftTarget {
  platform: string;
  enabled: boolean;
  textOverride: string | null;
  imageUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  cropApprovedFor?: string | null;
}

/**
 * The parts of a post the rules look at. The Google fields are optional so a draft
 * without them reads as a plain update with no button. Offer dates arrive as Dates
 * from the database and as YYYY-MM-DD from the composer; {@link dateKey} reads both.
 */
export interface PostDraft {
  body: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  linkUrl: string | null;
  targets: DraftTarget[];
  googleType?: GooglePostType;
  googleCta?: GooglePostCta | null;
  googleTitle?: string | null;
  offerStart?: Date | string | null;
  offerEnd?: Date | string | null;
}

/** One finding. Errors block publishing; warnings only inform. */
export interface Issue {
  level: "error" | "warning";
  message: string;
}

export const FACEBOOK_MAX_CHARS = 63_206;
export const INSTAGRAM_MAX_CHARS = 2_200;
// Not in Google's reference; the limit the Business Profile editor enforces.
export const GOOGLE_MAX_CHARS = 1_500;
const INSTAGRAM_MAX_HASHTAGS = 30;
const INSTAGRAM_MAX_MENTIONS = 20;
const INSTAGRAM_MIN_WIDTH = 320;
const INSTAGRAM_MAX_WIDTH = 1440;

const PROMO_KEYS: ReadonlySet<string> = new Set(["promo", "promoOffer", "promoEnds"]);
const PLACEHOLDER_RE = /\{(\w+)\}/g;
// A hashtag or @mention starts a word, so an email address's "@" doesn't count.
const HASHTAG_RE = /(?:^|\s)#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /(?:^|\s)@[\w.]+/g;
// A run of digits with phone-style separators (spaces, dashes, brackets, a leading
// +). Slashes, dots and colons aren't separators, so dates like "14/10/2026" and
// opening hours like "10.00-17.00" never match; the digit count check in
// hasPhoneNumber drops prices and short numbers.
const PHONE_CANDIDATE_RE = /\+?\(?\d[\d\s()-]{5,}\d/g;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/**
 * Whether text holds something that reads as a phone number: 7 to 15 digits in one
 * run, which covers NZ landlines, mobiles, 0800 numbers and +64 forms.
 * @param text - Text to scan.
 * @returns True when a phone number is found.
 */
export function hasPhoneNumber(text: string): boolean {
  for (const [match] of text.matchAll(PHONE_CANDIDATE_RE)) {
    const trimmed = match.trim();
    if (ISO_DATE_RE.test(trimmed)) continue;
    const digits = trimmed.replace(/\D/g, "").length;
    if (digits >= 7 && digits <= 15) return true;
  }
  return false;
}

/**
 * A Date or YYYY-MM-DD string as YYYY-MM-DD. Offer dates are stored at UTC midnight
 * of the calendar day, so the UTC date is the day itself.
 * @param value - Stored Date, composer string, or nothing.
 * @returns The date key, or null when unset or blank.
 */
export function dateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value.trim() || null : value.toISOString().slice(0, 10);
}

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

/** A picture and its pixel size (null when unknown). */
export interface Picture {
  url: string;
  width: number | null;
  height: number | null;
}

/**
 * The picture a platform gets: its own when one has been uploaded, otherwise the post's.
 * @param post - The post.
 * @param platform - Platform key.
 * @returns The picture, or null for a text-only post there.
 */
export function pictureFor(
  post: Pick<PostDraft, "imageUrl" | "imageWidth" | "imageHeight"> & {
    targets: Pick<DraftTarget, "platform" | "imageUrl" | "imageWidth" | "imageHeight">[];
  },
  platform: string,
): Picture | null {
  const target = post.targets.find((t) => t.platform === platform);
  if (target?.imageUrl) {
    return {
      url: target.imageUrl,
      width: target.imageWidth ?? null,
      height: target.imageHeight ?? null,
    };
  }
  return post.imageUrl
    ? { url: post.imageUrl, width: post.imageWidth, height: post.imageHeight }
    : null;
}

/**
 * Shapes each platform shows whole, as width / height. Outside the range a picture is
 * cut to the nearest edge. Instagram's range is its API's accepted range (it refuses,
 * rather than cuts, anything outside); Facebook's feed cuts tall pictures to 4:5 and
 * wide ones to 1.91:1; Google shows post pictures at 4:3. Facebook's and Google's are
 * observed in the apps, not documented.
 */
export const PICTURE_FIT: Record<SocialPlatformKey, { min: number; max: number }> = {
  facebook: { min: 4 / 5, max: 1.91 },
  instagram: { min: 4 / 5, max: 1.91 },
  google: { min: 4 / 3, max: 4 / 3 },
};
// Slack for rounding when the composer shrinks a picture (1200 x 899 is still 4:3).
const FIT_SLACK = 0.005;

/**
 * Which edges a platform cuts off a picture of this size.
 * @param platform - Platform key.
 * @param width - Picture width in pixels.
 * @param height - Picture height in pixels.
 * @returns "sides" for too wide, "top and bottom" for too tall, or null when it fits.
 */
export function cropOf(
  platform: SocialPlatformKey,
  width: number,
  height: number,
): "sides" | "top and bottom" | null {
  const ratio = width / height;
  const fit = PICTURE_FIT[platform];
  if (ratio > fit.max + FIT_SLACK) return "sides";
  if (ratio < fit.min - FIT_SLACK) return "top and bottom";
  return null;
}

/**
 * The shape a platform shows a picture at: its own when it fits, otherwise the edge of
 * the range it's cut to. The previews draw the picture at this shape.
 * @param platform - Platform key.
 * @param width - Picture width, or null when unknown.
 * @param height - Picture height, or null when unknown.
 * @returns Width / height to draw at.
 */
export function shownRatio(
  platform: SocialPlatformKey,
  width: number | null,
  height: number | null,
): number {
  const fit = PICTURE_FIT[platform];
  if (!width || !height) return fit.min === fit.max ? fit.min : 1;
  return Math.min(fit.max, Math.max(fit.min, width / height));
}

/**
 * Facebook and Google cut a picture that doesn't fit their shape, so it's blocked
 * until the operator either uploads a picture for that platform or OKs the cut for
 * this exact picture. An unknown size blocks too, since the cut can't be checked.
 * @param platform - Facebook or Google.
 * @param post - The post.
 * @returns Issues found.
 */
function cropIssues(platform: "facebook" | "google", post: PostDraft): Issue[] {
  const picture = pictureFor(post, platform);
  if (!picture) return [];
  const label = PLATFORM_LABEL[platform];
  if (!picture.width || !picture.height) {
    return [
      {
        level: "error",
        message: `The picture's size is unknown, so there's no telling what ${label} cuts off. Upload it again.`,
      },
    ];
  }
  const cut = cropOf(platform, picture.width, picture.height);
  if (!cut) return [];
  const approved = post.targets.find((t) => t.platform === platform)?.cropApprovedFor;
  if (approved === picture.url) {
    return [
      { level: "warning", message: `${label} cuts off the picture's ${cut}. You've OK'd that.` },
    ];
  }
  return [
    {
      level: "error",
      message: `${label} would cut off the picture's ${cut}. Under Picture, add a picture for ${label} or OK the cut.`,
    },
  ];
}

/**
 * Facebook rules: something to post, under the length limit, and a picture it won't
 * cut without the operator's OK.
 * @param text - Unfilled text.
 * @param post - The post.
 * @returns Issues found.
 */
function facebookIssues(text: string, post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  if (!text.trim() && !pictureFor(post, "facebook")) {
    issues.push({ level: "error", message: "Add some text or a picture." });
  }
  if (text.length > FACEBOOK_MAX_CHARS) {
    issues.push({ level: "error", message: `Facebook allows ${FACEBOOK_MAX_CHARS} characters.` });
  }
  return [...issues, ...cropIssues("facebook", post)];
}

/**
 * Instagram rules: a JPEG of an accepted shape and width, and a caption within the
 * character, hashtag and mention limits. A picture outside the accepted shape can't be
 * OK'd, because Instagram refuses it rather than cutting it.
 * @param text - Unfilled text.
 * @param post - The post.
 * @returns Issues found.
 */
function instagramIssues(text: string, post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  const picture = pictureFor(post, "instagram");
  if (!picture) {
    issues.push({ level: "error", message: "Instagram needs a picture." });
  } else {
    if (!/\.jpe?g$/i.test(new URL(picture.url, "https://x.invalid").pathname)) {
      issues.push({ level: "error", message: "Instagram only takes JPEG pictures." });
    }
    const { width: w, height: h } = picture;
    if (!w || !h) {
      issues.push({
        level: "error",
        message: "The picture's size is unknown. Upload it again to post to Instagram.",
      });
    } else {
      if (cropOf("instagram", w, h)) {
        issues.push({
          level: "error",
          message:
            "Instagram only takes pictures between 4:5 portrait and 1.91:1 landscape. Under Picture, add a picture for Instagram.",
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

/**
 * Google rules: text under the length limit with no phone numbers or email addresses
 * (Google removes posts with contact details in the text; the Call button is the
 * allowed way to give a number), and an offer's title and dates. An offer ignores the
 * button and takes the link as its "Redeem online" link; an update shows a link only
 * through the Book or Learn more button. The picture's shape is checked by
 * {@link cropIssues}.
 * @param text - Unfilled text.
 * @param post - The post.
 * @returns Issues found.
 */
function googleIssues(text: string, post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  const offer = post.googleType === "OFFER" || post.googleType === "EVENT";
  if (!text.trim()) issues.push({ level: "error", message: "Google needs some text." });
  if (text.length > GOOGLE_MAX_CHARS) {
    issues.push({
      level: "error",
      message: `Google allows ${GOOGLE_MAX_CHARS.toLocaleString("en-NZ")} characters.`,
    });
  }
  if (hasPhoneNumber(text)) {
    issues.push({
      level: "error",
      message: offer
        ? "Google doesn't allow phone numbers in a post. Give Google its own text without it."
        : "Google doesn't allow phone numbers in a post. Give Google its own text without it, and use the Call now button instead.",
    });
  }
  if (EMAIL_RE.test(text)) {
    issues.push({
      level: "error",
      message:
        "Google doesn't allow email addresses in a post. Give Google its own text without it.",
    });
  }

  if (offer) {
    if (!post.googleTitle?.trim()) {
      issues.push({ level: "error", message: "A Google offer needs a title." });
    }
    const start = dateKey(post.offerStart);
    const end = dateKey(post.offerEnd);
    if (!start || !end) {
      issues.push({ level: "error", message: "A Google offer needs a start and an end date." });
    } else if (start > end) {
      issues.push({ level: "error", message: "The Google offer ends before it starts." });
    }
    return issues;
  }

  const cta = post.googleCta ?? null;
  if ((cta === "BOOK" || cta === "LEARN_MORE") && !post.linkUrl) {
    issues.push({
      level: "error",
      message: `Google's ${GOOGLE_CTA_LABEL[cta]} button needs a link. Fill in the Link.`,
    });
  }
  if (post.linkUrl && (cta === null || cta === "CALL")) {
    issues.push({
      level: "warning",
      message:
        "Google only shows a link as a button, so the link is left off there. Pick Book or Learn more under Google options to use it.",
    });
  }
  return issues;
}

/**
 * Google's text and offer rules plus its picture-shape check.
 * @param text - Final text for Google.
 * @param post - The post.
 * @returns Every Google issue.
 */
function googleRules(text: string, post: PostDraft): Issue[] {
  return [...googleIssues(text, post), ...cropIssues("google", post)];
}

const PLATFORM_RULES: Record<SocialPlatformKey, (text: string, post: PostDraft) => Issue[]> = {
  facebook: facebookIssues,
  instagram: instagramIssues,
  google: googleRules,
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
