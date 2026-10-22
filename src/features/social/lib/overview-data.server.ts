// src/features/social/lib/overview-data.server.ts
// Everything the Social Overview shows: the figures, the next seven days, what needs attention,
// the set-up list's facts and the steps you've skipped.

import {
  atMinute,
  byTime,
  type CalendarEntry,
  type CalendarSchedule,
} from "@/features/social/lib/calendar";
import {
  loadCalendarEntries,
  loadCalendarSchedules,
} from "@/features/social/lib/calendar-data.server";
import {
  isChecklistKey,
  type ChecklistFacts,
  type ChecklistKey,
} from "@/features/social/lib/checklist";
import { NOT_CONTENT } from "@/features/social/lib/filters";
import { loadViewsWeek, type ViewsWeek } from "@/features/social/lib/insights/analytics.server";
import { loadContentRows } from "@/features/social/lib/postings.server";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { addDaysToDateKey, nzDateKey } from "@/shared/lib/timezone-utils";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back a failed post still needs attention. */
const PROBLEM_DAYS = 30;

/** How many failed posts the list names before it stops. */
const PROBLEM_LIMIT = 10;

/** Steps skipped on the set-up list, as a JSON array of keys. */
const SKIPPED_KEY = "social:checklistDismissed";

/** Something on the Overview's Needs attention list. */
export type AttentionItem =
  | { kind: "problem"; id: string; name: string; status: "failed" | "partial"; at: string | null }
  | { kind: "spent"; id: string; name: string; schedules: string[] }
  | { kind: "empty"; id: string; name: string; count: number; days: number; noItems: boolean };

/** The Overview's figures. */
export interface OverviewStats {
  /** Went out in the last seven days. */
  posted: number;
  /** Going out in the next seven days. */
  scheduled: number;
  /** Failed or partly posted in the last {@link PROBLEM_DAYS} days. */
  problems: number;
  /** Content items. */
  items: number;
  /** Schedule times in the next seven days with nothing lined up that the filler would have filled. */
  open: number;
  /** The next post to go out. */
  next: { id: string; name: string; at: string } | null;
}

/** Everything the Overview shows apart from the connections, which the browser checks. */
export interface OverviewData {
  stats: OverviewStats;
  /** Today's key; the week runs from it for seven days. */
  today: string;
  /** Posts and open times over the next seven days. */
  week: CalendarEntry[];
  schedules: CalendarSchedule[];
  attention: AttentionItem[];
  facts: Omit<ChecklistFacts, "connected" | "permissions">;
  skipped: ChecklistKey[];
  /** Views by app over the last seven full days. */
  views: ViewsWeek;
}

/**
 * Loads the Overview.
 * @param now - Now.
 * @returns The data.
 */
export async function loadOverview(now: Date): Promise<OverviewData> {
  const { social } = await getSettings();
  const fillDays = social.schedules.fillDays;
  const today = nzDateKey(now);
  const weekEnd = atMinute(addDaysToDateKey(today, 7), 0);
  // Empty times are judged over the filler's whole reach, which can be longer than the week.
  const horizon = new Date(Math.max(weekEnd.getTime(), now.getTime() + fillDays * DAY_MS));

  const [entries, schedules, queues, rows, posted, problems, emailed, skipped, views] =
    await Promise.all([
      loadCalendarEntries(atMinute(today, 0), horizon, now, fillDays),
      loadCalendarSchedules(),
      prisma.socialQueue.findMany({
        select: { id: true, name: true, paused: true, itemIds: true },
      }),
      loadContentRows(now),
      prisma.socialPost.count({
        where: {
          AND: [
            NOT_CONTENT,
            {
              isPreset: false,
              status: { in: ["posted", "partial"] },
              postedAt: { gte: new Date(now.getTime() - 7 * DAY_MS), lte: now },
            },
          ],
        },
      }),
      prisma.socialPost.findMany({
        where: {
          AND: [
            NOT_CONTENT,
            {
              isPreset: false,
              status: { in: ["failed", "partial"] },
              updatedAt: { gte: new Date(now.getTime() - PROBLEM_DAYS * DAY_MS) },
            },
          ],
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          scheduledAt: true,
          postedAt: true,
          postingStartedAt: true,
        },
      }),
      hasDraftedEmail(),
      loadChecklistSkipped(),
      loadViewsWeek(now),
    ]);

  const week = entries.filter((e) => Date.parse(e.at) < weekEnd.getTime());
  const ahead = week.filter(
    (e) =>
      (e.status === "scheduled" || e.status === "posting") && Date.parse(e.at) >= now.getTime(),
  );
  const unfilled = entries.filter((e) => e.status === "open" && !e.later);
  const first = [...ahead].sort(byTime)[0];

  const attention: AttentionItem[] = problems.slice(0, PROBLEM_LIMIT).map((p) => ({
    kind: "problem",
    id: p.id,
    name: p.name,
    status: p.status === "partial" ? "partial" : "failed",
    at: (p.postedAt ?? p.postingStartedAt ?? p.scheduledAt)?.toISOString() ?? null,
  }));

  // A finished item in a running schedule is skipped every time, which reads as a gap.
  const running = queues.filter((q) => !q.paused);
  for (const row of rows) {
    if (!row.spent) continue;
    const names = running.filter((q) => q.itemIds.includes(row.item.id)).map((q) => q.name);
    if (names.length > 0) {
      attention.push({ kind: "spent", id: row.item.id, name: row.item.name, schedules: names });
    }
  }

  for (const q of running) {
    const count = unfilled.filter((e) => e.queueId === q.id).length;
    if (count > 0) {
      attention.push({
        kind: "empty",
        id: q.id,
        name: q.name,
        count,
        days: fillDays,
        noItems: q.itemIds.length === 0,
      });
    }
  }

  return {
    stats: {
      posted,
      scheduled: ahead.length,
      problems: problems.length,
      items: rows.length,
      open: week.filter((e) => e.status === "open" && !e.later).length,
      next: first ? { id: first.id, name: first.name, at: first.at } : null,
    },
    today,
    week,
    schedules,
    attention,
    facts: {
      brand: [social.brand.notes, social.brand.audience, social.brand.tone].some(
        (s) => s.trim() !== "",
      ),
      items: rows.length,
      schedules: queues.length,
      recycling: rows.some((r) => r.item.recycle),
      emailed,
    },
    skipped,
    views,
  };
}

/**
 * Whether Email this too has drafted an email from any post. A post can also be linked to the
 * email it was shared from, which was made first, so only an email newer than its post counts.
 * @returns True once one has.
 */
async function hasDraftedEmail(): Promise<boolean> {
  const linked = await prisma.socialPost.findMany({
    where: { campaignId: { not: null } },
    select: { campaignId: true, createdAt: true },
  });
  if (linked.length === 0) return false;
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: linked.flatMap((p) => (p.campaignId ? [p.campaignId] : [])) } },
    select: { id: true, createdAt: true },
  });
  const made = new Map(campaigns.map((c) => [c.id, c.createdAt.getTime()]));
  return linked.some((p) => (made.get(p.campaignId ?? "") ?? 0) > p.createdAt.getTime());
}

/**
 * The set-up steps you've skipped.
 * @returns Step keys; unknown ones are dropped.
 */
export async function loadChecklistSkipped(): Promise<ChecklistKey[]> {
  const row = await prisma.setting.findUnique({ where: { key: SKIPPED_KEY } });
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter(isChecklistKey) : [];
  } catch {
    return [];
  }
}

/**
 * Skips a set-up step, or puts it back.
 * @param key - The step.
 * @param skip - True to skip it, false to put it back.
 * @returns The skipped steps now.
 */
export async function setChecklistSkipped(
  key: ChecklistKey,
  skip: boolean,
): Promise<ChecklistKey[]> {
  const now = await loadChecklistSkipped();
  const next = skip ? [...new Set([...now, key])] : now.filter((k) => k !== key);
  await prisma.setting.upsert({
    where: { key: SKIPPED_KEY },
    create: { key: SKIPPED_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}
