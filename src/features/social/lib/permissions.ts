// src/features/social/lib/permissions.ts
// What each app can do with the keys it has. Meta features are judged from the token's
// permissions (debug_token), Google ones from a read against each API, and the Meta token gets a
// warning when it has stopped working or is close to running out. Pure and client-safe.

import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { formatDateShort } from "@/shared/lib/date-format";

export const FEATURE_KEYS = [
  "publish",
  "takedown",
  "stats",
  "comments",
  "cover",
  "messages",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const GOOGLE_PROBES = ["posts", "reviews", "performance"] as const;
export type GoogleProbe = (typeof GOOGLE_PROBES)[number];

/** Warn this many days before the Meta token, or its data access, runs out. */
export const TOKEN_WARN_DAYS = 14;

const DAY_MS = 86_400_000;

/** The Meta token as debug_token describes it. Dates are ISO, and null means never. */
export interface MetaTokenInfo {
  valid: boolean;
  /** PAGE, USER or SYSTEM_USER. */
  type: string | null;
  /** The Meta app it was made for. */
  app: string | null;
  scopes: string[];
  expiresAt: string | null;
  /** When Meta stops letting the token read data unless it's renewed. */
  dataAccessExpiresAt: string | null;
  /** Why Meta says it's invalid. */
  error: string | null;
}

/** One Google API read: fine, or why not. */
export type ProbeResult = { ok: true } | { ok: false; error: string };

/** Everything the permissions grid is judged on. */
export interface Permissions {
  /** Whether each app has its keys set. */
  setUp: Record<SocialPlatformKey, boolean>;
  /** The Meta token, or null when there isn't one or it couldn't be read. */
  token: MetaTokenInfo | null;
  /** Why the token couldn't be read. */
  tokenError: string | null;
  /** Each Google API read, or null when Google isn't set up. */
  google: Record<GoogleProbe, ProbeResult> | null;
}

/** What one app needs for a feature: Meta permissions, a Google API that answers, or nothing on offer. */
export type Need = { scopes: readonly string[] } | { probe: GoogleProbe } | null;

/** One row of the grid. */
export interface Feature {
  key: FeatureKey;
  label: string;
  detail: string;
  needs: Record<SocialPlatformKey, Need>;
}

export const FEATURES: readonly Feature[] = [
  {
    key: "publish",
    label: "Post",
    detail: "Send posts and pictures.",
    needs: {
      facebook: { scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"] },
      instagram: {
        scopes: ["instagram_basic", "instagram_content_publish", "pages_read_engagement"],
      },
      google: { probe: "posts" },
    },
  },
  {
    key: "takedown",
    label: "Take down",
    detail: "Delete a post from the app.",
    needs: {
      facebook: { scopes: ["pages_manage_posts"] },
      instagram: { scopes: ["instagram_manage_contents"] },
      google: { probe: "posts" },
    },
  },
  {
    key: "stats",
    label: "Stats",
    detail: "Views, reach and clicks for Analytics.",
    needs: {
      facebook: { scopes: ["read_insights", "pages_read_engagement"] },
      instagram: {
        scopes: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement"],
      },
      google: { probe: "performance" },
    },
  },
  {
    key: "comments",
    label: "Comments and reviews",
    detail: "Read and answer them in the Inbox.",
    needs: {
      facebook: { scopes: ["pages_read_user_content", "pages_manage_engagement"] },
      instagram: {
        scopes: ["instagram_basic", "instagram_manage_comments", "pages_read_engagement"],
      },
      google: { probe: "reviews" },
    },
  },
  {
    key: "cover",
    label: "Cover photo",
    detail: "Change the Page's cover photo.",
    needs: { facebook: { scopes: ["pages_manage_metadata"] }, instagram: null, google: null },
  },
  {
    key: "messages",
    label: "Messages",
    detail: "Messenger and Instagram direct messages.",
    needs: {
      facebook: { scopes: ["pages_messaging"] },
      instagram: { scopes: ["instagram_manage_messages"] },
      google: null,
    },
  },
];

/** The features the set-up list asks you to have ready; cover and messages are extras. */
export const CORE_FEATURES: readonly FeatureKey[] = ["publish", "takedown", "stats", "comments"];

/** One cell of the grid. */
export type CellStatus =
  | { state: "ready" }
  | { state: "missing"; missing: string[] }
  | { state: "off"; reason: string }
  | { state: "checking" }
  | { state: "none" };

/**
 * How one app stands on one feature.
 * @param need - What the app needs for it.
 * @param platform - The app.
 * @param perms - The last check, or null while it runs.
 * @returns The cell's status.
 */
export function cellStatus(
  need: Need,
  platform: SocialPlatformKey,
  perms: Permissions | null,
): CellStatus {
  if (need === null) return { state: "none" };
  if (perms === null) return { state: "checking" };
  if (!perms.setUp[platform]) return { state: "off", reason: "Not set up." };
  if ("probe" in need) {
    const result = perms.google?.[need.probe];
    if (!result) return { state: "off", reason: "Not set up." };
    return result.ok ? { state: "ready" } : { state: "off", reason: result.error };
  }
  if (!perms.token) {
    return { state: "off", reason: perms.tokenError ?? "Couldn't read the Meta token." };
  }
  if (!perms.token.valid) return { state: "off", reason: "The Meta token has stopped working." };
  const missing = need.scopes.filter((s) => !perms.token!.scopes.includes(s));
  return missing.length === 0 ? { state: "ready" } : { state: "missing", missing };
}

/**
 * How every app stands on one feature.
 * @param key - The feature.
 * @param perms - The last check, or null while it runs.
 * @returns A status per app.
 */
export function featureStatus(
  key: FeatureKey,
  perms: Permissions | null,
): Record<SocialPlatformKey, CellStatus> {
  const feature = FEATURES.find((f) => f.key === key)!;
  return Object.fromEntries(
    SOCIAL_PLATFORMS.map((p) => [p, cellStatus(feature.needs[p], p, perms)]),
  ) as Record<SocialPlatformKey, CellStatus>;
}

/**
 * Whether every app that offers each core feature is ready for it.
 * @param perms - The last check, or null while it runs.
 * @returns True or false, or null while checking.
 */
export function coreReady(perms: Permissions | null): boolean | null {
  if (perms === null) return null;
  return CORE_FEATURES.every((key) =>
    Object.values(featureStatus(key, perms)).every(
      (c) => c.state === "ready" || c.state === "none",
    ),
  );
}

/** A warning about the Meta token. */
export interface TokenWarning {
  tone: "critical" | "warning";
  text: string;
}

/**
 * The warning to show about the Meta token: stopped working, or running out (or its data access
 * ending) within {@link TOKEN_WARN_DAYS} days.
 * @param token - The token, or null when there isn't one.
 * @param now - The current time.
 * @returns The warning, or null when there's nothing to say.
 */
export function tokenWarning(token: MetaTokenInfo | null, now: Date): TokenWarning | null {
  if (!token) return null;
  if (!token.valid) {
    return {
      tone: "critical",
      text: `The Meta token has stopped working${token.error ? ` (${token.error})` : ""}. Facebook and Instagram can't post until you make a new one and update META_PAGE_ACCESS_TOKEN.`,
    };
  }
  const soon = now.getTime() + TOKEN_WARN_DAYS * DAY_MS;
  if (token.expiresAt && Date.parse(token.expiresAt) <= soon) {
    return {
      tone: "warning",
      text: `The Meta token runs out on ${formatDateShort(token.expiresAt)}. Make one that doesn't before then.`,
    };
  }
  if (token.dataAccessExpiresAt && Date.parse(token.dataAccessExpiresAt) <= soon) {
    return {
      tone: "warning",
      text: `Meta stops this token reading your Page on ${formatDateShort(token.dataAccessExpiresAt)}. Make a system user token, which doesn't run out, before then.`,
    };
  }
  return null;
}

/** The parts of a debug_token answer that matter here. */
export interface DebugTokenData {
  is_valid?: boolean;
  type?: string;
  application?: string;
  scopes?: string[];
  /** Seconds since 1970; 0 means never. */
  expires_at?: number;
  /** Seconds since 1970; 0 means never. */
  data_access_expires_at?: number;
  error?: { message?: string };
}

/**
 * Reads a debug_token answer.
 * @param data - Its `data` object.
 * @returns The token's details.
 */
export function tokenInfoOf(data: DebugTokenData): MetaTokenInfo {
  /**
   * Meta's seconds as an ISO time, with 0 or nothing meaning never.
   * @param seconds - Seconds since 1970.
   * @returns ISO time, or null.
   */
  const when = (seconds: number | undefined): string | null =>
    seconds ? new Date(seconds * 1000).toISOString() : null;
  return {
    valid: data.is_valid === true,
    type: data.type ?? null,
    app: data.application ?? null,
    scopes: data.scopes ?? [],
    expiresAt: when(data.expires_at),
    dataAccessExpiresAt: when(data.data_access_expires_at),
    error: data.error?.message ?? null,
  };
}
