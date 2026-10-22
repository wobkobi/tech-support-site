// src/features/social/lib/insights/metrics.ts
// The stats sync's rules and readers, pure and client-safe: when a post's next reading is due,
// what each app is asked for and which figure each answer lands in, reading Meta's and Google's
// answers, and the sums Analytics shows.

import type { SocialFormatKey } from "@/features/social/lib/media";
import { PLATFORM_LABEL, type SocialPlatformKey } from "@/features/social/lib/validate";
import {
  addDaysToDateKey,
  dateKeyParts,
  nzMinuteOfDay,
  nzWeekday,
} from "@/shared/lib/timezone-utils";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const FIGURE_KEYS = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saves",
  "clicks",
  "engagements",
] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

/** One post's figures on one app, or added up; null is a figure the app didn't give. */
export type Figures = Record<FigureKey, number | null>;

export const FIGURE_LABEL: Record<FigureKey, string> = {
  views: "Views",
  reach: "Reach",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  clicks: "Link clicks",
  engagements: "Engagements",
};

export const NO_FIGURES: Figures = {
  views: null,
  reach: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  clicks: null,
  engagements: null,
};

// --- When readings are taken ---

/** Ages, in hours, a post's figures are kept at, so posts compare like for like. */
export const POST_AGES = [1, 24, 72, 168, 672] as const;
/** A story's ages: it's gone after 24 hours, and its figures with it. */
export const STORY_AGES = [1, 6, 23] as const;

export const AGE_LABEL: Record<number, string> = {
  1: "1 hour",
  6: "6 hours",
  23: "23 hours",
  24: "1 day",
  72: "3 days",
  168: "7 days",
  672: "28 days",
};

/**
 * The ages a kind of post is read at.
 * @param format - The kind of post.
 * @returns Ages in hours, earliest first.
 */
export function agesFor(format: SocialFormatKey): readonly number[] {
  return format === "story" ? STORY_AGES : POST_AGES;
}

/**
 * Whether an app gives figures for a kind of post. Google has no per-post figures, a cover photo
 * isn't a post, and Facebook gives none for stories.
 * @param platform - The app.
 * @param format - The kind of post.
 * @returns True when the sync should read it.
 */
export function hasPostStats(platform: SocialPlatformKey, format: SocialFormatKey): boolean {
  if (platform === "google" || format === "cover") return false;
  return !(platform === "facebook" && format === "story");
}

/**
 * The reading due now: the latest age the post has reached that isn't kept yet. Ages it passed
 * unread are skipped (a reading can't be taken in the past), and so is everything once a later
 * age is kept. A story's figures go with it after 24 hours.
 * @param postedAt - When it went out on the app.
 * @param format - The kind of post.
 * @param captured - Ages already kept.
 * @param now - Now.
 * @returns The age to keep, or null when nothing is due.
 */
export function milestoneDue(
  postedAt: Date,
  format: SocialFormatKey,
  captured: readonly number[],
  now: Date,
): number | null {
  const hours = (now.getTime() - postedAt.getTime()) / HOUR_MS;
  if (format === "story" && hours >= 24) return null;
  const latest = agesFor(format)
    .filter((age) => age <= hours)
    .at(-1);
  if (latest === undefined || captured.some((age) => age >= latest)) return null;
  return latest;
}

// --- What Meta is asked for ---

/** One thing asked of Meta and the figure it lands in; null keeps it under extra. */
export interface MetricSpec {
  name: string;
  figure: FigureKey | null;
}

/** What one app is asked about one post: insight metrics, then plain fields that fill gaps. */
export interface PostAsk {
  /** Names the request in skip keys, like "facebook-post". */
  kind: string;
  /** The insights edge: "insights", or "video_insights" for a Facebook reel. */
  edge: string;
  metrics: readonly MetricSpec[];
  fields: readonly MetricSpec[];
  /** The permission the metrics need, named when the token can't read them. */
  scope: string;
}

/**
 * Graph field expressions for the plain counts. A summary with limit(0) returns the total
 * without the items themselves.
 */
export const FIELD_ASK: Record<string, string> = {
  reactions: "reactions.summary(total_count).limit(0)",
  comments: "comments.summary(total_count).limit(0)",
  likes: "likes.summary(total_count).limit(0)",
  shares: "shares",
  like_count: "like_count",
  comments_count: "comments_count",
};

const FACEBOOK_POST: PostAsk = {
  kind: "facebook-post",
  edge: "insights",
  // post_media_view is the views metric Meta took up after impressions (probe, 2026-10-22).
  metrics: [
    { name: "post_media_view", figure: "views" },
    { name: "post_total_media_view_unique", figure: "reach" },
    { name: "post_clicks", figure: "clicks" },
  ],
  fields: [
    { name: "reactions", figure: "likes" },
    { name: "comments", figure: "comments" },
    { name: "shares", figure: "shares" },
  ],
  scope: "read_insights",
};

const FACEBOOK_REEL: PostAsk = {
  kind: "facebook-reel",
  edge: "video_insights",
  metrics: [
    { name: "blue_reels_play_count", figure: "views" },
    { name: "post_impressions_unique", figure: "reach" },
    { name: "post_video_avg_time_watched", figure: null },
  ],
  fields: [
    { name: "likes", figure: "likes" },
    { name: "comments", figure: "comments" },
  ],
  scope: "read_insights",
};

const INSTAGRAM_MEDIA: PostAsk = {
  kind: "instagram-media",
  edge: "insights",
  metrics: [
    { name: "views", figure: "views" },
    { name: "reach", figure: "reach" },
    { name: "likes", figure: "likes" },
    { name: "comments", figure: "comments" },
    { name: "shares", figure: "shares" },
    { name: "saved", figure: "saves" },
    { name: "total_interactions", figure: "engagements" },
  ],
  fields: [
    { name: "like_count", figure: "likes" },
    { name: "comments_count", figure: "comments" },
  ],
  scope: "instagram_manage_insights",
};

const INSTAGRAM_STORY: PostAsk = {
  kind: "instagram-story",
  edge: "insights",
  metrics: [
    { name: "views", figure: "views" },
    { name: "reach", figure: "reach" },
    // A story's replies are its comments.
    { name: "replies", figure: "comments" },
    { name: "shares", figure: "shares" },
    { name: "total_interactions", figure: "engagements" },
  ],
  fields: [],
  scope: "instagram_manage_insights",
};

/**
 * What to ask an app about a post.
 * @param platform - Facebook or Instagram.
 * @param format - The kind of post.
 * @returns The ask.
 */
export function postAsk(platform: "facebook" | "instagram", format: SocialFormatKey): PostAsk {
  if (platform === "facebook") return format === "reel" ? FACEBOOK_REEL : FACEBOOK_POST;
  return format === "story" ? INSTAGRAM_STORY : INSTAGRAM_MEDIA;
}

// --- Reading Meta's answers ---

/** Meta's insights answer, for a post or an account. */
export interface InsightsAnswer {
  data?: {
    name?: string;
    values?: { value?: unknown; end_time?: string }[];
    total_value?: {
      value?: unknown;
      breakdowns?: { results?: { dimension_values?: string[]; value?: unknown }[] }[];
    };
  }[];
}

/**
 * A figure as a number. Some metrics give a count per kind (reactions by type), which is summed.
 * @param value - What Meta or Google gave.
 * @returns The number, or null when there isn't one.
 */
export function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (value && typeof value === "object") {
    const parts = Object.values(value as Record<string, unknown>)
      .map(numberOf)
      .filter((n): n is number => n !== null);
    return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;
  }
  return null;
}

/**
 * Reads a post's insights: each metric's lifetime figure, the last value given.
 * @param answer - Meta's answer.
 * @returns Figures by metric name.
 */
export function insightValues(answer: InsightsAnswer): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of answer.data ?? []) {
    if (!row.name) continue;
    const value = row.total_value
      ? numberOf(row.total_value.value)
      : numberOf(row.values?.at(-1)?.value);
    if (value !== null) out[row.name] = value;
  }
  return out;
}

/**
 * Reads a post's plain counts: a summary's total for reactions, comments and likes, a count for
 * shares, or the number itself.
 * @param answer - Meta's answer for the post.
 * @param names - The fields asked for.
 * @returns Counts by field name; a post nobody has shared has no shares field, which reads as 0.
 */
export function fieldValues(
  answer: Record<string, unknown>,
  names: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) {
    const value = answer[name];
    if (value === undefined) {
      if (name === "shares") out[name] = 0;
      continue;
    }
    if (value && typeof value === "object") {
      const obj = value as { summary?: { total_count?: unknown }; count?: unknown };
      const n = numberOf(obj.summary?.total_count ?? obj.count);
      if (n !== null) out[name] = n;
      continue;
    }
    const n = numberOf(value);
    if (n !== null) out[name] = n;
  }
  return out;
}

/**
 * Turns what Meta gave into figures: insights first, plain fields filling any gap, and
 * engagements, when not given, as likes, comments, shares and saves added up.
 * @param ask - What was asked.
 * @param metrics - Insight figures by name.
 * @param fields - Plain counts by name.
 * @returns The figures, and any other figure under its own name (null when there are none).
 */
export function figuresOf(
  ask: PostAsk,
  metrics: Record<string, number>,
  fields: Record<string, number>,
): { figures: Figures; extra: Record<string, number> | null } {
  const figures: Figures = { ...NO_FIGURES };
  const extra: Record<string, number> = {};
  for (const [specs, values] of [
    [ask.metrics, metrics],
    [ask.fields, fields],
  ] as const) {
    for (const spec of specs) {
      const value = values[spec.name];
      if (value === undefined) continue;
      if (spec.figure === null) extra[spec.name] = value;
      else if (figures[spec.figure] === null) figures[spec.figure] = value;
    }
  }
  if (figures.engagements === null && figures.likes !== null) {
    figures.engagements = addUp(figures, ENGAGING);
  }
  return { figures, extra: Object.keys(extra).length > 0 ? extra : null };
}

/**
 * The figures that make up engagements when an app doesn't give a total. Only added up once
 * likes are known: shares or saves alone would show a post's engagements as 0.
 */
const ENGAGING: readonly FigureKey[] = ["likes", "comments", "shares", "saves"];

/**
 * Adds up some of a post's figures.
 * @param figures - The figures.
 * @param keys - Which to add.
 * @returns The sum, or null when none of them was given.
 */
function addUp(figures: Figures, keys: readonly FigureKey[]): number | null {
  const given = keys.map((k) => figures[k]).filter((n): n is number => n !== null);
  return given.length > 0 ? given.reduce((a, b) => a + b, 0) : null;
}

// --- Meta errors ---

/** What went wrong with a Meta read, which decides whether to carry on. */
export type MetaProblem = "token" | "rate" | "gone" | "thin" | "invalid" | "permission" | "other";

/**
 * Sorts a Graph error. A bad token or a rate limit stops the app for this run; a deleted post
 * stops that post for good; too few viewers waits; a renamed metric or a missing permission
 * leaves that name out for a while.
 * @param code - Meta's error code.
 * @param raw - Meta's own message.
 * @returns The kind of problem.
 */
export function metaProblem(code: number | null, raw: string | null): MetaProblem {
  const text = raw ?? "";
  if (code === 190) return "token";
  if (code === 4 || code === 17 || code === 32 || code === 613) return "rate";
  if (/not enough|fewer than|insufficient/i.test(text)) return "thin";
  if (code === 100 && /does not exist|cannot be loaded|unsupported get request/i.test(text)) {
    return "gone";
  }
  if (code === 100 && /metric/i.test(text)) return "invalid";
  if (code === 10 || (code !== null && code >= 200 && code < 300)) return "permission";
  return "other";
}

/**
 * The permission a Graph error names, as in "(#10) This endpoint requires the
 * 'pages_read_user_content' permission or the 'Page Public Content Access' feature".
 * @param raw - Meta's own message.
 * @returns The permission, or null when the message names none.
 */
export function scopeIn(raw: string | null): string | null {
  return /requires the '([a-z_]+)' permission/i.exec(raw ?? "")?.[1] ?? null;
}

/**
 * The note shown beside a post's figures when some didn't come back.
 * @param platform - The app.
 * @param problem - What went wrong.
 * @param detail - The scope a permission problem is about, or the app's message otherwise.
 * @returns The note, or null when it isn't worth showing.
 */
export function problemNote(
  platform: SocialPlatformKey,
  problem: MetaProblem,
  detail: string | null,
): string | null {
  const app = PLATFORM_LABEL[platform];
  switch (problem) {
    case "permission":
      return detail
        ? `Some figures need the ${detail} permission, which the Meta token doesn't have.`
        : "Some figures need a permission the Meta token doesn't have.";
    case "thin":
      return `${app} shows these figures once more people have seen the post.`;
    case "gone":
      return `The post is no longer on ${app}.`;
    case "invalid":
      return null;
    default:
      return detail ? `${app} didn't give figures: ${detail}` : `${app} didn't give figures.`;
  }
}

// --- What's left out for a while ---

/** A metric or field left out for a while: Meta rejected the name, or the token can't read it. */
export interface Skip {
  /** When to try it again, as ISO. */
  until: string;
  why: "invalid" | "permission";
  /** The permission it needs, for a permission skip. */
  scope: string | null;
}

/** Skips keyed "kind:name". */
export type Skips = Record<string, Skip>;

/** How long a name Meta rejected stays out before it's tried again. */
export const SKIP_INVALID_MS = 7 * DAY_MS;
/** How long a name the token can't read stays out; a new token may add the permission. */
export const SKIP_PERMISSION_MS = DAY_MS;

/**
 * The skip key for a name in a request.
 * @param kind - The request kind.
 * @param name - The metric or field.
 * @returns The key.
 */
export function skipKey(kind: string, name: string): string {
  return `${kind}:${name}`;
}

/**
 * The skips still in force.
 * @param skips - All of them.
 * @param now - Now.
 * @returns The ones whose time hasn't passed.
 */
export function liveSkips(skips: Skips, now: Date): Skips {
  return Object.fromEntries(
    Object.entries(skips).filter(([, skip]) => Date.parse(skip.until) > now.getTime()),
  );
}

// --- The sync's own record ---

/** What the stats sync keeps between runs, in the social:insightsState setting. */
export interface InsightsState {
  /** When the last full sync ran, as ISO. */
  ranAt: string | null;
  /** When each app's account days were last read. */
  daysAt: Partial<Record<SocialPlatformKey, string>>;
  /** Why each app's last account read failed; gone once one works. */
  errors: Partial<Record<SocialPlatformKey, string>>;
  skips: Skips;
}

/**
 * A fresh state with its own objects, since a sync writes into them.
 * @returns The state.
 */
function emptyState(): InsightsState {
  return { ranAt: null, daysAt: {}, errors: {}, skips: {} };
}

/**
 * Reads the stored state, starting fresh from anything it can't read.
 * @param raw - The setting's value.
 * @returns The state.
 */
export function readState(raw: string | null | undefined): InsightsState {
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<InsightsState>;
    return {
      ranAt: typeof parsed.ranAt === "string" ? parsed.ranAt : null,
      daysAt: stringRecord(parsed.daysAt),
      errors: stringRecord(parsed.errors),
      skips: skipRecord(parsed.skips),
    };
  } catch {
    return emptyState();
  }
}

/**
 * Keeps the stored skips that are well formed.
 * @param value - What was stored.
 * @returns The skips.
 */
function skipRecord(value: unknown): Skips {
  if (!value || typeof value !== "object") return {};
  const out: Skips = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const skip = raw as Partial<Skip> | null;
    if (typeof skip?.until !== "string") continue;
    if (skip.why !== "invalid" && skip.why !== "permission") continue;
    out[key] = {
      until: skip.until,
      why: skip.why,
      scope: typeof skip.scope === "string" ? skip.scope : null,
    };
  }
  return out;
}

/**
 * Keeps an object's string values.
 * @param value - What was stored.
 * @returns The string entries.
 */
function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
}

// --- Account days ---

export type DayFigureKey =
  | "views"
  | "reach"
  | "engagements"
  | "follows"
  | "unfollows"
  | "clicks"
  | "searchViews"
  | "mapsViews"
  | "calls"
  | "websiteClicks"
  | "directions"
  | "conversations"
  | "bookings";

/** One app's figures for one day; a figure left out wasn't given. */
export type DayFigures = Partial<Record<DayFigureKey, number>>;

/** Account days are read at most this often; the apps add to recent days for a while. */
export const DAYS_EVERY_MS = 6 * HOUR_MS;
/** Days read back when an app has none kept yet. */
export const BACKFILL_DAYS = 30;
/** Google's figures run this many days behind. */
export const GOOGLE_LAG_DAYS = 3;

/**
 * The days to read for an app: back BACKFILL_DAYS when none are kept, otherwise from a few days
 * before the latest kept (Meta's last 3, Google's last 5), since the apps keep adding to them.
 * @param platform - The app.
 * @param today - Today's NZ key.
 * @param latestKept - The latest day kept for it, or null.
 * @returns First and last day, both included.
 */
export function dayWindow(
  platform: SocialPlatformKey,
  today: string,
  latestKept: string | null,
): { from: string; to: string } {
  const to = addDaysToDateKey(today, platform === "google" ? -GOOGLE_LAG_DAYS : -1);
  const first = addDaysToDateKey(to, -(BACKFILL_DAYS - 1));
  if (!latestKept) return { from: first, to };
  const anchor = latestKept < to ? latestKept : to;
  const again = addDaysToDateKey(anchor, platform === "google" ? -4 : -2);
  return { from: again > first ? again : first, to };
}

/**
 * Every day from one key to another.
 * @param from - First day.
 * @param to - Last day, included.
 * @returns The keys in order; none when from is after to.
 */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let key = from; key <= to; key = addDaysToDateKey(key, 1)) out.push(key);
  return out;
}

/** Facebook Page metrics read by day, and the figure each lands in. */
export const FACEBOOK_DAY_METRICS: readonly { name: string; figure: DayFigureKey }[] = [
  { name: "page_media_view", figure: "views" },
  { name: "page_total_media_view_unique", figure: "reach" },
  { name: "page_post_engagements", figure: "engagements" },
  { name: "page_daily_follows_unique", figure: "follows" },
  { name: "page_daily_unfollows_unique", figure: "unfollows" },
  { name: "page_total_actions", figure: "clicks" },
];

/**
 * Reads Facebook's Page figures by day. Meta closes each day at midnight US Pacific and stamps it
 * with that end, so a figure belongs to the day before its end_time's date.
 * @param answer - Meta's answer.
 * @returns Figures by day key.
 */
export function facebookDays(answer: InsightsAnswer): Map<string, DayFigures> {
  const out = new Map<string, DayFigures>();
  for (const row of answer.data ?? []) {
    const spec = FACEBOOK_DAY_METRICS.find((m) => m.name === row.name);
    if (!spec) continue;
    for (const point of row.values ?? []) {
      const value = numberOf(point.value);
      if (value === null || !point.end_time) continue;
      const day = addDaysToDateKey(point.end_time.slice(0, 10), -1);
      out.set(day, { ...out.get(day), [spec.figure]: value });
    }
  }
  return out;
}

/** Instagram account metrics read as one day's totals, and the figure each lands in. */
export const INSTAGRAM_DAY_METRICS: readonly { name: string; figure: DayFigureKey }[] = [
  { name: "views", figure: "views" },
  { name: "reach", figure: "reach" },
  { name: "total_interactions", figure: "engagements" },
  { name: "website_clicks", figure: "clicks" },
];

/** Asked on its own, split by follow_type into follows and unfollows. */
export const INSTAGRAM_FOLLOWS_METRIC = "follows_and_unfollows";

/**
 * Reads one day's Instagram account figures, asked for as totals over that day.
 * @param totals - The totals answer.
 * @param follows - The follows answer, or null when it wasn't read.
 * @returns The day's figures.
 */
export function instagramDay(totals: InsightsAnswer, follows: InsightsAnswer | null): DayFigures {
  const out: DayFigures = {};
  const values = insightValues(totals);
  for (const spec of INSTAGRAM_DAY_METRICS) {
    if (values[spec.name] !== undefined) out[spec.figure] = values[spec.name];
  }
  const row = follows?.data?.find((r) => r.name === INSTAGRAM_FOLLOWS_METRIC);
  for (const result of row?.total_value?.breakdowns?.[0]?.results ?? []) {
    const value = numberOf(result.value);
    const type = result.dimension_values?.[0];
    if (value === null) continue;
    if (type === "FOLLOWER") out.follows = value;
    else if (type === "NON_FOLLOWER") out.unfollows = value;
  }
  return out;
}

/** The Performance API's daily figures read for the profile. */
export const GOOGLE_DAY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
] as const;

/** The Performance API's answer to fetchMultiDailyMetricsTimeSeries. */
export interface DailyMetricsAnswer {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: {
      dailyMetric?: string;
      timeSeries?: {
        datedValues?: { date?: { year?: number; month?: number; day?: number }; value?: string }[];
      };
    }[];
  }[];
}

const GOOGLE_FIGURE: Record<string, DayFigureKey> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "mapsViews",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "mapsViews",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "searchViews",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "searchViews",
  CALL_CLICKS: "calls",
  WEBSITE_CLICKS: "websiteClicks",
  BUSINESS_DIRECTION_REQUESTS: "directions",
  BUSINESS_CONVERSATIONS: "conversations",
  BUSINESS_BOOKINGS: "bookings",
};

/**
 * Reads Google's daily figures. Google leaves a day's value out when it's 0; desktop and phone
 * views add up into Search and Maps, and both into views.
 * @param answer - Google's answer.
 * @returns Figures by day key, for each day Google listed.
 */
export function googleDays(answer: DailyMetricsAnswer): Map<string, DayFigures> {
  const out = new Map<string, DayFigures>();
  for (const group of answer.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      const figure = series.dailyMetric ? GOOGLE_FIGURE[series.dailyMetric] : undefined;
      if (!figure) continue;
      for (const point of series.timeSeries?.datedValues ?? []) {
        const { year, month, day } = point.date ?? {};
        if (!year || !month || !day) continue;
        const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const figures = out.get(key) ?? {};
        figures[figure] = (figures[figure] ?? 0) + (numberOf(point.value) ?? 0);
        out.set(key, figures);
      }
    }
  }
  for (const figures of out.values()) {
    figures.views = (figures.searchViews ?? 0) + (figures.mapsViews ?? 0);
  }
  return out;
}

// --- Sums for Analytics ---

/**
 * Adds up figures, keeping a figure null only when none of them gave it.
 * @param list - The figures.
 * @returns The sum.
 */
export function sumFigures(list: readonly Figures[]): Figures {
  const out: Figures = { ...NO_FIGURES };
  for (const figures of list) {
    for (const key of FIGURE_KEYS) {
      const value = figures[key];
      if (value !== null) out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

/**
 * Engagement rate: engagements over reach, or over views when there's no reach.
 * @param figures - The figures.
 * @returns A fraction, or null when it can't be worked out.
 */
export function engagementRate(figures: Figures): number | null {
  const base = figures.reach ?? figures.views;
  if (figures.engagements === null || base === null || base <= 0) return null;
  return figures.engagements / base;
}

/**
 * Adds up a list of account days figure by figure.
 * @param days - The days.
 * @returns The totals; a figure no day gave is left out.
 */
export function sumDays(days: readonly DayFigures[]): DayFigures {
  const out: DayFigures = {};
  for (const day of days) {
    for (const [key, value] of Object.entries(day) as [DayFigureKey, number | undefined][]) {
      if (typeof value === "number") out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

/** One column group of a chart, matching the admin BarChart's groups. */
export interface ChartGroup {
  key: string;
  shortLabel: string;
  label: string;
  values: number[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A day key as "Tue 21 Oct".
 * @param key - YYYY-MM-DD.
 * @returns The label.
 */
export function dayLabel(key: string): string {
  const [y, m, d] = dateKeyParts(key);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY_SHORT[weekday]} ${d} ${MONTHS[m - 1]}`;
}

/**
 * One figure by day and app for the chart, oldest first. Past 31 days the columns are weeks
 * (seven days up to the last), so 90 days stay readable.
 * @param days - Account days.
 * @param days.platform - Its app.
 * @param days.day - Its key.
 * @param days.value - The figure, or null when the app didn't give it.
 * @param from - First day.
 * @param to - Last day.
 * @param platforms - The apps, one series each, in order.
 * @returns The groups.
 */
export function dayGroups(
  days: readonly { platform: SocialPlatformKey; day: string; value: number | null }[],
  from: string,
  to: string,
  platforms: readonly SocialPlatformKey[],
): ChartGroup[] {
  const byKey = new Map<string, number>();
  for (const d of days) byKey.set(`${d.platform}:${d.day}`, d.value ?? 0);
  const keys = daysBetween(from, to);
  const weekly = keys.length > 31;
  const out: ChartGroup[] = [];
  // Weeks are counted back from the last day, so the newest column is a whole week.
  const step = weekly ? 7 : 1;
  for (let end = keys.length - 1; end >= 0; end -= step) {
    const start = Math.max(0, end - step + 1);
    const span = keys.slice(start, end + 1);
    const first = span[0]!;
    const last = span.at(-1)!;
    const [, m, d] = dateKeyParts(first);
    out.unshift({
      key: first,
      shortLabel: weekly
        ? `${d} ${MONTHS[m - 1]}`
        : keys.length <= 7
          ? dayLabel(first).slice(0, 3)
          : String(d),
      label: weekly ? `${dayLabel(first)} to ${dayLabel(last)}` : dayLabel(first),
      values: platforms.map((p) => span.reduce((sum, k) => sum + (byKey.get(`${p}:${k}`) ?? 0), 0)),
    });
  }
  return out;
}

// --- Best times ---

/** Times of day posts are grouped into, in NZ minutes after midnight. */
export const TIME_BANDS: readonly { label: string; from: number; to: number }[] = [
  { label: "Before 9am", from: 0, to: 540 },
  { label: "9am to noon", from: 540, to: 720 },
  { label: "Noon to 3pm", from: 720, to: 900 },
  { label: "3pm to 6pm", from: 900, to: 1080 },
  { label: "After 6pm", from: 1080, to: 1440 },
];

/** The best-times grid shows once this many posts have figures. */
export const MIN_POSTS_FOR_TIMES = 12;

/** One weekday and time band. */
export interface TimeCell {
  /** 0 is Monday. */
  weekday: number;
  band: number;
  posts: number;
  /** The average figure per post, or null when no post went out then. */
  average: number | null;
}

/**
 * When posts do best: each weekday and time band's posts, averaged by engagements, or by views
 * when fewer than half the posts have engagements.
 * @param posts - Posts with figures, added up across apps.
 * @param posts.postedAt - When it went out, as ISO.
 * @param posts.figures - Its figures.
 * @returns The cells (Monday first, then by band), how many posts counted, and the figure used.
 */
export function bestTimes(posts: readonly { postedAt: string; figures: Figures }[]): {
  cells: TimeCell[];
  counted: number;
  measure: "engagements" | "views";
} {
  const engaged = posts.filter((p) => p.figures.engagements !== null).length;
  const measure = engaged * 2 >= posts.length && engaged > 0 ? "engagements" : "views";
  const sums = new Map<string, { posts: number; total: number }>();
  let counted = 0;
  for (const p of posts) {
    const value = p.figures[measure];
    if (value === null) continue;
    const at = new Date(p.postedAt);
    // nzWeekday is 0 for Sunday; the grid starts on Monday.
    const weekday = (nzWeekday(at) + 6) % 7;
    const minute = nzMinuteOfDay(at);
    const band = TIME_BANDS.findIndex((b) => minute >= b.from && minute < b.to);
    const key = `${weekday}:${band}`;
    const cell = sums.get(key) ?? { posts: 0, total: 0 };
    cell.posts++;
    cell.total += value;
    sums.set(key, cell);
    counted++;
  }
  const cells: TimeCell[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let band = 0; band < TIME_BANDS.length; band++) {
      const cell = sums.get(`${weekday}:${band}`);
      cells.push({
        weekday,
        band,
        posts: cell?.posts ?? 0,
        average: cell ? cell.total / cell.posts : null,
      });
    }
  }
  return { cells, counted, measure };
}

// --- Content items ---

/** How a content item's postings did. */
export interface ContentPerformance {
  itemId: string;
  /** Postings with figures. */
  postings: number;
  /** Average views a posting, or null when none gave views. */
  average: number | null;
  /** The same per caption, 0 being the first. */
  captions: { index: number; postings: number; average: number | null }[];
}

/**
 * Average views a posting for each content item, and for each of its captions.
 * @param rows - One per posting with figures.
 * @param rows.sourceId - Its content item.
 * @param rows.captionIndex - Which caption it used.
 * @param rows.views - Its views across apps, or null.
 * @returns One per content item, the best average first.
 */
export function contentPerformance(
  rows: readonly { sourceId: string; captionIndex: number | null; views: number | null }[],
): ContentPerformance[] {
  const items = new Map<string, Map<number, (number | null)[]>>();
  for (const row of rows) {
    const captions = items.get(row.sourceId) ?? new Map<number, (number | null)[]>();
    const list = captions.get(row.captionIndex ?? 0) ?? [];
    list.push(row.views);
    captions.set(row.captionIndex ?? 0, list);
    items.set(row.sourceId, captions);
  }
  const out: ContentPerformance[] = [];
  for (const [itemId, captions] of items) {
    const all = [...captions.values()].flat();
    out.push({
      itemId,
      postings: all.length,
      average: averageOf(all),
      captions: [...captions.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, list]) => ({ index, postings: list.length, average: averageOf(list) })),
    });
  }
  return out.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
}

/**
 * The average of the numbers given.
 * @param list - Numbers, with nulls left out.
 * @returns The average, or null when there are none.
 */
function averageOf(list: readonly (number | null)[]): number | null {
  const given = list.filter((n): n is number => n !== null);
  return given.length > 0 ? given.reduce((a, b) => a + b, 0) / given.length : null;
}

// --- Analytics page choices ---

export const ANALYTICS_RANGES = [7, 28, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** Which apps Analytics shows. */
export type AppFilter = SocialPlatformKey | "all";

/**
 * Reads the range from the address.
 * @param value - The `range` param.
 * @returns Days to show; 28 when missing or unknown.
 */
export function readRange(value: unknown): AnalyticsRange {
  const n = Number(value);
  return (ANALYTICS_RANGES as readonly number[]).includes(n) ? (n as AnalyticsRange) : 28;
}

/**
 * Reads the app filter from the address.
 * @param value - The `app` param.
 * @returns One app, or all of them when missing or unknown.
 */
export function readAppFilter(value: unknown): AppFilter {
  return value === "facebook" || value === "instagram" || value === "google" ? value : "all";
}
