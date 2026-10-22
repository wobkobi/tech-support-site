// src/features/social/lib/calendar-data.server.ts
// Server-only: what the Social calendar shows. Posts that go or went out in a span of days, the
// times running schedules still have open, the Instagram grid, and the content items to drag on.

import {
  calendarStatus,
  type CalendarEntry,
  type CalendarItem,
  type CalendarSchedule,
} from "@/features/social/lib/calendar";
import { coverOf } from "@/features/social/lib/cover";
import { NOT_CONTENT } from "@/features/social/lib/filters";
import { postViews } from "@/features/social/lib/insights/analytics.server";
import { formatOf } from "@/features/social/lib/media";
import { captionsOf, clampCaption } from "@/features/social/lib/postings-core";
import { loadContentRows } from "@/features/social/lib/postings.server";
import { FILL_LEAD_MS, slotInstants } from "@/features/social/lib/queue-slots";
import { isTagColour } from "@/features/social/lib/tags";
import type { SocialPlatformKey } from "@/features/social/lib/validate";
import { prisma } from "@/shared/lib/prisma";
import type { Prisma } from "@prisma/client";

const DAY_MS = 86_400_000;

/** Most scheduled and most posted tiles the Instagram grid shows. */
const GRID_AHEAD = 30;
const GRID_POSTED = 30;

/** Statuses that are on the calendar: everything but a draft. */
const ON_CALENDAR = [
  "scheduled",
  "posting",
  "posted",
  "partial",
  "failed",
  "removing",
  "removed",
] as const;

const ENTRY_SELECT = {
  id: true,
  name: true,
  body: true,
  status: true,
  scheduledAt: true,
  postedAt: true,
  postingStartedAt: true,
  queueId: true,
  sourceId: true,
  tagIds: true,
  imageUrl: true,
  format: true,
  video: { select: { coverUrl: true } },
  targets: { select: { platform: true, enabled: true, textOverride: true, imageUrl: true } },
} satisfies Prisma.SocialPostSelect;

type EntryPost = Prisma.SocialPostGetPayload<{ select: typeof ENTRY_SELECT }>;

/**
 * A post as a calendar entry, placed at when it went out, else when it's due or started.
 * @param p - The post.
 * @param app - Take the words and picture from this app's copy when it's on.
 * @returns The entry, or null for a draft or a post with no time.
 */
function toEntry(p: EntryPost, app?: SocialPlatformKey): CalendarEntry | null {
  const status = calendarStatus(p.status);
  const at = p.postedAt ?? p.scheduledAt ?? p.postingStartedAt;
  if (!status || !at) return null;
  const on = p.targets.filter((t) => t.enabled);
  const own = on.find((t) => t.platform === app) ?? on[0];
  return {
    id: p.id,
    at: at.toISOString(),
    status,
    name: p.name,
    format: formatOf(p.format),
    text: own?.textOverride ?? p.body,
    platforms: on.map((t) => t.platform),
    queueId: p.queueId,
    sourceId: p.sourceId,
    tagIds: p.tagIds,
    thumb:
      (app && own?.imageUrl) ||
      p.imageUrl ||
      on.find((t) => t.imageUrl)?.imageUrl ||
      p.video?.coverUrl ||
      null,
    later: false,
    views: null,
  };
}

/**
 * The posts and open times between two instants. An open time is a running schedule's slot with
 * no posting in it yet that wasn't emptied by hand; it's marked `later` when it's further ahead
 * than schedules line up, so the filler hasn't had a go at it yet.
 * @param from - First instant.
 * @param to - Instant after the last.
 * @param now - Now.
 * @param fillDays - How far ahead schedules line up.
 * @returns Entries in no set order.
 */
export async function loadCalendarEntries(
  from: Date,
  to: Date,
  now: Date,
  fillDays: number,
): Promise<CalendarEntry[]> {
  const inRange = { gte: from, lt: to };
  const [posts, queues] = await Promise.all([
    prisma.socialPost.findMany({
      where: {
        AND: [
          NOT_CONTENT,
          { isPreset: false, status: { in: [...ON_CALENDAR] } },
          {
            OR: [{ scheduledAt: inRange }, { postedAt: inRange }, { postingStartedAt: inRange }],
          },
        ],
      },
      select: ENTRY_SELECT,
    }),
    prisma.socialQueue.findMany({
      where: { paused: false },
      select: { id: true, name: true, platforms: true, slots: true, skipped: true },
    }),
  ]);
  const entries = await withViews(
    posts.flatMap((p) => {
      const e = toEntry(p);
      return e && Date.parse(e.at) >= from.getTime() && Date.parse(e.at) < to.getTime() ? [e] : [];
    }),
  );

  // The filler leaves anything inside its lead time alone, so those aren't open any more.
  const start = Math.max(from.getTime(), now.getTime() + FILL_LEAD_MS);
  if (queues.length === 0 || start >= to.getTime()) return entries;
  const taken = await prisma.socialPost.findMany({
    where: {
      queueId: { in: queues.map((q) => q.id) },
      scheduledAt: { gte: new Date(start), lt: to },
    },
    select: { queueId: true, scheduledAt: true },
  });
  const takenKeys = new Set(taken.map((p) => `${p.queueId}:${p.scheduledAt?.getTime()}`));
  const horizon = now.getTime() + fillDays * DAY_MS;
  const days = Math.ceil((to.getTime() - start) / DAY_MS);
  for (const q of queues) {
    const skipped = new Set(q.skipped.map((d) => d.getTime()));
    for (const at of slotInstants(q.slots, new Date(start), days)) {
      const ms = at.getTime();
      if (ms >= to.getTime() || skipped.has(ms) || takenKeys.has(`${q.id}:${ms}`)) continue;
      entries.push({
        id: `open:${q.id}:${ms}`,
        at: at.toISOString(),
        status: "open",
        name: q.name,
        format: "feed",
        text: "",
        platforms: q.platforms,
        queueId: q.id,
        sourceId: null,
        tagIds: [],
        thumb: null,
        later: ms >= horizon,
        views: null,
      });
    }
  }
  return entries;
}

/**
 * The Instagram grid as the profile will show it, newest top-left: scheduled Instagram posts
 * (furthest ahead first), then the latest that went out there.
 * @returns Tiles in grid order, each with its Instagram picture.
 */
export async function loadInstagramGrid(): Promise<CalendarEntry[]> {
  // Stories never reach the profile grid; posts and reels do.
  const onGrid = {
    OR: [{ format: null }, { format: { isSet: false } }, { format: { in: ["feed", "reel"] } }],
  } satisfies Prisma.SocialPostWhereInput;
  const base = [NOT_CONTENT, { isPreset: false }, onGrid];
  const [ahead, posted] = await Promise.all([
    prisma.socialPost.findMany({
      where: {
        AND: [
          ...base,
          { status: { in: ["scheduled", "posting"] } },
          { targets: { some: { platform: "instagram", enabled: true } } },
        ],
      },
      orderBy: { scheduledAt: "desc" },
      take: GRID_AHEAD,
      select: ENTRY_SELECT,
    }),
    prisma.socialPost.findMany({
      where: {
        AND: [
          ...base,
          { status: { in: ["posted", "partial"] } },
          { targets: { some: { platform: "instagram", status: "posted" } } },
        ],
      },
      orderBy: { postedAt: "desc" },
      take: GRID_POSTED,
      select: ENTRY_SELECT,
    }),
  ]);
  return withViews([...ahead, ...posted].flatMap((p) => toEntry(p, "instagram") ?? []));
}

/**
 * Adds the views read so far to the entries that have gone out.
 * @param entries - Entries.
 * @returns The same entries, with views where there are any.
 */
async function withViews(entries: CalendarEntry[]): Promise<CalendarEntry[]> {
  const out = entries.filter((e) => e.status === "posted" || e.status === "partial");
  const views = await postViews(out.map((e) => e.id));
  for (const e of out) e.views = views.get(e.id) ?? null;
  return entries;
}

/**
 * The content items for the side panel, A to Z.
 * @param now - The time to judge finished items at.
 * @returns Items with their captions and the next in turn.
 */
export async function loadCalendarItems(now: Date): Promise<CalendarItem[]> {
  const rows = await loadContentRows(now);
  return rows
    .map(({ item, spent, queueIds }) => {
      const captions = captionsOf(item);
      return {
        id: item.id,
        name: item.name,
        captions,
        next: clampCaption(captions, item.nextCaption),
        thumb: coverOf(item)?.url ?? null,
        spent,
        queueIds,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every schedule, A to Z, for colours, the key and Fill this time.
 * @returns Schedules.
 */
export async function loadCalendarSchedules(): Promise<CalendarSchedule[]> {
  const queues = await prisma.socialQueue.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, colour: true, itemIds: true },
  });
  return queues.map((q) => ({
    id: q.id,
    name: q.name,
    colour: isTagColour(q.colour) ? q.colour : "grey",
    itemIds: q.itemIds,
  }));
}
