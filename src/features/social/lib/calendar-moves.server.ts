// src/features/social/lib/calendar-moves.server.ts
// Server-only: moving a scheduled post to another time from the calendar, and swapping two
// scheduled posts' times from the Instagram grid. A post stays in its schedule only when it lands
// on one of that schedule's times with nothing else of the schedule's in it; a time a schedule's
// post leaves stays empty, so the filler doesn't put something else there.

import { MIN_LEAD_MS } from "@/features/social/lib/calendar";
import { scheduleProblems } from "@/features/social/lib/publish";
import { skipQueueSlot } from "@/features/social/lib/queue-fill.server";
import { slotKey, slotOf } from "@/features/social/lib/queue-slots";
import { prisma } from "@/shared/lib/prisma";
import type { SocialPost } from "@prisma/client";

/** A post's time and schedule after a move. */
export interface Moved {
  id: string;
  scheduledAt: string;
  queueId: string | null;
}

/** How a move or swap went. */
export type MoveResult =
  { ok: true; moved: Moved[] } | { ok: false; error: string; status: number };

type Movable = SocialPost & { scheduledAt: Date };

const CHANGED = "It changed while you were moving it - it may have just started posting.";

/**
 * Loads a post that can still be moved: scheduled, not a content item, and not about to go.
 * @param id - Post id.
 * @param now - Now.
 * @returns The post, or why it can't move.
 */
async function loadMovable(
  id: string,
  now: Date,
): Promise<{ ok: true; post: Movable } | { ok: false; error: string; status: number }> {
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post || post.isPreset || post.isContent) {
    return { ok: false, error: "Post not found.", status: 404 };
  }
  if (post.status !== "scheduled" || !post.scheduledAt) {
    return { ok: false, error: "Only a scheduled post can be moved.", status: 409 };
  }
  if (post.scheduledAt.getTime() < now.getTime() + MIN_LEAD_MS) {
    return {
      ok: false,
      error: "It goes out in under a minute, so it can't move now.",
      status: 409,
    };
  }
  return { ok: true, post: post as Movable };
}

/**
 * The schedule a post keeps at a new time: its own, when the time is one of that schedule's and
 * no other post of the schedule is in it.
 * @param post - The post being moved.
 * @param at - Its new time.
 * @param moving - Ids of every post in this move, which don't count as being in the way.
 * @returns The schedule id, or null when it leaves the schedule.
 */
async function queueAt(post: Movable, at: Date, moving: readonly string[]): Promise<string | null> {
  if (!post.queueId) return null;
  const queue = await prisma.socialQueue.findUnique({
    where: { id: post.queueId },
    select: { slots: true },
  });
  const key = slotKey(slotOf(at));
  if (!queue?.slots.some((s) => slotKey(s) === key)) return null;
  const inTheWay = await prisma.socialPost.count({
    where: { queueId: post.queueId, scheduledAt: at, id: { notIn: [...moving] } },
  });
  return inTheWay === 0 ? post.queueId : null;
}

/**
 * Moves a scheduled post to another time.
 * @param id - Post id.
 * @param at - The new time, at least a minute ahead.
 * @param now - Now.
 * @returns Its new time and schedule, or why it didn't move.
 */
export async function movePost(id: string, at: Date, now: Date): Promise<MoveResult> {
  if (at.getTime() < now.getTime() + MIN_LEAD_MS) {
    return { ok: false, error: "Pick a time at least a minute from now.", status: 400 };
  }
  const found = await loadMovable(id, now);
  if (!found.ok) return found;
  const post = found.post;
  const was = post.scheduledAt;
  if (was.getTime() === at.getTime()) {
    return { ok: true, moved: [{ id, scheduledAt: at.toISOString(), queueId: post.queueId }] };
  }
  const problem = scheduleProblems({ ...post, scheduledAt: at });
  if (problem) return { ok: false, ...problem };

  const queueId = await queueAt(post, at, [id]);
  const updated = await prisma.socialPost.updateMany({
    where: { id, status: "scheduled", scheduledAt: was },
    data: { scheduledAt: at, queueId },
  });
  if (updated.count === 0) return { ok: false, error: CHANGED, status: 409 };
  if (post.queueId) await skipQueueSlot(post.queueId, was);
  return { ok: true, moved: [{ id, scheduledAt: at.toISOString(), queueId }] };
}

/**
 * Swaps the times of two scheduled posts. When the second write misses (that post just started
 * going out, or was changed), the first is put back.
 * @param aId - One post.
 * @param bId - The other.
 * @param now - Now.
 * @returns Both posts' new times and schedules, or why nothing changed.
 */
export async function swapPosts(aId: string, bId: string, now: Date): Promise<MoveResult> {
  if (aId === bId) return { ok: false, error: "Pick another post to swap with.", status: 400 };
  const [foundA, foundB] = await Promise.all([loadMovable(aId, now), loadMovable(bId, now)]);
  if (!foundA.ok) return foundA;
  if (!foundB.ok) return foundB;
  const a = foundA.post;
  const b = foundB.post;
  const atA = a.scheduledAt;
  const atB = b.scheduledAt;
  const problem =
    scheduleProblems({ ...a, scheduledAt: atB }) ?? scheduleProblems({ ...b, scheduledAt: atA });
  if (problem) return { ok: false, ...problem };

  const moving = [a.id, b.id];
  const [queueA, queueB] = await Promise.all([queueAt(a, atB, moving), queueAt(b, atA, moving)]);
  const first = await prisma.socialPost.updateMany({
    where: { id: a.id, status: "scheduled", scheduledAt: atA },
    data: { scheduledAt: atB, queueId: queueA },
  });
  if (first.count === 0) return { ok: false, error: CHANGED, status: 409 };
  const second = await prisma.socialPost.updateMany({
    where: { id: b.id, status: "scheduled", scheduledAt: atB },
    data: { scheduledAt: atA, queueId: queueB },
  });
  if (second.count === 0) {
    await prisma.socialPost.updateMany({
      where: { id: a.id, status: "scheduled", scheduledAt: atB },
      data: { scheduledAt: atA, queueId: a.queueId },
    });
    return { ok: false, error: CHANGED, status: 409 };
  }

  // A schedule's time stays its own when the other post took it over for the same schedule.
  if (a.queueId && queueB !== a.queueId) await skipQueueSlot(a.queueId, atA);
  if (b.queueId && queueA !== b.queueId) await skipQueueSlot(b.queueId, atB);
  return {
    ok: true,
    moved: [
      { id: a.id, scheduledAt: atB.toISOString(), queueId: queueA },
      { id: b.id, scheduledAt: atA.toISOString(), queueId: queueB },
    ],
  };
}
