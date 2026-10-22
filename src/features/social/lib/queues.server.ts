// src/features/social/lib/queues.server.ts
// Server-only: makes, changes and deletes schedules, keeping their lined-up postings in step,
// and loads what the Schedules pages show.

import type { ContentListRow } from "@/features/social/lib/content-row";
import { IS_CONTENT } from "@/features/social/lib/filters";
import { loadContentRows } from "@/features/social/lib/postings.server";
import {
  clearQueuePostings,
  countQueuePostings,
  fillQueues,
  type FillResult,
} from "@/features/social/lib/queue-fill.server";
import {
  MAX_QUEUE_ITEMS,
  UPCOMING_COUNT,
  nextSlotInstants,
  upcomingSlots,
  type UpcomingSlot,
} from "@/features/social/lib/queue-slots";
import {
  toQueueRow,
  type ItemQueue,
  type QueueInput,
  type QueueRow,
} from "@/features/social/lib/queues";
import { prisma } from "@/shared/lib/prisma";

/** A schedule for the Schedules list. */
export interface QueueSummary {
  row: QueueRow;
  /** Lined-up postings. */
  linedUp: number;
  /** The next lined-up posting. */
  next: { id: string; at: string; name: string } | null;
}

/** Everything the schedule editor shows. */
export interface QueueEditorData {
  /** The schedule, or null for a new one. */
  row: QueueRow | null;
  /** Every content item, for the schedule's list and the Add picker. */
  content: ContentListRow[];
  upcoming: UpcomingSlot[];
  linedUp: number;
}

/** A schedule saved, with what changed in its lined-up postings. */
export interface QueueSaved {
  row: QueueRow;
  /** Lined-up postings deleted because they no longer fit. */
  cleared: number;
  /** The fill that followed, or null when another fill was running or it's paused. */
  fill: FillResult | null;
}

/**
 * Every schedule, A to Z, with how many postings each has lined up and the next one.
 * @returns Summaries.
 */
export async function loadQueueSummaries(): Promise<QueueSummary[]> {
  const queues = await prisma.socialQueue.findMany({ orderBy: { name: "asc" } });
  if (queues.length === 0) return [];
  const lined = await prisma.socialPost.findMany({
    where: { queueId: { in: queues.map((q) => q.id) }, status: "scheduled" },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, queueId: true, scheduledAt: true, name: true },
  });
  return queues.map((q) => {
    const mine = lined.filter((p) => p.queueId === q.id);
    const first = mine[0];
    return {
      row: toQueueRow(q),
      linedUp: mine.length,
      next: first?.scheduledAt
        ? { id: first.id, at: first.scheduledAt.toISOString(), name: first.name }
        : null,
    };
  });
}

/**
 * What the schedule editor needs.
 * @param id - Schedule id, or null for a new one.
 * @param now - Now.
 * @param fillDays - How far ahead schedules fill.
 * @returns The data, or null when the schedule doesn't exist.
 */
export async function loadQueueEditor(
  id: string | null,
  now: Date,
  fillDays: number,
): Promise<QueueEditorData | null> {
  const queue = id ? await prisma.socialQueue.findUnique({ where: { id } }) : null;
  if (id && !queue) return null;
  const content = await loadContentRows(now);
  if (!queue) return { row: null, content, upcoming: [], linedUp: 0 };

  const last = nextSlotInstants(queue.slots, now, UPCOMING_COUNT).at(-1);
  const [postings, linedUp] = await Promise.all([
    last
      ? prisma.socialPost.findMany({
          where: { queueId: queue.id, scheduledAt: { gte: now, lte: last } },
          select: { id: true, name: true, status: true, scheduledAt: true, captionIndex: true },
        })
      : [],
    countQueuePostings(queue.id),
  ]);
  return {
    row: toQueueRow(queue),
    content,
    upcoming: upcomingSlots(queue, postings, now, fillDays),
    linedUp,
  };
}

/**
 * Content item ids that exist, in the order given.
 * @param ids - Ids from the request.
 * @returns The ones that are content items.
 */
async function existingItems(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const found = await prisma.socialPost.findMany({
    where: { id: { in: ids }, ...IS_CONTENT },
    select: { id: true },
  });
  const ok = new Set(found.map((f) => f.id));
  return ids.filter((id) => ok.has(id));
}

/**
 * Makes a schedule and lines up its first postings.
 * @param input - Its fields.
 * @param now - Now.
 * @param fillDays - How far ahead to fill.
 * @returns The schedule and its first fill.
 */
export async function createQueue(
  input: QueueInput,
  now: Date,
  fillDays: number,
): Promise<QueueSaved> {
  const queue = await prisma.socialQueue.create({
    data: { ...input, itemIds: await existingItems(input.itemIds) },
  });
  const fill = queue.paused ? null : await fillQueues({ now, fillDays, queueIds: [queue.id] });
  return { row: toQueueRow(queue), cleared: 0, fill };
}

/**
 * Changes a schedule, then clears lined-up postings that no longer fit and fills it again.
 * Pausing or changing its apps clears every lined-up posting; removing times or items clears
 * just theirs. A change to the order or gap leaves what's lined up; Line up again redoes it.
 * @param id - Schedule id.
 * @param patch - Fields to change.
 * @param now - Now.
 * @param fillDays - How far ahead to fill.
 * @returns The saved schedule, or null when it doesn't exist.
 */
export async function updateQueue(
  id: string,
  patch: Partial<QueueInput>,
  now: Date,
  fillDays: number,
): Promise<QueueSaved | null> {
  const before = await prisma.socialQueue.findUnique({ where: { id } });
  if (!before) return null;
  const data = patch.itemIds ? { ...patch, itemIds: await existingItems(patch.itemIds) } : patch;
  const queue = await prisma.socialQueue.update({ where: { id }, data });

  let cleared = 0;
  const appsChanged =
    patch.platforms !== undefined &&
    [...patch.platforms].sort().join() !== [...before.platforms].sort().join();
  if (queue.paused || appsChanged) {
    cleared = await clearQueuePostings(id, { all: true });
  } else {
    if (patch.slots) cleared += await clearQueuePostings(id, { keepSlots: queue.slots });
    const removed = before.itemIds.filter((i) => !queue.itemIds.includes(i));
    if (removed.length > 0) cleared += await clearQueuePostings(id, { itemIds: removed });
  }
  const fill = queue.paused ? null : await fillQueues({ now, fillDays, queueIds: [id] });
  return { row: toQueueRow(queue), cleared, fill };
}

/**
 * Deletes a schedule with its lined-up postings. Postings that went out stay as posts.
 * @param id - Schedule id.
 * @returns Lined-up postings cleared, or null when it doesn't exist.
 */
export async function deleteQueue(id: string): Promise<number | null> {
  const found = await prisma.socialQueue.count({ where: { id } });
  if (found === 0) return null;
  const cleared = await clearQueuePostings(id, { all: true });
  await prisma.socialQueue.deleteMany({ where: { id } });
  return cleared;
}

/**
 * Clears a schedule's lined-up postings and lines them up again, for after a change to its
 * order or gap.
 * @param id - Schedule id.
 * @param now - Now.
 * @param fillDays - How far ahead to fill.
 * @returns Cleared and the fill, or null when it doesn't exist.
 */
export async function redoQueue(
  id: string,
  now: Date,
  fillDays: number,
): Promise<{ cleared: number; fill: FillResult | null } | null> {
  const queue = await prisma.socialQueue.findUnique({ where: { id } });
  if (!queue) return null;
  const cleared = await clearQueuePostings(id, { all: true });
  const fill = queue.paused ? null : await fillQueues({ now, fillDays, queueIds: [id] });
  return { cleared, fill };
}

/**
 * Every schedule, marking the ones a content item is in.
 * @param itemId - Content item id.
 * @returns Schedules A to Z.
 */
export async function loadItemQueues(itemId: string): Promise<ItemQueue[]> {
  const queues = await prisma.socialQueue.findMany({ orderBy: { name: "asc" } });
  return queues.map((q) => {
    const row = toQueueRow(q);
    return {
      id: row.id,
      name: row.name,
      colour: row.colour,
      paused: row.paused,
      member: q.itemIds.includes(itemId),
    };
  });
}

/**
 * Puts a content item in exactly these schedules: added to the end of new ones, taken out of
 * the rest with its lined-up postings there, then each changed schedule fills again.
 * @param itemId - Content item id.
 * @param queueIds - The schedules it should be in.
 * @param now - Now.
 * @param fillDays - How far ahead to fill.
 * @returns What changed, or why not.
 */
export async function setItemQueues(
  itemId: string,
  queueIds: string[],
  now: Date,
  fillDays: number,
): Promise<
  | { ok: true; added: number; removed: number; cleared: number; fill: FillResult | null }
  | { ok: false; error: string; status: number }
> {
  const item = await prisma.socialPost.count({ where: { id: itemId, ...IS_CONTENT } });
  if (item === 0) return { ok: false, error: "That content item no longer exists.", status: 404 };
  const queues = await prisma.socialQueue.findMany();
  const unknown = queueIds.filter((id) => !queues.some((q) => q.id === id));
  if (unknown.length > 0) {
    return { ok: false, error: "A schedule you picked has been deleted.", status: 404 };
  }

  let added = 0;
  let removed = 0;
  let cleared = 0;
  const changed: string[] = [];
  for (const q of queues) {
    const has = q.itemIds.includes(itemId);
    const want = queueIds.includes(q.id);
    if (has === want) continue;
    if (want) {
      if (q.itemIds.length >= MAX_QUEUE_ITEMS) {
        return {
          ok: false,
          error: `"${q.name}" already has ${MAX_QUEUE_ITEMS} content items.`,
          status: 409,
        };
      }
      await prisma.socialQueue.update({
        where: { id: q.id },
        data: { itemIds: [...q.itemIds, itemId] },
      });
      added++;
    } else {
      await prisma.socialQueue.update({
        where: { id: q.id },
        data: { itemIds: q.itemIds.filter((id) => id !== itemId) },
      });
      cleared += await clearQueuePostings(q.id, { itemIds: [itemId] });
      removed++;
    }
    if (!q.paused) changed.push(q.id);
  }
  const fill = changed.length > 0 ? await fillQueues({ now, fillDays, queueIds: changed }) : null;
  return { ok: true, added, removed, cleared, fill };
}
