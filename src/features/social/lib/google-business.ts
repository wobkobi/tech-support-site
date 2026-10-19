// src/features/social/lib/google-business.ts
// Publishes to and deletes from the Google Business Profile via the v4 localPosts API, using the
// shared Google OAuth refresh token with the business.manage scope.

import { withRetry } from "@/features/business/lib/google-retry";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import type { PlatformAdapter, PublishInput, PublishResult } from "@/features/social/lib/adapter";
import { googlePostBody } from "@/features/social/lib/google-post";

const V4_BASE = "https://mybusiness.googleapis.com/v4";
const INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";

/**
 * Reads the Business Profile env vars.
 * @returns Account and location ids, each null when unset.
 */
function googleConfig(): { accountId: string | null; locationId: string | null } {
  return {
    accountId: process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() || null,
    locationId: process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim() || null,
  };
}

/**
 * The location's resource path, or a thrown error when the ids are unset.
 * @returns "accounts/{a}/locations/{l}".
 */
function locationPath(): string {
  const { accountId, locationId } = googleConfig();
  if (!accountId || !locationId) {
    throw new Error("GOOGLE_BUSINESS_ACCOUNT_ID and GOOGLE_BUSINESS_LOCATION_ID must be set.");
  }
  return `accounts/${accountId}/locations/${locationId}`;
}

interface GaxiosLike {
  message?: string;
  response?: {
    status?: number;
    data?: { error?: string | { message?: string; status?: string } };
  };
}

/**
 * Turns a Google API failure into an actionable error: invalid_grant (token revoked),
 * PERMISSION_DENIED scope (token predates business.manage), SERVICE_DISABLED (API off).
 * @param error - What the request threw.
 * @returns A readable error.
 */
function toGoogleError(error: unknown): Error {
  const e = error as GaxiosLike;
  const status = e.response?.status;
  const data = e.response?.data?.error;
  if (data === "invalid_grant") {
    return new Error(
      "Google connection expired - re-run scripts/reauth-google.ts and update GOOGLE_OAUTH_REFRESH_TOKEN.",
    );
  }
  const detail = typeof data === "object" ? data : undefined;
  const message = detail?.message ?? e.message ?? "";
  if (/insufficient authentication scopes/i.test(message)) {
    return new Error(
      "The Google token can't manage the Business Profile - re-run scripts/reauth-google.ts and update GOOGLE_OAUTH_REFRESH_TOKEN.",
    );
  }
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
    return new Error(
      "A Business Profile API is switched off - turn on the Google My Business API in Google Cloud.",
    );
  }
  if (status === 429) return new Error("Google's rate limit was hit. Try again in a minute.");
  return new Error(
    message ? `Google said: ${message}` : `Google request failed (${status ?? "?"}).`,
  );
}

/**
 * Calls a Business Profile endpoint with the shared OAuth client.
 * @param url - Full URL.
 * @param method - HTTP method.
 * @param data - JSON body, for POST.
 * @returns The parsed response body.
 */
async function call<T>(url: string, method: "GET" | "POST" | "DELETE", data?: unknown): Promise<T> {
  const res = await getOAuth2Client().request<T>({ url, method, data, timeout: 20_000 });
  return res.data;
}

interface LocalPost {
  name: string;
  searchUrl?: string;
  state?: "LIVE" | "PROCESSING" | "REJECTED" | "SCHEDULED" | "RECURRING";
}

/**
 * Posts to the Business Profile. Not retried: a timeout after acceptance would double-post.
 * @param input - Filled text, picture, link and Google settings.
 * @returns The post's resource name and its link in Google search.
 */
async function publish(input: PublishInput): Promise<PublishResult> {
  const body = googlePostBody(input);
  let post: LocalPost;
  try {
    post = await call<LocalPost>(`${V4_BASE}/${locationPath()}/localPosts`, "POST", body);
  } catch (error) {
    throw toGoogleError(error);
  }
  if (post.state === "REJECTED") {
    throw new Error("Google rejected the post. Check the text against Google's posting rules.");
  }
  return { externalId: post.name, permalink: post.searchUrl ?? null };
}

export const google: PlatformAdapter = {
  /**
   * Env vars still needed; only the refresh token, as the shared OAuth client vars are required.
   * @returns Missing variable names.
   */
  missingEnv() {
    const { accountId, locationId } = googleConfig();
    return [
      !accountId && "GOOGLE_BUSINESS_ACCOUNT_ID",
      !locationId && "GOOGLE_BUSINESS_LOCATION_ID",
      !process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() && "GOOGLE_OAUTH_REFRESH_TOKEN",
    ].filter((v): v is string => Boolean(v));
  },
  publish,
  /**
   * Deletes a post. A 404 counts as deleted only for a post under this location.
   * @param name - "accounts/{a}/locations/{l}/localPosts/{p}" saved when it was posted.
   */
  async remove(name) {
    const prefix = `${locationPath()}/localPosts/`;
    if (!name.startsWith(prefix)) throw new Error("That post belongs to a different profile.");
    try {
      await withRetry(() => call(`${V4_BASE}/${name}`, "DELETE"), { label: "gbp" });
    } catch (error) {
      if ((error as GaxiosLike).response?.status === 404) return;
      throw toGoogleError(error);
    }
  },
  /**
   * Reads the location name and lists one post, so a missing scope or disabled API shows up
   * before a post fails.
   * @returns The business name, or the reason the check failed.
   */
  async checkConnection() {
    try {
      const path = locationPath();
      const { locationId } = googleConfig();
      const info = await withRetry(
        () =>
          call<{ title?: string }>(`${INFO_BASE}/locations/${locationId}?readMask=title`, "GET"),
        { label: "gbp" },
      );
      await withRetry(() => call(`${V4_BASE}/${path}/localPosts?pageSize=1`, "GET"), {
        label: "gbp",
      });
      return { ok: true, label: info.title ?? "Business Profile" };
    } catch (error) {
      return { ok: false, error: toGoogleError(error).message };
    }
  },
};
