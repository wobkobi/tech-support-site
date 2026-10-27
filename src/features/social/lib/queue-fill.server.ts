// src/features/social/lib/queue-fill.server.ts
// Server-only: lines up postings in each schedule's empty time slots, clears a schedule's
// lined-up postings when it changes, remembers slots taken off by hand, and drops deleted items
// from schedules. The publish-scheduled cron fills every schedule at most hourly; saving a
// schedule fills just that one.

import { deleteUnusedMedia } from "@/features/social-design/lib/picture-store";
import { IS_CONTENT, NOT_DETACHED } from "@/features/social/lib/filters";
import { MEDIA_SELECT, mediaUrlsOf } from "@/features/social/lib/media";
import { writePostMeta } from "@/features/social/lib/post-meta.server";
import {
  COUNTED_STATUSES,
  captionAfter,
  captionsOf,
  clampCaption,
  postingFields,
} from "@/features/social/lib/postings-core";
import { scheduleProblems } from "@/features/social/lib/publish";
import {
  FILL_LEAD_MS,
  rankCandidates,
  slotInstants,
  slotKey,
  slotOf,
  type QueueCandidate,
  type QueueSlot,
} from "@/features/social/lib/queue-slots";
import { prisma } from "@/shared/lib/prisma";
import { acquireRunLock, releaseRunLock } from "@/shared/lib/run-lock";
import type { SocialPost, SocialQueue } from "@prisma/client";

const LOCK_KEY = "social:queueFill";
/** When the cron last filled every schedule, as an ISO time. */
const FILLED_AT_KEY = "social:queueFilledAt";
const FILL_EVERY_MS = 60 * 60_000;
/** A fill stops making postings after this long; the next run carries on. */
const FILL_BUDGET_MS = 20_000;

/** How one schedule's fill went. */
export interface QueueFillResult {
  id: string;
  /** Postings lined up. */
  made: number;
  /** Free slots no item could fill. */
  empty: number;
}

/** How a fill went. */
export interface FillResult {
  made: number;
  queues: QueueFillResult[];
  /** True when the time ran out before every slot was looked at. */
  outOfTime: boolean;
}

/**
 * Whether the cron's hourly fill is due.
 * @param now - Now.
 * @returns True when no fill has run in the last hour.
 */
export async function queueFillDue(now: Date): Promise<boolean> {
  const row = await prisma.setting.findFirst({
    where: { key: FILLED_AT_KEY },
    select: { value: true },
  });
  const last = row ? Date.parse(row.value) : NaN;
  return Number.isNaN(last) || now.getTime() - last >= FILL_EVERY_MS;
}

/**
 * Lines up postings in the empty slots of every running schedule, or just the ones given. An
 * empty slot is one with no posting from the schedule, not taken off by hand, at least ten
 * minutes away, and within the fill window. Each takes the best item that passes the same checks
 * scheduling does; an item that fails gives way to the next.
 * @param opts - What to fill.
 * @param opts.now - Now.
 * @param opts.fillDays - How many days ahead to fill.
 * @param opts.queueIds - Only these schedules; every running one when left out, which also
 *   stamps the hourly fill as done once it got through every slot.
 * @param opts.beforeFill - Runs once the lock is held, so work it does can't be left half
 *   done by a fill that's already running.
 * @returns How it went, or null when another fill is running (and `beforeFill` didn't run).
 */
export async function fillQueues(opts: {
  now: Date;
  fillDays: number;
  queueIds?: string[];
  beforeFill?: () => Promise<void>;
}): Promise<FillResult | null> {
  if (!(await acquireRunLock(LOCK_KEY, 5 * 60_000))) return null;
  try {
    await opts.beforeFill?.();
    const deadline = Date.now() + FILL_BUDGET_MS;
    const queues = await prisma.socialQueue.findMany({
      where: { paused: false, ...(opts.queueIds ? { id: { in: opts.queueIds } } : {}) },
    });
    const result: FillResult = { made: 0, queues: [], outOfTime: false };
    for (const queue of queues) {
      if (Date.now() > deadline) {
        result.outOfTime = true;
        break;
      }
      const one = await fillQueue(queue, opts.now, opts.fillDays, deadline);
      result.queues.push({ id: queue.id, made: one.made, empty: one.empty });
      result.made += one.made;
      if (one.outOfTime) result.outOfTime = true;
      await pruneSkipped(queue, opts.now);
    }
    // A fill cut short stays due, so the next 5-minute run carries on.
    if (!opts.queueIds && !result.outOfTime) {
      const value = opts.now.toISOString();
      await prisma.setting.upsert({
        where: { key: FILLED_AT_KEY },
        create: { key: FILLED_AT_KEY, value },
        update: { value },
      });
    }
    return result;
  } finally {
    await releaseRunLock(LOCK_KEY);
  }
}

/**
 * Fills one schedule's empty slots in time order.
 * @param queue - The schedule.
 * @param now - Now.
 * @param fillDays - How many days ahead to fill.
 * @param deadline - When to stop, in ms.
 * @returns Postings made, slots left empty, and whether time ran out.
 */
async function fillQueue(
  queue: SocialQueue,
  now: Date,
  fillDays: number,
  deadline: number,
): Promise<{ made: number; empty: number; outOfTime: boolean }> {
  const done = { made: 0, empty: 0, outOfTime: false };
  if (queue.slots.length === 0 || queue.platforms.length === 0 || queue.itemIds.length === 0) {
    return done;
  }
  const from = new Date(now.getTime() + FILL_LEAD_MS);
  const instants = slotInstants(queue.slots, from, fillDays);
  if (instants.length === 0) return done;

  // The schedule's own postings: the latest before the window (for In the order below) and
  // every one in it, whatever its status, since a slot with any posting is taken. Posting
  // clears scheduledAt, so what already went out is found by postedAt; read only by slot,
  // In the order would start again at item 1 once every lined-up posting had gone.
  const [before, lastPosted, inWindow] = await Promise.all([
    prisma.socialPost.findFirst({
      where: { queueId: queue.id, scheduledAt: { lt: from } },
      orderBy: { scheduledAt: "desc" },
      select: { sourceId: true, scheduledAt: true },
    }),
    prisma.socialPost.findFirst({
      where: { queueId: queue.id, postedAt: { lt: from } },
      orderBy: { postedAt: "desc" },
      select: { sourceId: true, postedAt: true },
    }),
    prisma.socialPost.findMany({
      where: { queueId: queue.id, scheduledAt: { gte: from } },
      select: { sourceId: true, scheduledAt: true },
    }),
  ]);
  const used = [before, ...inWindow].flatMap((p) =>
    p?.scheduledAt ? [{ ms: p.scheduledAt.getTime(), itemId: p.sourceId }] : [],
  );
  const taken = new Set(used.map((u) => u.ms));
  // Added after `taken`: a posted time marks the order, not a slot.
  if (lastPosted?.postedAt) {
    used.push({ ms: lastPosted.postedAt.getTime(), itemId: lastPosted.sourceId });
  }
  const skipped = new Set(queue.skipped.map((d) => d.getTime()));
  const free = instants.filter((at) => !taken.has(at.getTime()) && !skipped.has(at.getTime()));
  if (free.length === 0) return done;

  const items = await prisma.socialPost.findMany({
    where: { id: { in: queue.itemIds }, ...IS_CONTENT },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const candidates = await loadCandidates(items);

  for (const at of free) {
    if (Date.now() > deadline) {
      done.outOfTime = true;
      break;
    }
    const lastItemId =
      used
        .filter((u) => u.ms < at.getTime())
        .sort((a, b) => b.ms - a.ms)
        .at(0)?.itemId ?? null;
    const ranked = rankCandidates(
      candidates,
      {
        order: queue.order,
        itemIds: queue.itemIds,
        platforms: queue.platforms,
        minGapDays: queue.minGapDays,
        lastItemId,
      },
      at,
    );
    let madeHere = false;
    for (const id of ranked) {
      const item = byId.get(id);
      if (!item) continue;
      const captions = captionsOf(item);
      const captionIndex = clampCaption(captions, item.nextCaption);
      const data = postingFields(item, {
        captionIndex,
        scheduledAt: at,
        platforms: queue.platforms,
        queueId: queue.id,
      });
      if (scheduleProblems({ ...item, ...data, isContent: null })) continue;
      await prisma.socialPost.create({ data });
      const next = captionAfter(captions, captionIndex);
      await writePostMeta(item.id, () => ({ nextCaption: next }));
      // Keep the in-memory copies in step for the slots still to come.
      item.nextCaption = next;
      candidates.find((c) => c.id === id)?.times.push(at.getTime());
      used.push({ ms: at.getTime(), itemId: id });
      done.made++;
      madeHere = true;
      break;
    }
    if (!madeHere) done.empty++;
  }
  return done;
}

/**
 * Items as the slot picker sees them, with the times of every posting that went out or is
 * lined up, from any schedule or by hand.
 * @param items - Content items.
 * @returns Candidates in the same order.
 */
async function loadCandidates(items: SocialPost[]): Promise<QueueCandidate[]> {
  const postings =
    items.length === 0
      ? []
      : await prisma.socialPost.findMany({
          where: {
            sourceId: { in: items.map((i) => i.id) },
            status: { in: [...COUNTED_STATUSES] },
          },
          select: { sourceId: true, scheduledAt: true, postedAt: true },
        });
  const times = new Map<string, number[]>();
  for (const p of postings) {
    const at = p.postedAt ?? p.scheduledAt;
    if (!p.sourceId || !at) continue;
    times.set(p.sourceId, [...(times.get(p.sourceId) ?? []), at.getTime()]);
  }
  return items.map((i) => ({
    id: i.id,
    platforms: i.targets.filter((t) => t.enabled).map((t) => t.platform),
    recycle: i.recycle === true,
    expiresAt: i.expiresAt,
    maxPosts: i.maxPosts,
    times: times.get(i.id) ?? [],
  }));
}

/**
 * Drops slots taken off by hand that have now passed.
 * @param queue - The schedule.
 * @param now - Now.
 */
async function pruneSkipped(queue: SocialQueue, now: Date): Promise<void> {
  const keep = queue.skipped.filter((d) => d.getTime() >= now.getTime());
  if (keep.length === queue.skipped.length) return;
  await prisma.socialQueue.updateMany({ where: { id: queue.id }, data: { skipped: keep } });
}

/** Which of a schedule's lined-up postings to clear. */
export type QueueClear =
  | { all: true }
  /** Postings in slots the schedule no longer has. */
  | { keepSlots: readonly QueueSlot[] }
  /** Postings of items taken out of the schedule. */
  | { itemIds: readonly string[] };

/**
 * Deletes a schedule's lined-up postings that no longer belong: all of them when it's paused,
 * deleted or posts to different apps, or the ones in removed slots or of removed items. The
 * status guard leaves a posting alone that just started going out.
 * @param queueId - Schedule id.
 * @param which - Which to clear.
 * @returns How many were deleted.
 */
export async function clearQueuePostings(queueId: string, which: QueueClear): Promise<number> {
  const postings = await prisma.socialPost.findMany({
    where: { queueId, status: "scheduled", ...NOT_DETACHED },
    select: {
      id: true,
      sourceId: true,
      scheduledAt: true,
      ...MEDIA_SELECT,
    },
  });
  let chosen = postings;
  if ("keepSlots" in which) {
    const keep = new Set(which.keepSlots.map(slotKey));
    chosen = postings.filter((p) => !p.scheduledAt || !keep.has(slotKey(slotOf(p.scheduledAt))));
  } else if ("itemIds" in which) {
    chosen = postings.filter((p) => p.sourceId !== null && which.itemIds.includes(p.sourceId));
  }
  if (chosen.length === 0) return 0;
  const deleted = await prisma.socialPost.deleteMany({
    where: { id: { in: chosen.map((p) => p.id) }, status: "scheduled" },
  });
  await deleteUnusedMedia(chosen.flatMap(mediaUrlsOf));
  return deleted.count;
}

/**
 * How many lined-up postings a schedule would clear when paused or deleted.
 * @param queueId - Schedule id.
 * @returns The count.
 */
export async function countQueuePostings(queueId: string): Promise<number> {
  return prisma.socialPost.count({ where: { queueId, status: "scheduled", ...NOT_DETACHED } });
}

/**
 * Remembers that a schedule's slot was taken off by hand, so the filler doesn't fill it again.
 * @param queueId - Schedule id; a deleted schedule is ignored.
 * @param at - The slot's time.
 */
export async function skipQueueSlot(queueId: string, at: Date): Promise<void> {
  await prisma.socialQueue.updateMany({
    where: { id: queueId },
    data: { skipped: { push: at } },
  });
}

/**
 * Takes deleted content items out of every schedule that held them.
 * @param itemIds - Content item ids.
 */
export async function dropFromQueues(itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const queues = await prisma.socialQueue.findMany({
    where: { itemIds: { hasSome: [...itemIds] } },
    select: { id: true, itemIds: true },
  });
  for (const q of queues) {
    await prisma.socialQueue.update({
      where: { id: q.id },
      data: { itemIds: q.itemIds.filter((id) => !itemIds.includes(id)) },
    });
  }
}
