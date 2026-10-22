// src/features/social/lib/insights/analytics.server.ts
// Loads what Analytics, a post's Stats card, the calendar and the library show from the figures
// the stats sync kept. Reads only the database (and the cached permissions check), never the apps.

import { atMinute } from "@/features/social/lib/calendar";
import { NOT_CONTENT } from "@/features/social/lib/filters";
import {
  bestTimes,
  contentPerformance,
  dayGroups,
  FIGURE_KEYS,
  GOOGLE_LAG_DAYS,
  hasPostStats,
  NO_FIGURES,
  sumDays,
  sumFigures,
  type AnalyticsRange,
  type AppFilter,
  type ChartGroup,
  type ContentPerformance,
  type DayFigureKey,
  type DayFigures,
  type FigureKey,
  type Figures,
  type TimeCell,
} from "@/features/social/lib/insights/metrics";
import { loadInsightsState } from "@/features/social/lib/insights/sync.server";
import { formatOf, type SocialFormatKey } from "@/features/social/lib/media";
import { featureStatus } from "@/features/social/lib/permissions";
import { checkPermissions } from "@/features/social/lib/permissions.server";
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import { prisma } from "@/shared/lib/prisma";
import { addDaysToDateKey, nzDateKey } from "@/shared/lib/timezone-utils";
import type { SocialPostStats } from "@prisma/client";

/** One app's figures for a post. */
export interface AppFigures {
  platform: SocialPlatformKey;
  figures: Figures;
  /** Why some figures are missing. */
  note: string | null;
  link: string | null;
}

/** A post in Top posts. */
export interface AnalyticsPost {
  id: string;
  name: string;
  format: SocialFormatKey;
  /** When it first went out, as ISO. */
  postedAt: string;
  thumb: string | null;
  /** Added up over the apps on show. */
  figures: Figures;
  byApp: AppFigures[];
}

/** One figure across the top of the page. */
export interface AnalyticsCard {
  key: string;
  label: string;
  value: number | null;
  sub: string;
}

/** A line about what the figures can and can't show. */
export interface AnalyticsNote {
  tone: "warn" | "info";
  text: string;
}

/** A content item's performance, with its name and each caption's first line. */
export interface ContentRow extends ContentPerformance {
  name: string;
  captions: (ContentPerformance["captions"][number] & { text: string })[];
}

/** Everything Analytics shows. */
export interface AnalyticsData {
  range: AnalyticsRange;
  app: AppFilter;
  /** First and last day, NZ keys. */
  from: string;
  to: string;
  cards: AnalyticsCard[];
  /** The Business Profile's figures, or null when Google isn't on show. */
  googleCards: AnalyticsCard[] | null;
  chart: { series: SocialPlatformKey[]; groups: ChartGroup[] };
  posts: AnalyticsPost[];
  content: ContentRow[];
  times: { cells: TimeCell[]; counted: number; measure: "engagements" | "views" };
  /** Each app's figures by day, for the download. */
  days: { platform: SocialPlatformKey; day: string; figures: DayFigures }[];
  notes: AnalyticsNote[];
  /** When the figures were last read, as ISO. */
  ranAt: string | null;
}

/** The kept figures of a stats row. */
type FigureRow = Pick<SocialPostStats, FigureKey>;

/**
 * A stats row's figures.
 * @param row - The row.
 * @returns Its figures.
 */
function figuresOfRow(row: FigureRow): Figures {
  const out: Figures = { ...NO_FIGURES };
  for (const key of FIGURE_KEYS) out[key] = row[key] ?? null;
  return out;
}

/**
 * The apps on show.
 * @param app - The filter.
 * @returns The apps.
 */
function appsOf(app: AppFilter): SocialPlatformKey[] {
  return app === "all" ? [...SOCIAL_PLATFORMS] : [app];
}

const DAY_FIGURE_KEYS: readonly DayFigureKey[] = [
  "views",
  "reach",
  "engagements",
  "follows",
  "unfollows",
  "clicks",
  "searchViews",
  "mapsViews",
  "calls",
  "websiteClicks",
  "directions",
  "conversations",
  "bookings",
];

/**
 * Loads Analytics.
 * @param range - Days to show, up to today.
 * @param app - The apps to show.
 * @param now - Now.
 * @returns The data.
 */
export async function loadAnalytics(
  range: AnalyticsRange,
  app: AppFilter,
  now: Date,
): Promise<AnalyticsData> {
  const to = nzDateKey(now);
  const from = addDaysToDateKey(to, -(range - 1));
  const apps = appsOf(app);
  const metaApps = apps.filter((p) => p !== "google");

  const [dayRows, statRows, allRows, state, perms] = await Promise.all([
    prisma.socialAccountDay.findMany({
      where: { platform: { in: apps }, day: { gte: from, lte: to } },
      orderBy: { day: "asc" },
    }),
    prisma.socialPostStats.findMany({
      where: { platform: { in: metaApps }, postedAt: { gte: atMinute(from, 0) } },
    }),
    // Best times look at every post with figures, since a month rarely has enough.
    prisma.socialPostStats.findMany({
      where: { platform: { in: metaApps } },
      select: { postId: true, postedAt: true, ...figureSelect() },
    }),
    loadInsightsState(),
    checkPermissions().catch(() => null),
  ]);

  const days = dayRows.map((d) => ({
    platform: d.platform,
    day: d.day,
    figures: Object.fromEntries(DAY_FIGURE_KEYS.flatMap((k) => (d[k] === null ? [] : [[k, d[k]]]))),
  }));
  const posts = await postsOf(statRows);

  const metaDays = sumDays(days.filter((d) => d.platform !== "google").map((d) => d.figures));
  const postTotals = sumFigures(posts.map((p) => p.figures));
  const appNames = metaApps.map((p) => PLATFORM_LABEL[p]).join(" and ");
  /**
   * A Meta figure from the account days, or added up from the posts when no day has it.
   * @param key - The account figure.
   * @param label - Its label.
   * @param postKey - The post figure to fall back on, if any.
   * @returns The card.
   */
  function metaCard(key: DayFigureKey, label: string, postKey: FigureKey | null): AnalyticsCard {
    if (metaDays[key] !== undefined) return { key, label, value: metaDays[key], sub: appNames };
    const fromPosts = postKey ? postTotals[postKey] : null;
    if (fromPosts !== null)
      return { key, label, value: fromPosts, sub: "From posts in this range" };
    return { key, label, value: null, sub: "Not given yet" };
  }
  const cards =
    metaApps.length === 0
      ? []
      : [
          metaCard("views", "Views", "views"),
          metaCard("reach", "Reach", "reach"),
          metaCard("engagements", "Engagements", "engagements"),
          metaCard("follows", "New followers", null),
          metaCard("clicks", "Link clicks", "clicks"),
        ];

  const googleDays = sumDays(days.filter((d) => d.platform === "google").map((d) => d.figures));
  /**
   * A Business Profile figure.
   * @param key - The figure.
   * @param label - Its label.
   * @param sub - The line under it.
   * @returns The card.
   */
  function googleCard(key: DayFigureKey, label: string, sub: string): AnalyticsCard {
    return { key: `google-${key}`, label, value: googleDays[key] ?? null, sub };
  }
  const googleCards = apps.includes("google")
    ? [
        googleCard(
          "views",
          "Profile views",
          googleDays.views === undefined
            ? "Search and Maps"
            : `${(googleDays.searchViews ?? 0).toLocaleString("en-NZ")} from Search, ${(googleDays.mapsViews ?? 0).toLocaleString("en-NZ")} from Maps`,
        ),
        googleCard("calls", "Calls", "From your profile"),
        googleCard("websiteClicks", "Website clicks", "From your profile"),
        googleCard("directions", "Directions", "Asked for the way to you"),
      ]
    : null;

  const contentIds = [...new Set(posts.map((p) => p.sourceId).filter((id): id is string => !!id))];
  const items = contentIds.length
    ? await prisma.socialPost.findMany({
        where: { id: { in: contentIds } },
        select: { id: true, name: true, body: true, altCaptions: true },
      })
    : [];
  const itemOf = new Map(items.map((i) => [i.id, i]));
  const content = contentPerformance(
    posts.flatMap((p) =>
      p.sourceId && itemOf.has(p.sourceId)
        ? [{ sourceId: p.sourceId, captionIndex: p.captionIndex, views: p.figures.views }]
        : [],
    ),
  ).map((row): ContentRow => {
    const item = itemOf.get(row.itemId)!;
    const captions = [item.body, ...item.altCaptions];
    return {
      ...row,
      name: item.name,
      captions: row.captions.map((c) => ({ ...c, text: firstLine(captions[c.index] ?? "") })),
    };
  });

  const byPost = new Map<string, { postedAt: Date; figures: Figures[] }>();
  for (const row of allRows) {
    const entry = byPost.get(row.postId) ?? { postedAt: row.postedAt, figures: [] };
    if (row.postedAt < entry.postedAt) entry.postedAt = row.postedAt;
    entry.figures.push(figuresOfRow(row));
    byPost.set(row.postId, entry);
  }
  const times = bestTimes(
    [...byPost.values()].map((p) => ({
      postedAt: p.postedAt.toISOString(),
      figures: sumFigures(p.figures),
    })),
  );

  const notes: AnalyticsNote[] = [];
  const stats = perms ? featureStatus("stats", perms) : null;
  for (const platform of apps) {
    const cell = stats?.[platform];
    const label = PLATFORM_LABEL[platform];
    if (cell?.state === "missing") {
      // A Facebook post's reactions and comments need pages_read_user_content, not the stats scope.
      const comments = perms ? featureStatus("comments", perms)[platform] : null;
      const counts =
        platform === "facebook" &&
        comments?.state === "missing" &&
        comments.missing.includes("pages_read_user_content")
          ? "Likes and comments need pages_read_user_content as well."
          : "Likes, comments and shares still come through.";
      notes.push({
        tone: "warn",
        text: `${label} figures need the ${cell.missing.join(" and ")} permission${cell.missing.length > 1 ? "s" : ""}, which the Meta token doesn't have. ${counts}`,
      });
    } else if (cell?.state === "off") {
      notes.push({ tone: "warn", text: `${label}: ${cell.reason}` });
    } else if (state.errors[platform]) {
      notes.push({ tone: "warn", text: `${label}: ${state.errors[platform]}` });
    }
  }
  if (apps.includes("facebook")) {
    notes.push({
      tone: "info",
      text: "Facebook counts its days on US Pacific time, so each one starts in the evening NZ time.",
    });
  }
  if (apps.includes("google")) {
    notes.push({
      tone: "info",
      text: `Google's figures run ${GOOGLE_LAG_DAYS} days behind, and Google gives none for single posts.`,
    });
  }

  return {
    range,
    app,
    from,
    to,
    cards,
    googleCards,
    chart: {
      series: apps,
      groups: dayGroups(
        days.map((d) => ({ platform: d.platform, day: d.day, value: d.figures.views ?? null })),
        from,
        to,
        apps,
      ),
    },
    posts,
    content,
    times,
    days,
    notes,
    ranAt: state.ranAt,
  };
}

/**
 * Selects every figure column.
 * @returns The Prisma select.
 */
function figureSelect(): Record<FigureKey, true> {
  return Object.fromEntries(FIGURE_KEYS.map((k) => [k, true])) as Record<FigureKey, true>;
}

/**
 * A text's first line with words.
 * @param text - The text.
 * @returns The line, or "" when there's none.
 */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? ""
  );
}

/**
 * Joins stats rows to their posts, one entry per post with its apps' figures added up.
 * @param rows - Stats rows.
 * @returns The posts, the most viewed first, with their content item and caption.
 */
async function postsOf(
  rows: readonly SocialPostStats[],
): Promise<(AnalyticsPost & { sourceId: string | null; captionIndex: number | null })[]> {
  const ids = [...new Set(rows.map((r) => r.postId))];
  if (ids.length === 0) return [];
  const found = await prisma.socialPost.findMany({
    where: { AND: [NOT_CONTENT, { id: { in: ids } }] },
    select: {
      id: true,
      name: true,
      format: true,
      imageUrl: true,
      video: { select: { coverUrl: true } },
      targets: true,
      sourceId: true,
      captionIndex: true,
    },
  });
  const postOf = new Map(found.map((p) => [p.id, p]));
  const grouped = new Map<string, SocialPostStats[]>();
  for (const row of rows) grouped.set(row.postId, [...(grouped.get(row.postId) ?? []), row]);

  const out: (AnalyticsPost & { sourceId: string | null; captionIndex: number | null })[] = [];
  for (const [id, list] of grouped) {
    const post = postOf.get(id);
    if (!post) continue;
    const byApp = list.map((row) => ({
      platform: row.platform,
      figures: figuresOfRow(row),
      note: row.unavailable,
      link: post.targets.find((t) => t.platform === row.platform)?.permalink ?? null,
    }));
    out.push({
      id,
      name: post.name,
      format: formatOf(post.format),
      postedAt: new Date(Math.min(...list.map((r) => r.postedAt.getTime()))).toISOString(),
      thumb: post.imageUrl ?? post.video?.coverUrl ?? null,
      figures: sumFigures(byApp.map((a) => a.figures)),
      byApp,
      sourceId: post.sourceId,
      captionIndex: post.captionIndex,
    });
  }
  return out.sort((a, b) => (b.figures.views ?? -1) - (a.figures.views ?? -1));
}

/** A post's figures for its Stats card. */
export interface PostStatsView {
  /** One per app that gives figures for this post. */
  apps: (AppFigures & {
    /** When its figures were last read, as ISO, or null before the first read. */
    syncedAt: string | null;
    /** The readings kept at set ages, earliest first. */
    readings: { ageHours: number; views: number | null; engagements: number | null }[];
  })[];
  /** Apps it went out on that give no figures for it, and why. */
  without: { platform: SocialPlatformKey; reason: string }[];
  /** When this was loaded, as ISO, so "Updated" reads the same on the server and in the browser. */
  loadedAt: string;
}

/**
 * Why an app gives no figures for a post.
 * @param platform - The app.
 * @param format - The kind of post.
 * @returns The reason.
 */
function noStatsReason(platform: SocialPlatformKey, format: SocialFormatKey): string {
  if (format === "cover") return "A cover photo has no figures.";
  if (platform === "google") {
    return "Google gives no figures for single posts. Your profile's figures are in Analytics.";
  }
  return "Facebook gives no figures for stories.";
}

/**
 * Loads a post's Stats card, for a post that has gone out.
 * @param now - Now.
 * @param post - The post.
 * @param post.id - Its id.
 * @param post.format - Its kind.
 * @param post.targets - Its app copies.
 * @returns The card's data, or null when the post hasn't gone out anywhere.
 */
export async function loadPostStats(
  now: Date,
  post: {
    id: string;
    format: string | null;
    targets: { platform: SocialPlatformKey; status: string; permalink: string | null }[];
  },
): Promise<PostStatsView | null> {
  const out = post.targets.filter((t) => t.status === "posted" || t.status === "removed");
  if (out.length === 0) return null;
  const format = formatOf(post.format);
  const [stats, readings] = await Promise.all([
    prisma.socialPostStats.findMany({ where: { postId: post.id } }),
    prisma.socialInsight.findMany({
      where: { postId: post.id },
      orderBy: { ageHours: "asc" },
      select: { platform: true, ageHours: true, views: true, engagements: true },
    }),
  ]);
  const apps: PostStatsView["apps"] = [];
  const without: PostStatsView["without"] = [];
  for (const target of out) {
    if (!hasPostStats(target.platform, format)) {
      without.push({ platform: target.platform, reason: noStatsReason(target.platform, format) });
      continue;
    }
    const row = stats.find((s) => s.platform === target.platform);
    apps.push({
      platform: target.platform,
      figures: row ? figuresOfRow(row) : { ...NO_FIGURES },
      note: row?.unavailable ?? null,
      link: target.permalink,
      syncedAt: row?.syncedAt.toISOString() ?? null,
      readings: readings
        .filter((r) => r.platform === target.platform)
        .map((r) => ({ ageHours: r.ageHours, views: r.views, engagements: r.engagements })),
    });
  }
  return { apps, without, loadedAt: now.toISOString() };
}

/**
 * Views per post, added up across apps.
 * @param ids - Post ids.
 * @returns Views by post id, for posts that have any.
 */
export async function postViews(ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const rows = await prisma.socialPostStats.findMany({
    where: { postId: { in: [...ids] } },
    select: { postId: true, views: true },
  });
  for (const row of rows) {
    if (row.views !== null) out.set(row.postId, (out.get(row.postId) ?? 0) + row.views);
  }
  return out;
}

/**
 * Average views a posting for each content item.
 * @param itemIds - Content item ids.
 * @returns The average by item id, for items whose postings have views.
 */
export async function contentViews(itemIds: readonly string[]): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  const postings = await prisma.socialPost.findMany({
    where: { sourceId: { in: [...itemIds] }, status: { in: ["posted", "partial"] } },
    select: { id: true, sourceId: true, captionIndex: true },
  });
  const views = await postViews(postings.map((p) => p.id));
  const rows = postings.flatMap((p) =>
    p.sourceId && views.has(p.id)
      ? [{ sourceId: p.sourceId, captionIndex: p.captionIndex, views: views.get(p.id)! }]
      : [],
  );
  return new Map(
    contentPerformance(rows).flatMap((r) => (r.average === null ? [] : [[r.itemId, r.average]])),
  );
}

/** Views by app over the last seven full days, for the Overview's chart. */
export interface ViewsWeek {
  from: string;
  to: string;
  /** The apps with figures in those days, one series each. */
  series: SocialPlatformKey[];
  groups: ChartGroup[];
}

/**
 * Loads the Overview's views chart: the seven days up to yesterday, since today is never in yet.
 * @param now - Now.
 * @returns The chart's data.
 */
export async function loadViewsWeek(now: Date): Promise<ViewsWeek> {
  const to = addDaysToDateKey(nzDateKey(now), -1);
  const from = addDaysToDateKey(to, -6);
  const rows = await prisma.socialAccountDay.findMany({
    where: { day: { gte: from, lte: to } },
    select: { platform: true, day: true, views: true },
  });
  const series = SOCIAL_PLATFORMS.filter((p) => rows.some((r) => r.platform === p));
  return {
    from,
    to,
    series,
    groups: dayGroups(
      rows.map((r) => ({ ...r, value: r.views })),
      from,
      to,
      series,
    ),
  };
}
