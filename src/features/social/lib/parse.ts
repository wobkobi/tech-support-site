// src/features/social/lib/parse.ts
// Social API body parsing. Sparse: only fields present are returned. Target edits merge so past
// outcomes are never overwritten.

import { parseObjectId } from "@/features/business/lib/validation";
import {
  MAX_PICTURES,
  SOCIAL_FORMATS,
  isVideoFile,
  type MediaItem,
  type SocialFormatKey,
} from "@/features/social/lib/media";
import { MAX_CAPTIONS, MAX_POSTS_LIMIT } from "@/features/social/lib/postings-core";
import { MAX_POST_TAGS } from "@/features/social/lib/tags";
import type { TargetState } from "@/features/social/lib/targets";
import {
  GOOGLE_CTA_LABEL,
  SOCIAL_PLATFORMS,
  TIME_RE,
  type GooglePostCta,
  type GooglePostType,
} from "@/features/social/lib/validate";
import { BLOB_IMAGE_HOST_SUFFIX } from "@/shared/lib/blob-image";

const MAX_NAME = 120;
const MAX_BODY = 10_000;
const MAX_ALT = 300;
const MAX_URL = 2_000;

/** Editable post fields, apart from targets. */
export interface PostPatch {
  name?: string;
  body?: string;
  format?: SocialFormatKey | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageOriginalUrl?: string | null;
  moreImages?: MediaItem[];
  video?: MediaItem | null;
  linkUrl?: string | null;
  tagIds?: string[];
  promoId?: string | null;
  googleType?: GooglePostType;
  googleCta?: GooglePostCta | null;
  googleUrl?: string | null;
  googleTitle?: string | null;
  offerStart?: Date | null;
  offerEnd?: Date | null;
  eventStartTime?: string | null;
  eventEndTime?: string | null;
  couponCode?: string | null;
}

const GOOGLE_TYPES: readonly string[] = ["STANDARD", "OFFER", "EVENT"];
const GOOGLE_CTAS: readonly string[] = Object.keys(GOOGLE_CTA_LABEL);
const MAX_GOOGLE_TITLE = 100;
const MAX_COUPON = 50;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks an optional YYYY-MM-DD date, stored at UTC midnight so it reads the same anywhere.
 * @param value - Raw value.
 * @param label - Field name for the error.
 * @returns The Date or null, or an error message.
 */
function optionalDay(value: unknown, label: string): Date | null | { error: string } {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !DATE_KEY_RE.test(value)) {
    return { error: `${label} must be a date.` };
  }
  const day = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
    return { error: `${label} isn't a real date.` };
  }
  return day;
}

/**
 * Checks an optional 24-hour "HH:MM" time, where null or blank clears it.
 * @param value - Raw value.
 * @param label - Field name for the error.
 * @returns The time or null, or an error message.
 */
function optionalTime(value: unknown, label: string): string | null | { error: string } {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !TIME_RE.test(value)) {
    return { error: `${label} must be a time like 09:30.` };
  }
  return value;
}

/**
 * Checks a post's tag list: ids only, repeats dropped, at most {@link MAX_POST_TAGS}.
 * @param value - Raw value.
 * @returns The ids, or an error message.
 */
function parseTagIds(value: unknown): string[] | { error: string } {
  if (!Array.isArray(value)) return { error: "tagIds must be a list." };
  const ids: string[] = [];
  for (const raw of value) {
    const id = parseObjectId(raw);
    if (!id) return { error: "A tag id isn't valid." };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_POST_TAGS)
    return { error: `A post can have ${MAX_POST_TAGS} tags at most.` };
  return ids;
}

/** A target edit from the composer: the toggle, own text, own picture and crop OK. */
export interface TargetEdit {
  platform: string;
  enabled?: boolean;
  textOverride?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageOriginalUrl?: string | null;
  cropApprovedFor?: string | null;
}

/**
 * Checks an optional text field, where null or blank clears it.
 * @param value - Raw value.
 * @param label - Field name for the error.
 * @param max - Maximum length.
 * @returns Trimmed text or null, or an error message.
 */
function optionalText(
  value: unknown,
  label: string,
  max: number,
): string | null | { error: string } {
  if (value === null) return null;
  if (typeof value !== "string") return { error: `${label} must be text.` };
  if (value.length > max) return { error: `${label} is too long (max ${max} characters).` };
  return value.trim() || null;
}

/**
 * Checks an http(s) URL, optionally limited to one host suffix.
 * @param value - Raw value.
 * @param label - Field name for the error.
 * @param hostSuffix - Required host ending, if any.
 * @returns The URL or null, or an error message.
 */
function optionalUrl(
  value: unknown,
  label: string,
  hostSuffix?: string,
): string | null | { error: string } {
  const text = optionalText(value, label, MAX_URL);
  if (text === null || typeof text !== "string") return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: `${label} isn't a valid web address.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: `${label} must start with https://.` };
  }
  if (hostSuffix && !url.hostname.endsWith(hostSuffix)) {
    return { error: `${label} must be a picture uploaded here.` };
  }
  return url.toString();
}

/**
 * Checks an optional pixel dimension.
 * @param value - Raw value.
 * @param label - Field name for the error.
 * @returns A positive integer or null, or an error message.
 */
function optionalPixels(value: unknown, label: string): number | null | { error: string } {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 20_000) {
    return { error: `${label} must be a whole number of pixels.` };
  }
  return value;
}

/**
 * Checks an optional whole number within a range.
 * @param value - Raw value.
 * @param label - Field name for the error.
 * @param max - Largest allowed.
 * @returns The number or null, or an error message.
 */
function optionalCount(
  value: unknown,
  label: string,
  max: number,
): number | null | { error: string } {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > max) {
    return { error: `${label} isn't a sensible number.` };
  }
  return value;
}

/**
 * Checks one stored picture or video. Pictures must be uploaded here; a video must be one of the
 * uploaded videos, so clean-up can find it.
 * @param raw - Raw value.
 * @param kind - What it should be.
 * @param label - "Picture 2" or "The video", for the errors.
 * @returns The media, or an error message.
 */
function parseMedia(
  raw: unknown,
  kind: MediaItem["kind"],
  label: string,
): MediaItem | { error: string } {
  if (!raw || typeof raw !== "object") return { error: `${label} must be an object.` };
  const m = raw as Record<string, unknown>;
  const url = optionalUrl(m.url ?? null, label, BLOB_IMAGE_HOST_SUFFIX);
  if (url === null) return { error: `${label} needs an address.` };
  if (typeof url !== "string") return url;
  if (kind === "video" && !isVideoFile(url)) return { error: `${label} must be uploaded here.` };
  const coverUrl =
    kind === "video"
      ? optionalUrl(m.coverUrl ?? null, "The cover frame", BLOB_IMAGE_HOST_SUFFIX)
      : null;
  const fields = {
    alt: optionalText(m.alt ?? null, `${label}'s description`, MAX_ALT),
    width: optionalPixels(m.width ?? null, `${label}'s width`),
    height: optionalPixels(m.height ?? null, `${label}'s height`),
    durationMs:
      kind === "video" ? optionalCount(m.durationMs, `${label}'s length`, 3_600_000) : null,
    sizeBytes:
      kind === "video" ? optionalCount(m.sizeBytes, `${label}'s size`, 5 * 1024 ** 3) : null,
    coverUrl,
  };
  for (const v of Object.values(fields)) {
    if (v !== null && typeof v === "object") return v;
  }
  return { kind, url, ...(fields as Omit<MediaItem, "kind" | "url">) };
}

/**
 * Parses a post edit body.
 * @param raw - Request JSON.
 * @returns The fields present and any target edits, or the first problem found.
 */
export function parsePostPatch(
  raw: unknown,
): { patch: PostPatch; targets: TargetEdit[] | null } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Expected a JSON object." };
  const body = raw as Record<string, unknown>;
  const patch: PostPatch = {};

  if (body.name !== undefined) {
    const v = optionalText(body.name, "Name", MAX_NAME);
    if (v !== null && typeof v !== "string") return v;
    patch.name = v ?? "Untitled post";
  }
  if (body.body !== undefined) {
    if (typeof body.body !== "string") return { error: "Text must be text." };
    if (body.body.length > MAX_BODY)
      return { error: `Text is too long (max ${MAX_BODY} characters).` };
    patch.body = body.body;
  }
  if (body.format !== undefined) {
    if (body.format !== null && !(SOCIAL_FORMATS as readonly unknown[]).includes(body.format)) {
      return { error: "Unknown kind of post." };
    }
    patch.format = body.format as SocialFormatKey | null;
  }
  if (body.moreImages !== undefined) {
    if (!Array.isArray(body.moreImages)) return { error: "moreImages must be a list." };
    if (body.moreImages.length > MAX_PICTURES - 1) {
      return { error: `A post can have ${MAX_PICTURES} pictures at most.` };
    }
    const list: MediaItem[] = [];
    for (const [i, rawPicture] of (body.moreImages as unknown[]).entries()) {
      const picture = parseMedia(rawPicture, "image", `Picture ${i + 2}`);
      if ("error" in picture) return picture;
      list.push(picture);
    }
    patch.moreImages = list;
  }
  if (body.video !== undefined) {
    if (body.video === null) patch.video = null;
    else {
      const video = parseMedia(body.video, "video", "The video");
      if ("error" in video) return video;
      patch.video = video;
    }
  }
  const checks: [keyof PostPatch, string | null | { error: string } | number][] = [];
  if (body.imageUrl !== undefined) {
    checks.push(["imageUrl", optionalUrl(body.imageUrl, "Picture", BLOB_IMAGE_HOST_SUFFIX)]);
  }
  if (body.imageAlt !== undefined) {
    checks.push(["imageAlt", optionalText(body.imageAlt, "Picture description", MAX_ALT)]);
  }
  if (body.imageWidth !== undefined) {
    checks.push(["imageWidth", optionalPixels(body.imageWidth, "Picture width")]);
  }
  if (body.imageHeight !== undefined) {
    checks.push(["imageHeight", optionalPixels(body.imageHeight, "Picture height")]);
  }
  if (body.imageOriginalUrl !== undefined) {
    checks.push([
      "imageOriginalUrl",
      optionalUrl(body.imageOriginalUrl, "Picture without the logo", BLOB_IMAGE_HOST_SUFFIX),
    ]);
  }
  if (body.linkUrl !== undefined) checks.push(["linkUrl", optionalUrl(body.linkUrl, "Link")]);
  if (body.googleUrl !== undefined) {
    checks.push(["googleUrl", optionalUrl(body.googleUrl, "Google button link")]);
  }
  if (body.googleTitle !== undefined) {
    checks.push(["googleTitle", optionalText(body.googleTitle, "Offer title", MAX_GOOGLE_TITLE)]);
  }
  if (body.couponCode !== undefined) {
    checks.push(["couponCode", optionalText(body.couponCode, "Coupon code", MAX_COUPON)]);
  }
  if (body.eventStartTime !== undefined) {
    checks.push(["eventStartTime", optionalTime(body.eventStartTime, "Event start")]);
  }
  if (body.eventEndTime !== undefined) {
    checks.push(["eventEndTime", optionalTime(body.eventEndTime, "Event end")]);
  }
  for (const [key, v] of checks) {
    if (v !== null && typeof v === "object") return v;
    (patch as Record<string, unknown>)[key] = v;
  }
  for (const [key, label] of [
    ["offerStart", "Offer start"],
    ["offerEnd", "Offer end"],
  ] as const) {
    if (body[key] === undefined) continue;
    const v = optionalDay(body[key], label);
    if (v !== null && !(v instanceof Date)) return v;
    patch[key] = v;
  }
  if (body.googleType !== undefined) {
    if (typeof body.googleType !== "string" || !GOOGLE_TYPES.includes(body.googleType)) {
      return { error: "Unknown Google post type." };
    }
    patch.googleType = body.googleType as GooglePostType;
  }
  if (body.googleCta !== undefined) {
    if (body.googleCta === null) patch.googleCta = null;
    else if (typeof body.googleCta !== "string" || !GOOGLE_CTAS.includes(body.googleCta)) {
      return { error: "Unknown Google button." };
    } else patch.googleCta = body.googleCta as GooglePostCta;
  }
  if (body.tagIds !== undefined) {
    const ids = parseTagIds(body.tagIds);
    if (!Array.isArray(ids)) return ids;
    patch.tagIds = ids;
  }
  if (body.promoId !== undefined) {
    if (body.promoId === null) patch.promoId = null;
    else {
      const id = parseObjectId(body.promoId);
      if (!id) return { error: "promoId isn't a valid id." };
      patch.promoId = id;
    }
  }

  let targets: TargetEdit[] | null = null;
  if (body.targets !== undefined) {
    if (!Array.isArray(body.targets)) return { error: "targets must be a list." };
    targets = [];
    for (const raw of body.targets as unknown[]) {
      if (!raw || typeof raw !== "object") return { error: "Each target must be an object." };
      const t = raw as Record<string, unknown>;
      if (!(SOCIAL_PLATFORMS as readonly unknown[]).includes(t.platform)) {
        return { error: "Unknown platform." };
      }
      const edit: TargetEdit = { platform: t.platform as string };
      if (t.enabled !== undefined) {
        if (typeof t.enabled !== "boolean") return { error: "enabled must be true or false." };
        edit.enabled = t.enabled;
      }
      if (t.textOverride !== undefined) {
        const v = optionalText(t.textOverride, "Platform text", MAX_BODY);
        if (v !== null && typeof v !== "string") return v;
        edit.textOverride = v;
      }
      const pictureChecks: [keyof TargetEdit, string | null | number | { error: string }][] = [];
      if (t.imageUrl !== undefined) {
        pictureChecks.push([
          "imageUrl",
          optionalUrl(t.imageUrl, "Picture", BLOB_IMAGE_HOST_SUFFIX),
        ]);
      }
      if (t.imageAlt !== undefined) {
        pictureChecks.push(["imageAlt", optionalText(t.imageAlt, "Picture description", MAX_ALT)]);
      }
      if (t.imageWidth !== undefined) {
        pictureChecks.push(["imageWidth", optionalPixels(t.imageWidth, "Picture width")]);
      }
      if (t.imageHeight !== undefined) {
        pictureChecks.push(["imageHeight", optionalPixels(t.imageHeight, "Picture height")]);
      }
      if (t.imageOriginalUrl !== undefined) {
        pictureChecks.push([
          "imageOriginalUrl",
          optionalUrl(t.imageOriginalUrl, "Picture without the logo", BLOB_IMAGE_HOST_SUFFIX),
        ]);
      }
      // Only ever compared with a picture URL, so it needs no host check of its own.
      if (t.cropApprovedFor !== undefined) {
        pictureChecks.push(["cropApprovedFor", optionalText(t.cropApprovedFor, "OK", MAX_URL)]);
      }
      for (const [key, v] of pictureChecks) {
        if (v !== null && typeof v === "object") return v;
        (edit as unknown as Record<string, unknown>)[key] = v;
      }
      targets.push(edit);
    }
  }
  return { patch, targets };
}

const TARGET_EDIT_FIELDS = [
  "enabled",
  "textOverride",
  "imageUrl",
  "imageAlt",
  "imageWidth",
  "imageHeight",
  "imageOriginalUrl",
  "cropApprovedFor",
] as const;

/**
 * Applies target edits; only adapter platforms switch on, and outcome fields are kept.
 * @param stored - Targets as stored.
 * @param edits - Edits from {@link parsePostPatch}.
 * @returns The merged targets.
 */
export function mergeTargets(stored: TargetState[], edits: TargetEdit[]): TargetState[] {
  return stored.map((t) => {
    const edit = edits.find((e) => e.platform === t.platform);
    if (!edit) return t;
    const next = { ...t };
    for (const key of TARGET_EDIT_FIELDS) {
      if (edit[key] !== undefined) (next as Record<string, unknown>)[key] = edit[key];
    }
    return next;
  });
}

/** A content item's own fields: its other captions and recycling. */
export interface ContentPatch {
  altCaptions?: string[];
  recycle?: boolean;
  expiresAt?: Date | null;
  maxPosts?: number | null;
}

/**
 * Parses the content item fields of an edit body. Sparse like {@link parsePostPatch}, which
 * handles the rest of the same body.
 * @param raw - Request JSON.
 * @returns The fields present, or the first problem found.
 */
export function parseContentPatch(raw: unknown): { patch: ContentPatch } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Expected a JSON object." };
  const body = raw as Record<string, unknown>;
  const patch: ContentPatch = {};

  if (body.altCaptions !== undefined) {
    const list = body.altCaptions;
    if (!Array.isArray(list) || list.some((c) => typeof c !== "string")) {
      return { error: "Captions must be a list of text." };
    }
    if (list.length > MAX_CAPTIONS - 1) {
      return { error: `A content item can have up to ${MAX_CAPTIONS} captions.` };
    }
    if ((list as string[]).some((c) => c.length > MAX_BODY)) {
      return { error: `A caption is too long (max ${MAX_BODY} characters).` };
    }
    // Blank captions stay, so the numbers don't shift while one is being written.
    patch.altCaptions = list as string[];
  }
  if (body.recycle !== undefined) {
    if (typeof body.recycle !== "boolean") return { error: "recycle must be true or false." };
    patch.recycle = body.recycle;
  }
  if (body.expiresAt !== undefined) {
    const day = optionalDay(body.expiresAt, "Last day");
    if (day !== null && !(day instanceof Date)) return day;
    patch.expiresAt = day;
  }
  if (body.maxPosts !== undefined) {
    const n = body.maxPosts;
    if (
      n !== null &&
      (!Number.isInteger(n) || (n as number) < 1 || (n as number) > MAX_POSTS_LIMIT)
    ) {
      return { error: `Stop after must be a whole number from 1 to ${MAX_POSTS_LIMIT}.` };
    }
    patch.maxPosts = n as number | null;
  }
  return { patch };
}

/**
 * Whether an edit body carries any content item field.
 * @param raw - Request JSON.
 * @returns True when one of {@link ContentPatch}'s keys is present.
 */
export function hasContentFields(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return ["altCaptions", "recycle", "expiresAt", "maxPosts"].some((k) => k in raw);
}
