// src/features/social/lib/insights/sync.server.ts
// The stats sync: reads each app's account figures by day (at most every 6 hours) and each
// published post's figures at set ages, carrying on next run when its time runs out. The
// sync-social cron and the Refresh buttons share one run lock, so they never read at once.

import { NOT_CONTENT } from "@/features/social/lib/filters";
import { readDailyMetrics } from "@/features/social/lib/google-business";
import {
  MetaStop,
  readFacebookDays,
  readInstagramDays,
  readPost,
} from "@/features/social/lib/insights/meta.server";
import {
  agesFor,
  DAYS_EVERY_MS,
  daysBetween,
  dayWindow,
  FIGURE_KEYS,
  GOOGLE_DAY_METRICS,
  googleDays,
  hasPostStats,
  liveSkips,
  milestoneDue,
  readState,
  type DayFigures,
  type InsightsState,
  type Skips,
} from "@/features/social/lib/insights/metrics";
import { formatOf, type SocialFormatKey } from "@/features/social/lib/media";
import { PLATFORMS } from "@/features/social/lib/platforms";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { prisma } from "@/shared/lib/prisma";
import { acquireRunLock, releaseRunLock } from "@/shared/lib/run-lock";
import { nzDateKey } from "@/shared/lib/timezone-utils";

const LOCK_KEY = "social:insightsSync";
const STATE_KEY = "social:insightsState";
/** A run stops starting new reads after this long; the next run carries on. */
const BUDGET_MS = 120_000;
/** Most posts read in one run. */
const MAX_POSTS = 40;
/** A Refresh press within this long of the last read is turned away. */
export const REFRESH_EVERY_MS = 10 * 60_000;

/** How a run went. */
export interface SyncResult {
  /** Account days kept per app, or why the app's read failed. */
  days: Partial<Record<SocialPlatformKey, number | string>>;
  /** Post readings taken. */
  posts: number;
  /** Posts still due when the run stopped. */
  left: number;
}

/** A post's app copy whose figures are due. */
interface Due {
  postId: string;
  format: SocialFormatKey;
  platform: "facebook" | "instagram";
  externalId: string;
  postedAt: Date;
  captured: number[];
  /** The age to keep, or null for a Refresh between ages. */
  age: number | null;
  syncedAt: Date | null;
}

/**
 * Reads the sync's record.
 * @returns The state, fresh when there's none.
 */
export async function loadInsightsState(): Promise<InsightsState> {
  const row = await prisma.setting.findFirst({
    where: { key: STATE_KEY },
    select: { value: true },
  });
  return readState(row?.value);
}

/**
 * Saves the sync's record.
 * @param state - The state.
 */
async function saveState(state: InsightsState): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.setting.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value },
    update: { value },
  });
}

/**
 * Whether an app has its keys set.
 * @param platform - The app.
 * @returns True when it's set up.
 */
function setUp(platform: SocialPlatformKey): boolean {
  return PLATFORMS[platform].missingEnv().length === 0;
}

/**
 * Runs the sync: account days for each app that's due, then the posts whose next reading is due,
 * stories first since their figures go after a day, then the longest unread.
 * @param now - Now.
 * @param opts - What to read.
 * @param opts.forceDays - Read account days even when the last read is under 6 hours old.
 * @param opts.budgetMs - How long to keep starting reads.
 * @param opts.maxPosts - Most posts to read.
 * @returns How it went, or null when another run holds the lock.
 */
export async function syncInsights(
  now: Date,
  opts: { forceDays?: boolean; budgetMs?: number; maxPosts?: number } = {},
): Promise<SyncResult | null> {
  if (!(await acquireRunLock(LOCK_KEY, 5 * 60_000))) return null;
  try {
    const deadline = Date.now() + (opts.budgetMs ?? BUDGET_MS);
    const state = await loadInsightsState();
    const skips = liveSkips(state.skips, now);
    const result: SyncResult = { days: {}, posts: 0, left: 0 };

    // Account days
    const today = nzDateKey(now);
    for (const platform of SOCIAL_PLATFORMS) {
      if (!setUp(platform) || Date.now() > deadline) continue;
      const last = state.daysAt[platform] ? Date.parse(state.daysAt[platform]) : NaN;
      if (!opts.forceDays && now.getTime() - last < DAYS_EVERY_MS) continue;
      try {
        const kept = await syncDays(platform, today, skips, now, deadline);
        result.days[platform] = kept.count;
        if (kept.note) state.errors[platform] = kept.note;
        else delete state.errors[platform];
        if (kept.complete) state.daysAt[platform] = now.toISOString();
      } catch (error) {
        const message = error instanceof Error ? error.message : "The read failed.";
        result.days[platform] = message;
        state.errors[platform] = message;
      }
    }

    // Posts
    const due = await loadDue(now);
    const stopped = new Set<string>();
    for (const item of due) {
      if (result.posts >= (opts.maxPosts ?? MAX_POSTS) || Date.now() > deadline) break;
      if (stopped.has(item.platform)) continue;
      try {
        await captureOne(item, skips, now);
        result.posts++;
      } catch (error) {
        // A bad token or rate limit ends the app's reads for this run.
        if (!(error instanceof MetaStop)) throw error;
        stopped.add(item.platform);
        state.errors[item.platform] = error.message;
      }
    }
    result.left = Math.max(0, due.length - result.posts);

    state.skips = skips;
    state.ranAt = now.toISOString();
    await saveState(state);
    return result;
  } finally {
    await releaseRunLock(LOCK_KEY);
  }
}

/**
 * Reads one post's figures on every app now, for its Refresh button. A reading due at the same
 * time is kept as well.
 * @param postId - The post.
 * @param now - Now.
 * @returns "read", "throttled" when it was read under 10 minutes ago, or "busy" when a sync holds
 *   the lock.
 */
export async function refreshPostInsights(
  postId: string,
  now: Date,
): Promise<"read" | "throttled" | "busy"> {
  const recent = await prisma.socialPostStats.findFirst({
    where: { postId, syncedAt: { gt: new Date(now.getTime() - REFRESH_EVERY_MS) } },
    select: { id: true },
  });
  if (recent) return "throttled";
  if (!(await acquireRunLock(LOCK_KEY, 5 * 60_000))) return "busy";
  try {
    const state = await loadInsightsState();
    const skips = liveSkips(state.skips, now);
    for (const item of await loadDue(now, postId)) {
      try {
        await captureOne(item, skips, now);
      } catch (error) {
        if (!(error instanceof MetaStop)) throw error;
        state.errors[item.platform] = error.message;
      }
    }
    state.skips = skips;
    await saveState(state);
    return "read";
  } finally {
    await releaseRunLock(LOCK_KEY);
  }
}

/**
 * The app copies due a reading, most pressing first. Given a post, every copy of it that has
 * figures, due or not.
 * @param now - Now.
 * @param onlyPostId - One post to read now, for Refresh.
 * @returns The copies.
 */
async function loadDue(now: Date, onlyPostId?: string): Promise<Due[]> {
  const posts = await prisma.socialPost.findMany({
    where: {
      AND: [
        NOT_CONTENT,
        onlyPostId ? { id: onlyPostId } : {},
        { isPreset: false, status: { in: ["posted", "partial"] } },
      ],
    },
    select: { id: true, format: true, postedAt: true, targets: true },
  });
  const stats = await prisma.socialPostStats.findMany({
    where: { postId: { in: posts.map((p) => p.id) } },
    select: { postId: true, platform: true, capturedAges: true, syncedAt: true },
  });
  const statsOf = new Map(stats.map((s) => [`${s.postId}:${s.platform}`, s]));

  const out: Due[] = [];
  for (const post of posts) {
    const format = formatOf(post.format);
    for (const target of post.targets) {
      if (target.platform === "google" || !hasPostStats(target.platform, format)) continue;
      if (target.status !== "posted" || !target.externalId || !setUp(target.platform)) continue;
      const postedAt = target.postedAt ?? post.postedAt;
      if (!postedAt) continue;
      const row = statsOf.get(`${post.id}:${target.platform}`);
      const captured = row?.capturedAges ?? [];
      const age = milestoneDue(postedAt, format, captured, now);
      if (age === null && !onlyPostId) continue;
      out.push({
        postId: post.id,
        format,
        platform: target.platform,
        externalId: target.externalId,
        postedAt,
        captured,
        age,
        syncedAt: row?.syncedAt ?? null,
      });
    }
  }
  return out.sort(
    (a, b) =>
      Number(b.format === "story") - Number(a.format === "story") ||
      (a.syncedAt?.getTime() ?? 0) - (b.syncedAt?.getTime() ?? 0) ||
      b.postedAt.getTime() - a.postedAt.getTime(),
  );
}

/**
 * Reads and keeps one app copy's figures. A reading counts only when a figure came back, so a
 * failed read is tried again next run; a post gone from the app is marked done.
 * @param item - The copy.
 * @param skips - Names left out, which this adds to.
 * @param now - Now.
 */
async function captureOne(item: Due, skips: Skips, now: Date): Promise<void> {
  const read = await readPost(item.platform, item.externalId, item.format, skips, now);
  const got = FIGURE_KEYS.some((k) => read.figures[k] !== null);
  const keep = got && item.age !== null;
  const capturedAges = read.gone
    ? [...agesFor(item.format)]
    : keep
      ? [...new Set([...item.captured, item.age!])].sort((a, b) => a - b)
      : item.captured;
  const where = { postId_platform: { postId: item.postId, platform: item.platform } };
  const figures = got ? { ...read.figures, extra: read.extra ?? undefined } : {};
  await prisma.socialPostStats.upsert({
    where,
    create: {
      postId: item.postId,
      platform: item.platform,
      postedAt: item.postedAt,
      ...figures,
      unavailable: read.note,
      capturedAges,
      syncedAt: now,
    },
    update: {
      ...figures,
      postedAt: item.postedAt,
      unavailable: read.note,
      capturedAges,
      syncedAt: now,
    },
  });
  if (!keep) return;
  // A reading keeps only what the analytics curves plot; the full set is on the stats row
  const reading = { views: read.figures.views, engagements: read.figures.engagements };
  await prisma.socialInsight.upsert({
    where: {
      postId_platform_ageHours: {
        postId: item.postId,
        platform: item.platform,
        ageHours: item.age!,
      },
    },
    create: { postId: item.postId, platform: item.platform, ageHours: item.age!, ...reading },
    update: reading,
  });
}

/**
 * Reads and keeps one app's account days.
 * @param platform - The app.
 * @param today - Today's NZ key.
 * @param skips - Names left out, which this adds to.
 * @param now - Now.
 * @param deadline - When to stop starting reads (ms since 1970).
 * @returns Days kept, why some figures are missing, and whether every day was read.
 */
async function syncDays(
  platform: SocialPlatformKey,
  today: string,
  skips: Skips,
  now: Date,
  deadline: number,
): Promise<{ count: number; note: string | null; complete: boolean }> {
  const latest = await prisma.socialAccountDay.findFirst({
    where: { platform },
    orderBy: { day: "desc" },
    select: { day: true },
  });
  const { from, to } = dayWindow(platform, today, latest?.day ?? null);
  let days: Map<string, DayFigures>;
  let note: string | null = null;
  let complete = true;
  if (platform === "facebook") {
    ({ days, note } = await readFacebookDays(from, to, skips, now));
  } else if (platform === "instagram") {
    ({ days, note, complete } = await readInstagramDays(
      daysBetween(from, to),
      skips,
      now,
      deadline,
    ));
  } else {
    days = googleDays(await readDailyMetrics(from, to, GOOGLE_DAY_METRICS));
  }
  for (const [day, figures] of days) {
    await prisma.socialAccountDay.upsert({
      where: { platform_day: { platform, day } },
      create: { platform, day, ...figures, syncedAt: now },
      update: { ...figures, syncedAt: now },
    });
  }
  return { count: days.size, note, complete };
}
