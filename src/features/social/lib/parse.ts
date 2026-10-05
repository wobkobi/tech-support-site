// src/features/social/lib/parse.ts
// Request-body parsing for the social API. Sparse: only fields present in the body are
// returned, so a PATCH writes exactly what the composer changed. Target edits are
// merged into the stored targets so a platform's past outcome is never overwritten.

import { parseObjectId } from "@/features/business/lib/validation";
import type { TargetState } from "@/features/social/lib/targets";
import { SOCIAL_PLATFORMS } from "@/features/social/lib/validate";

const MAX_NAME = 120;
const MAX_BODY = 10_000;
const MAX_ALT = 300;
const MAX_URL = 2_000;
// Meta fetches the picture by URL, so only images in this site's own Blob store are
// accepted: they're public, stable, and already shrunk to JPEG by the composer.
const IMAGE_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/** Editable post fields, apart from targets. */
export interface PostPatch {
  name?: string;
  body?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  linkUrl?: string | null;
  promoId?: string | null;
}

/** A target edit from the composer: the toggle and override only. */
export interface TargetEdit {
  platform: string;
  enabled?: boolean;
  textOverride?: string | null;
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
  const checks: [keyof PostPatch, string | null | { error: string } | number][] = [];
  if (body.imageUrl !== undefined) {
    checks.push(["imageUrl", optionalUrl(body.imageUrl, "Picture", IMAGE_HOST_SUFFIX)]);
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
  if (body.linkUrl !== undefined) checks.push(["linkUrl", optionalUrl(body.linkUrl, "Link")]);
  for (const [key, v] of checks) {
    if (v !== null && typeof v === "object") return v;
    (patch as Record<string, unknown>)[key] = v;
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
      targets.push(edit);
    }
  }
  return { patch, targets };
}

/**
 * Applies target edits to the stored targets. Only platforms with an adapter can be
 * switched on, and outcome fields are left as they were.
 * @param stored - Targets as stored.
 * @param edits - Edits from {@link parsePostPatch}.
 * @returns The merged targets.
 */
export function mergeTargets(stored: TargetState[], edits: TargetEdit[]): TargetState[] {
  return stored.map((t) => {
    const edit = edits.find((e) => e.platform === t.platform);
    if (!edit) return t;
    return {
      ...t,
      ...(edit.enabled !== undefined ? { enabled: edit.enabled } : {}),
      ...(edit.textOverride !== undefined ? { textOverride: edit.textOverride } : {}),
    };
  });
}
