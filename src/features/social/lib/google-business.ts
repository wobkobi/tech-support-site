// src/features/social/lib/google-business.ts
// Publishes to and deletes from the Google Business Profile via the v4 localPosts API, using the
// shared Google OAuth refresh token with the business.manage scope, checks which of its APIs
// answer for the permissions grid, reads the profile's daily figures for Analytics, and reads and
// answers its reviews for the Inbox.

import { withRetry } from "@/features/business/lib/google-retry";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import type { PlatformAdapter, PublishInput, PublishResult } from "@/features/social/lib/adapter";
import { googlePostBody } from "@/features/social/lib/google-post";
import type { GoogleReview } from "@/features/social/lib/inbox/map";
import type { DailyMetricsAnswer } from "@/features/social/lib/insights/metrics";
import type { GoogleProbe, ProbeResult } from "@/features/social/lib/permissions";
import { addDaysToDateKey, dateKeyParts, nzDateKey } from "@/shared/lib/timezone-utils";

const V4_BASE = "https://mybusiness.googleapis.com/v4";
const INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const PERFORMANCE_BASE = "https://businessprofileperformance.googleapis.com/v1";

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
 * @param api - The Google Cloud API to name when it's switched off.
 * @returns A readable error.
 */
function toGoogleError(error: unknown, api = "Google My Business API"): Error {
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
      `A Business Profile API is switched off - turn on the ${api} in Google Cloud.`,
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
 * @param data - JSON body, for POST and PUT.
 * @returns The parsed response body.
 */
async function call<T>(
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  data?: unknown,
): Promise<T> {
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
  if (input.format !== "feed") throw new Error("Google only takes ordinary posts.");
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

/**
 * One read against a Business Profile API, for the permissions grid.
 * @param read - The read.
 * @param api - The Google Cloud API it needs, named when it's switched off.
 * @returns Whether it answered, or why not.
 */
async function probe(read: () => Promise<unknown>, api: string): Promise<ProbeResult> {
  try {
    await withRetry(read, { label: "gbp" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toGoogleError(error, api).message };
  }
}

/**
 * Reads one post, one review and a week of one figure, so each feature that needs its own API
 * shows whether that API answers before the feature fails on it.
 * @param now - The current time; the figures read ends three days back, as Google's lag.
 * @returns One result per API.
 */
export async function probeGoogle(now: Date): Promise<Record<GoogleProbe, ProbeResult>> {
  const path = locationPath();
  const end = addDaysToDateKey(nzDateKey(now), -3);
  const [posts, reviews, performance] = await Promise.all([
    probe(() => call(`${V4_BASE}/${path}/localPosts?pageSize=1`, "GET"), "Google My Business API"),
    probe(() => call(`${V4_BASE}/${path}/reviews?pageSize=1`, "GET"), "Google My Business API"),
    probe(
      () => call(dailyMetricsUrl(addDaysToDateKey(end, -6), end, ["WEBSITE_CLICKS"]), "GET"),
      "Business Profile Performance API",
    ),
  ]);
  return { posts, reviews, performance };
}

/**
 * The Performance API address for some daily figures over a run of days.
 * @param from - First day, YYYY-MM-DD.
 * @param to - Last day, included.
 * @param metrics - Google's DailyMetric names.
 * @returns The full URL.
 */
function dailyMetricsUrl(from: string, to: string, metrics: readonly string[]): string {
  const { locationId } = googleConfig();
  if (!locationId) throw new Error("GOOGLE_BUSINESS_LOCATION_ID must be set.");
  const [sy, sm, sd] = dateKeyParts(from);
  const [ey, em, ed] = dateKeyParts(to);
  const params = new URLSearchParams();
  for (const metric of metrics) params.append("dailyMetrics", metric);
  params.set("dailyRange.startDate.year", String(sy));
  params.set("dailyRange.startDate.month", String(sm));
  params.set("dailyRange.startDate.day", String(sd));
  params.set("dailyRange.endDate.year", String(ey));
  params.set("dailyRange.endDate.month", String(em));
  params.set("dailyRange.endDate.day", String(ed));
  return `${PERFORMANCE_BASE}/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?${params}`;
}

/**
 * Reads the profile's daily figures (views from Search and Maps, calls, clicks and so on).
 * @param from - First day, YYYY-MM-DD; Google counts days in the profile's own time zone.
 * @param to - Last day, included.
 * @param metrics - Google's DailyMetric names.
 * @returns Google's answer, for the stats sync to read.
 */
export async function readDailyMetrics(
  from: string,
  to: string,
  metrics: readonly string[],
): Promise<DailyMetricsAnswer> {
  try {
    return await withRetry(
      () => call<DailyMetricsAnswer>(dailyMetricsUrl(from, to, metrics), "GET"),
      {
        label: "gbp",
      },
    );
  } catch (error) {
    throw toGoogleError(error, "Business Profile Performance API");
  }
}

// --- Reviews ---

/** A review, or our reply to one, that Google says isn't there any more. */
export class GoogleGoneError extends Error {}

/** One page of the profile's reviews. */
export interface ReviewsPage {
  reviews?: GoogleReview[];
  totalReviewCount?: number;
  nextPageToken?: string;
}

/**
 * Reads one page of the profile's reviews, the most recently changed first.
 * @param pageToken - Google's token for the page after the last one read.
 * @returns The page.
 */
export async function readReviews(pageToken?: string): Promise<ReviewsPage> {
  const params = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
  if (pageToken) params.set("pageToken", pageToken);
  const url = `${V4_BASE}/${locationPath()}/reviews?${params}`;
  try {
    return await withRetry(() => call<ReviewsPage>(url, "GET"), { label: "gbp" });
  } catch (error) {
    throw toGoogleError(error);
  }
}

/**
 * Throws unless a review is this profile's.
 * @param name - The review's resource name.
 */
function ownReview(name: string): void {
  if (!name.startsWith(`${locationPath()}/reviews/`)) {
    throw new Error("That review belongs to a different profile.");
  }
}

/**
 * Writes our reply to a review, replacing any earlier one; a PUT, so a retry can't double it.
 * @param name - The review's resource name.
 * @param comment - The reply.
 * @returns When Google stamped the reply.
 */
export async function replyToReview(name: string, comment: string): Promise<Date> {
  ownReview(name);
  try {
    const reply = await withRetry(
      () => call<{ updateTime?: string }>(`${V4_BASE}/${name}/reply`, "PUT", { comment }),
      { label: "gbp" },
    );
    return reply.updateTime ? new Date(reply.updateTime) : new Date();
  } catch (error) {
    if ((error as GaxiosLike).response?.status === 404) {
      throw new GoogleGoneError("The review is no longer on Google.");
    }
    throw toGoogleError(error);
  }
}

/**
 * Deletes our reply to a review. A 404 means it's already gone.
 * @param name - The review's resource name.
 */
export async function deleteReviewReply(name: string): Promise<void> {
  ownReview(name);
  try {
    await withRetry(() => call(`${V4_BASE}/${name}/reply`, "DELETE"), { label: "gbp" });
  } catch (error) {
    if ((error as GaxiosLike).response?.status === 404) return;
    throw toGoogleError(error);
  }
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
