// src/features/social/lib/validate.ts
// What each platform will refuse, checked before sending. Pure, so the composer runs the same
// rules live. Limits from the Graph API and Business Profile localPosts docs.

import type { PromoWording } from "@/features/mailing/lib/render";
import {
  FORMAT_PLURAL,
  MAX_PICTURES,
  STORY_VIDEO_MAX_MS,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_MS,
  VIDEO_MIN_MS,
  formatOf,
  formatTakes,
  usesText,
} from "@/features/social/lib/media";

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
export type GooglePostCta = "BOOK" | "ORDER" | "SHOP" | "LEARN_MORE" | "SIGN_UP" | "CALL";

/** Google's button wording, in the order the composer lists them. */
export const GOOGLE_CTA_LABEL: Record<GooglePostCta, string> = {
  BOOK: "Book",
  ORDER: "Order online",
  SHOP: "Buy",
  LEARN_MORE: "Learn more",
  SIGN_UP: "Sign up",
  CALL: "Call now",
};

/**
 * One platform's settings. Its picture overrides the post's there; cropApprovedFor holds the
 * URL whose cut was OK'd, so a new picture asks again.
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

/** A picture after the first, or a video, as the rules read it. Sizes are pixels. */
export interface DraftMedia {
  url: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  sizeBytes?: number | null;
}

/**
 * The parts of a post the rules read. Google fields are optional; offer dates come as Dates
 * or YYYY-MM-DD, both read by {@link dateKey}.
 */
export interface PostDraft {
  body: string;
  /** The kind of post; null or missing is an ordinary post. */
  format?: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  /** Pictures 2 onwards of an ordinary post. */
  moreImages?: DraftMedia[] | null;
  /** A reel's or story's video. */
  video?: DraftMedia | null;
  linkUrl: string | null;
  targets: DraftTarget[];
  googleType?: GooglePostType;
  googleCta?: GooglePostCta | null;
  /** Where Google's button goes instead of the Link. */
  googleUrl?: string | null;
  googleTitle?: string | null;
  offerStart?: Date | string | null;
  offerEnd?: Date | string | null;
  /** An event's NZ "HH:MM" times; both empty for all day. */
  eventStartTime?: string | null;
  eventEndTime?: string | null;
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
// Reels and stories fill a phone screen at 9:16; Facebook's cover shows at about 2.6:1.
const PORTRAIT = 9 / 16;
const COVER_RATIO = 1640 / 624;
const COVER_MIN_WIDTH = 400;
const COVER_MIN_HEIGHT = 150;

const PROMO_KEYS: ReadonlySet<string> = new Set(["promo", "promoOffer", "promoEnds"]);
const PLACEHOLDER_RE = /\{(\w+)\}/g;
// A hashtag or @mention starts a word, so an email address's "@" doesn't count.
const HASHTAG_RE = /(?:^|\s)#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /(?:^|\s)@[\w.]+/g;
// Digits with phone separators (spaces, dashes, brackets, leading +). Slashes, dots and colons
// aren't separators, so "14/10/2026" and "10.00-17.00" never match.
const PHONE_CANDIDATE_RE = /\+?\(?\d[\d\s()-]{5,}\d/g;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
/** A 24-hour "HH:MM" time. */
export const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
// An emoji character, apart from the copyright, registered and trademark signs, which apps
// count as one like any letter.
const EMOJI_CHAR_RE = /(?![©®™])[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const GRAPHEMES =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

/**
 * Length as the apps count it: each emoji counts at least two, and a character built from
 * several code units (an emoji family, an accent typed separately) counts every unit.
 * @param text - Text to measure.
 * @returns The count to hold against an app's limit.
 */
export function charCount(text: string): number {
  if (!GRAPHEMES) return text.length;
  let count = 0;
  for (const { segment } of GRAPHEMES.segment(text)) {
    count += Math.max(segment.length, EMOJI_CHAR_RE.test(segment) ? 2 : 1);
  }
  return count;
}

/**
 * Where Google's button goes: its own link when one is set, otherwise the post's Link.
 * @param post - The post's links.
 * @param post.googleUrl - Google's own button link, if any.
 * @param post.linkUrl - The post's Link, if any.
 * @returns The address, or null when there's neither.
 */
export function googleButtonUrl(post: {
  googleUrl?: string | null;
  linkUrl: string | null;
}): string | null {
  return post.googleUrl?.trim() || post.linkUrl || null;
}

/**
 * Whether text holds a phone number: 7 to 15 digits in one run (NZ landlines, mobiles, 0800, +64).
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
 * A Date or YYYY-MM-DD as YYYY-MM-DD; stored at UTC midnight, so the UTC date is the day.
 * @param value - Stored Date, composer string, or nothing.
 * @returns The date key, or null when unset or blank.
 */
export function dateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value.trim() || null : value.toISOString().slice(0, 10);
}

/**
 * A platform's unfilled text: its override if typed, else the shared body.
 * @param post - The post.
 * @param platform - Platform key.
 * @returns Unfilled text.
 */
export function textFor(post: PostDraft, platform: string): string {
  const override = post.targets.find((t) => t.platform === platform)?.textOverride;
  return override?.trim() ? override : post.body;
}

/**
 * Fills promo placeholders, for both preview and publishing. Name placeholders and unknown
 * `{word}`s stay visible for the validator to block.
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
 * Placeholder problems for every platform; only promo placeholders are valid in a post.
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
 * Shapes each platform shows whole (width / height); outside, it cuts to the nearest edge.
 * Instagram refuses outside its API range; Facebook and Google values are observed, not documented.
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
 * The shape a platform shows a picture at: its own if it fits, else the nearest range edge.
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
 * Facebook and Google crop misfit pictures, so they block until a platform picture is uploaded
 * or the cut is OK'd for this picture. An unknown size blocks too.
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
 * The rules every picture count shares: no more than {@link MAX_PICTURES}, and picture 1 there
 * when others are.
 * @param post - The post.
 * @returns Issues found.
 */
function pictureCountIssues(post: PostDraft): Issue[] {
  const more = post.moreImages ?? [];
  if (more.length === 0) return [];
  if (!post.imageUrl) {
    return [
      {
        level: "error",
        message: "The first picture is missing. Move one of the others to the front.",
      },
    ];
  }
  return more.length + 1 > MAX_PICTURES
    ? [{ level: "error", message: `A post can have ${MAX_PICTURES} pictures at most.` }]
    : [];
}

/**
 * Facebook's length limit.
 * @param text - Unfilled text.
 * @returns Issues found.
 */
function facebookTextIssues(text: string): Issue[] {
  return charCount(text) > FACEBOOK_MAX_CHARS
    ? [{ level: "error", message: `Facebook allows ${FACEBOOK_MAX_CHARS} characters.` }]
    : [];
}

/**
 * Facebook rules: something to post, within the length limit, no un-OK'd crop. Several pictures
 * go into a grid that cuts each to fit, so only a single picture's crop is checked.
 * @param text - Unfilled text.
 * @param post - The post.
 * @returns Issues found.
 */
function facebookIssues(text: string, post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  if (!text.trim() && !pictureFor(post, "facebook")) {
    issues.push({ level: "error", message: "Add some text or a picture." });
  }
  issues.push(...facebookTextIssues(text), ...pictureCountIssues(post));
  if ((post.moreImages ?? []).length > 0) {
    issues.push({
      level: "warning",
      message:
        "Facebook shows several pictures together in a grid, cut to fit. Each opens in full when tapped.",
    });
    return issues;
  }
  return [...issues, ...cropIssues("facebook", post)];
}

/**
 * Instagram's rules for one picture: a JPEG of an accepted shape and width. Shape can't be OK'd,
 * as Instagram refuses rather than cuts.
 * @param picture - The picture.
 * @param n - Its place in the post, from 1.
 * @returns Issues found.
 */
function instagramPictureIssues(picture: Picture, n: number): Issue[] {
  const issues: Issue[] = [];
  const which = n === 1 ? "" : `Picture ${n}: `;
  if (!/\.jpe?g$/i.test(new URL(picture.url, "https://x.invalid").pathname)) {
    issues.push({ level: "error", message: `${which}Instagram only takes JPEG pictures.` });
  }
  const { width: w, height: h } = picture;
  if (!w || !h) {
    issues.push({
      level: "error",
      message: `${n === 1 ? "The picture's" : `Picture ${n}'s`} size is unknown. Upload it again to post to Instagram.`,
    });
    return issues;
  }
  if (cropOf("instagram", w, h)) {
    issues.push({
      level: "error",
      message: `${which}Instagram only takes pictures between 4:5 portrait and 1.91:1 landscape. ${n === 1 ? "Under Picture, add a picture for Instagram." : "Swap it for one that fits."}`,
    });
  }
  if (w < INSTAGRAM_MIN_WIDTH || w > INSTAGRAM_MAX_WIDTH) {
    issues.push({
      level: "error",
      message: `${which}Instagram needs a picture ${INSTAGRAM_MIN_WIDTH} to ${INSTAGRAM_MAX_WIDTH} pixels wide.`,
    });
  }
  return issues;
}

/**
 * Instagram rules: accepted pictures (each one in a carousel) and a caption within its limits.
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
    issues.push(...instagramPictureIssues(picture, 1));
    const more = post.moreImages ?? [];
    more.forEach((m, i) => {
      issues.push(
        ...instagramPictureIssues(
          { url: m.url, width: m.width ?? null, height: m.height ?? null },
          i + 2,
        ),
      );
    });
    // A carousel shows every picture at the first one's shape.
    const first = shownRatio("instagram", picture.width, picture.height);
    if (
      more.some(
        (m) =>
          Math.abs(shownRatio("instagram", m.width ?? null, m.height ?? null) - first) >
          FIT_SLACK * 4,
      )
    ) {
      issues.push({
        level: "warning",
        message:
          "Instagram shows every picture at picture 1's shape, so the others get cut to match.",
      });
    }
  }
  issues.push(...pictureCountIssues(post), ...instagramCaptionIssues(text, post));
  return issues;
}

/**
 * Instagram's caption limits, and the link it can't make clickable.
 * @param text - Unfilled text.
 * @param post - The post.
 * @returns Issues found.
 */
function instagramCaptionIssues(text: string, post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  if (charCount(text) > INSTAGRAM_MAX_CHARS) {
    issues.push({
      level: "error",
      message: `Instagram allows ${INSTAGRAM_MAX_CHARS.toLocaleString("en-NZ")} characters.`,
    });
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
 * An offer's or event's title and dates, and an event's times: both or neither.
 * @param post - The post.
 * @param what - "offer" or "event", for the messages.
 * @returns Issues found.
 */
function datedIssues(post: PostDraft, what: "offer" | "event"): Issue[] {
  const issues: Issue[] = [];
  if (!post.googleTitle?.trim()) {
    issues.push({ level: "error", message: `A Google ${what} needs a title.` });
  }
  const start = dateKey(post.offerStart);
  const end = dateKey(post.offerEnd);
  if (!start || !end) {
    issues.push({ level: "error", message: `A Google ${what} needs a start and an end date.` });
  } else if (start > end) {
    issues.push({ level: "error", message: `The Google ${what} ends before it starts.` });
  }
  if (what === "offer") return issues;

  const from = post.eventStartTime?.trim() || null;
  const to = post.eventEndTime?.trim() || null;
  if (Boolean(from) !== Boolean(to)) {
    issues.push({
      level: "error",
      message: "Give the Google event a start and an end time, or tick All day.",
    });
  } else if (from && to) {
    if (!TIME_RE.test(from) || !TIME_RE.test(to)) {
      issues.push({ level: "error", message: "Event times must be like 09:30." });
    } else if (start && start === end && from >= to) {
      issues.push({ level: "error", message: "The Google event ends before it starts." });
    }
  }
  return issues;
}

/**
 * Google's button on an update or event: one that opens a page needs a link, and an event
 * can't ring. A Link with no button that uses it is left off, so that only warns.
 * @param post - The post.
 * @returns Issues found.
 */
function buttonIssues(post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  const cta = post.googleCta ?? null;
  const event = post.googleType === "EVENT";
  if (cta === "CALL" && event) {
    issues.push({
      level: "error",
      message: "A Google event can't have a Call now button. Pick another button or none.",
    });
  } else if (cta && cta !== "CALL" && !googleButtonUrl(post)) {
    issues.push({
      level: "error",
      message: `Google's ${GOOGLE_CTA_LABEL[cta]} button needs a link. Fill in the Link or the Google button link.`,
    });
  }
  const opensPage = cta !== null && cta !== "CALL";
  if (post.linkUrl && !post.googleUrl?.trim() && !opensPage) {
    issues.push({
      level: "warning",
      message:
        "Google only shows a link as a button, so the link is left off there. Pick a button under Google options to use it.",
    });
  }
  if (post.googleUrl?.trim() && !opensPage) {
    issues.push({
      level: "warning",
      message: "The Google button link is only used with a button that opens a page.",
    });
  }
  return issues;
}

/**
 * Google rules: within the length limit, no phone numbers or emails in the text (Google removes
 * those posts), an offer's or event's title and dates, and the button. Shape is checked by
 * {@link cropIssues}.
 * @param text - Unfilled text.
 * @param post - The post.
 * @returns Issues found.
 */
function googleIssues(text: string, post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  const type = post.googleType ?? "STANDARD";
  if (!text.trim()) issues.push({ level: "error", message: "Google needs some text." });
  if (charCount(text) > GOOGLE_MAX_CHARS) {
    issues.push({
      level: "error",
      message: `Google allows ${GOOGLE_MAX_CHARS.toLocaleString("en-NZ")} characters.`,
    });
  }
  if (hasPhoneNumber(text)) {
    issues.push({
      level: "error",
      message:
        type === "STANDARD"
          ? "Google doesn't allow phone numbers in a post. Give Google its own text without it, and use the Call now button instead."
          : "Google doesn't allow phone numbers in a post. Give Google its own text without it.",
    });
  }
  if (EMAIL_RE.test(text)) {
    issues.push({
      level: "error",
      message:
        "Google doesn't allow email addresses in a post. Give Google its own text without it.",
    });
  }

  // An offer's Link is its "Redeem online" link and it has no button.
  if (type === "OFFER") return [...issues, ...datedIssues(post, "offer")];
  if (type === "EVENT") issues.push(...datedIssues(post, "event"));
  return [...issues, ...buttonIssues(post)];
}

/**
 * Google's text and offer rules plus its picture-shape check. Google takes one picture.
 * @param text - Final text for Google.
 * @param post - The post.
 * @returns Every Google issue.
 */
function googleRules(text: string, post: PostDraft): Issue[] {
  const issues = [...googleIssues(text, post), ...cropIssues("google", post)];
  if ((post.moreImages ?? []).length > 0) {
    issues.push({ level: "warning", message: "Google shows the first picture only." });
  }
  return issues;
}

const PLATFORM_RULES: Record<SocialPlatformKey, (text: string, post: PostDraft) => Issue[]> = {
  facebook: facebookIssues,
  instagram: instagramIssues,
  google: googleRules,
};

/**
 * Whether a size is close to 9:16 portrait.
 * @param width - Pixels wide.
 * @param height - Pixels high.
 * @returns True within a small slack.
 */
function isPortrait(width: number, height: number): boolean {
  return Math.abs(width / height - PORTRAIT) <= 0.02;
}

/**
 * A reel's or story's video: MP4 or MOV, 3 seconds to its limit, under the size cap, and a warning
 * when it isn't 9:16.
 * @param video - The video.
 * @param maxMs - Longest it may run.
 * @param what - "reel" or "story", for the messages.
 * @returns Issues found.
 */
function videoIssues(video: DraftMedia, maxMs: number, what: "reel" | "story"): Issue[] {
  const issues: Issue[] = [];
  if (!/\.(mp4|mov)$/i.test(new URL(video.url, "https://x.invalid").pathname)) {
    issues.push({ level: "error", message: "Use an MP4 or MOV video." });
  }
  const ms = video.durationMs ?? null;
  if (!ms) {
    issues.push({ level: "error", message: "The video's length is unknown. Upload it again." });
  } else if (ms < VIDEO_MIN_MS) {
    issues.push({
      level: "error",
      message: `A ${what} must be at least ${VIDEO_MIN_MS / 1000} seconds long.`,
    });
  } else if (ms > maxMs) {
    issues.push({
      level: "error",
      message: `A ${what} video can be up to ${maxMs / 1000} seconds long. Trim it first.`,
    });
  }
  if (video.sizeBytes && video.sizeBytes > VIDEO_MAX_BYTES) {
    issues.push({
      level: "error",
      message: `The video is over ${VIDEO_MAX_BYTES / 1024 / 1024} MB. Export it smaller.`,
    });
  }
  if (video.width && video.height && !isPortrait(video.width, video.height)) {
    issues.push({
      level: "warning",
      message: `A ${what} fills the screen at 9:16 portrait (1080 x 1920). This video shows with bars or cut to fit.`,
    });
  }
  return issues;
}

/**
 * Reel rules: a video, and the app's caption limits.
 * @param text - Unfilled text.
 * @param post - The post.
 * @param platform - Facebook or Instagram.
 * @returns Issues found.
 */
function reelIssues(text: string, post: PostDraft, platform: SocialPlatformKey): Issue[] {
  const issues: Issue[] = post.video
    ? videoIssues(post.video, VIDEO_MAX_MS, "reel")
    : [{ level: "error", message: "A reel needs a video." }];
  issues.push(
    ...(platform === "instagram" ? instagramCaptionIssues(text, post) : facebookTextIssues(text)),
  );
  return issues;
}

/**
 * Story rules: a picture (a JPEG for Instagram) or a video of up to a minute. Stories show no
 * words or link, and the composer hides both, so neither is checked.
 * @param post - The post.
 * @param platform - Facebook or Instagram.
 * @returns Issues found.
 */
function storyIssues(post: PostDraft, platform: SocialPlatformKey): Issue[] {
  const issues: Issue[] = [];
  const picture = pictureFor(post, platform);
  if (post.video) {
    issues.push(...videoIssues(post.video, STORY_VIDEO_MAX_MS, "story"));
    if (picture) {
      issues.push({
        level: "warning",
        message: "The story uses the video. Remove it to post the picture instead.",
      });
    }
  } else if (!picture) {
    issues.push({ level: "error", message: "A story needs a picture or a video." });
  } else {
    if (
      platform === "instagram" &&
      !/\.jpe?g$/i.test(new URL(picture.url, "https://x.invalid").pathname)
    ) {
      issues.push({ level: "error", message: "Instagram only takes JPEG pictures." });
    }
    if (!picture.width || !picture.height) {
      issues.push({
        level: "error",
        message: "The picture's size is unknown. Upload it again.",
      });
    } else if (!isPortrait(picture.width, picture.height)) {
      issues.push({
        level: "warning",
        message:
          "A story fills the screen at 9:16 portrait (1080 x 1920). This picture shows with bars or cut to fit.",
      });
    }
  }
  return issues;
}

/**
 * Cover photo rules: a picture big enough for Facebook, and a warning when it isn't its shape.
 * @param post - The post.
 * @returns Issues found.
 */
function coverIssues(post: PostDraft): Issue[] {
  const issues: Issue[] = [];
  const picture = pictureFor(post, "facebook");
  if (!picture) {
    issues.push({ level: "error", message: "A cover photo needs a picture." });
  } else if (!picture.width || !picture.height) {
    issues.push({ level: "error", message: "The picture's size is unknown. Upload it again." });
  } else if (picture.width < COVER_MIN_WIDTH || picture.height < COVER_MIN_HEIGHT) {
    issues.push({
      level: "error",
      message: `Facebook needs a cover photo at least ${COVER_MIN_WIDTH} x ${COVER_MIN_HEIGHT} pixels.`,
    });
  } else if (Math.abs(picture.width / picture.height - COVER_RATIO) > 0.1) {
    issues.push({
      level: "warning",
      message:
        "Facebook shows a cover at about 2.6:1 and cuts off the rest. The Post maker's Facebook cover size fits exactly.",
    });
  }
  return issues;
}

/**
 * Every enabled platform's issues, by the kind of post. An app that doesn't take the kind is an
 * error of its own, and kinds that show no words skip the placeholder checks.
 * @param post - The post.
 * @param hasPromo - Whether a promo will be there to fill the promo placeholders.
 * @param promo - The promo wording when it's known, so the app's limits count the filled words.
 * @returns Issues per enabled platform; disabled platforms are left out.
 */
export function validatePost(
  post: PostDraft,
  hasPromo: boolean,
  promo?: PromoWording | null,
): Partial<Record<SocialPlatformKey, Issue[]>> {
  const format = formatOf(post.format);
  const out: Partial<Record<SocialPlatformKey, Issue[]>> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    if (!post.targets.some((t) => t.platform === platform && t.enabled)) continue;
    if (!formatTakes(format, platform)) {
      out[platform] = [
        {
          level: "error",
          message: `${PLATFORM_LABEL[platform]} doesn't take ${FORMAT_PLURAL[format]}. Switch it off under Post to.`,
        },
      ];
      continue;
    }
    const text = textFor(post, platform);
    const filled = promo === undefined ? text : fillPromo(text, promo);
    const rules =
      format === "reel"
        ? reelIssues(filled, post, platform)
        : format === "story"
          ? storyIssues(post, platform)
          : format === "cover"
            ? coverIssues(post)
            : PLATFORM_RULES[platform](filled, post);
    out[platform] = [...(usesText(format) ? placeholderIssues(text, hasPromo) : []), ...rules];
  }
  return out;
}

/**
 * What blocks publishing: an error on any enabled platform, or no platform enabled.
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
