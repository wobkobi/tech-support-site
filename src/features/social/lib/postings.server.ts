// src/features/social/lib/postings.server.ts
// Server-only: makes postings from content items, keeps lined-up postings in step with their
// item, and counts how often each item has gone out.

import { deleteUnusedPictures } from "@/features/social-design/lib/picture-store";
import { IS_CONTENT, NOT_DETACHED } from "@/features/social/lib/filters";
import { writePostMeta } from "@/features/social/lib/post-meta.server";
import {
  COUNTED_STATUSES,
  NO_STATS,
  captionAfter,
  captionsOf,
  clampCaption,
  postingContent,
  postingFields,
  spentReason,
  type ContentStats,
} from "@/features/social/lib/postings-core";
import {
  publishPost,
  readiness,
  scheduleProblems,
  type PublishOutcome,
} from "@/features/social/lib/publish";
import { prisma } from "@/shared/lib/prisma";
import type { SocialPost } from "@prisma/client";

/** A lined-up posting that won't go out as it stands. */
export interface PostingProblem {
  id: string;
  scheduledAt: string;
  error: string;
}

/** A posting made, and how it went when it was posted straight away. */
export type PostingResult =
  | { ok: true; posting: SocialPost; published: PublishOutcome | null }
  | { ok: false; error: string; status: number };

/** Statuses a posting can still be changed in. */
const NOT_OUT = ["draft", "scheduled"] as const;

/**
 * How often each content item has gone out, when last, and when it next goes.
 * @param ids - Content item ids.
 * @returns Stats per id; ids with no postings are left out.
 */
export async function contentStats(ids: string[]): Promise<Map<string, ContentStats>> {
  if (ids.length === 0) return new Map();
  const [counted, lined] = await Promise.all([
    prisma.socialPost.groupBy({
      by: ["sourceId"],
      where: { sourceId: { in: ids }, status: { in: [...COUNTED_STATUSES] } },
      _count: { _all: true },
      _max: { postedAt: true },
    }),
    prisma.socialPost.groupBy({
      by: ["sourceId"],
      where: { sourceId: { in: ids }, status: "scheduled" },
      _min: { scheduledAt: true },
    }),
  ]);
  const out = new Map<string, ContentStats>();
  for (const row of counted) {
    if (!row.sourceId) continue;
    out.set(row.sourceId, {
      count: row._count._all,
      lastPostedAt: row._max.postedAt,
      nextAt: null,
    });
  }
  for (const row of lined) {
    if (!row.sourceId) continue;
    out.set(row.sourceId, { ...(out.get(row.sourceId) ?? NO_STATS), nextAt: row._min.scheduledAt });
  }
  return out;
}

/**
 * Makes a posting from a content item, for now or a set time. It's checked before it exists the
 * way publishing or scheduling would check it, so a post that can't go is never left behind; a
 * straight-away one that still fails to start is deleted again. The item's next caption moves
 * on once it has gone or been scheduled.
 * @param itemId - Content item id.
 * @param opts - When and which caption.
 * @param opts.when - "now", or the time to go out.
 * @param opts.captionIndex - Caption to use; the item's next in turn when left out.
 * @returns The posting, or why it wasn't made.
 */
export async function createPosting(
  itemId: string,
  opts: { when: "now" | Date; captionIndex?: number },
): Promise<PostingResult> {
  const item = await prisma.socialPost.findFirst({ where: { id: itemId, ...IS_CONTENT } });
  if (!item) return { ok: false, error: "That content item no longer exists.", status: 404 };

  const at = opts.when === "now" ? new Date() : opts.when;
  const stats = (await contentStats([item.id])).get(item.id) ?? NO_STATS;
  const spent = spentReason(item, stats, at);
  if (spent) return { ok: false, error: spent, status: 409 };

  const captions = captionsOf(item);
  let captionIndex: number;
  if (opts.captionIndex === undefined) {
    captionIndex = clampCaption(captions, item.nextCaption);
  } else {
    captionIndex = opts.captionIndex;
    if (!captions[captionIndex]?.trim()) {
      return { ok: false, error: `Caption ${captionIndex + 1} is empty.`, status: 400 };
    }
  }

  const data = postingFields(item, {
    captionIndex,
    scheduledAt: opts.when === "now" ? null : at,
  });
  const preview = { ...item, ...data, isContent: null } as SocialPost;
  if (opts.when === "now") {
    const ready = await readiness(preview);
    if (!ready.ok) return ready;
  } else {
    const problem = scheduleProblems(preview);
    if (problem) return { ok: false, ...problem };
  }

  const posting = await prisma.socialPost.create({ data });
  let published: PublishOutcome | null = null;
  if (opts.when === "now") {
    published = await publishPost(posting.id);
    if (!published.ok) {
      await prisma.socialPost.deleteMany({ where: { id: posting.id, status: "draft" } });
      return published;
    }
  }
  await writePostMeta(item.id, () => ({ nextCaption: captionAfter(captions, captionIndex) }));
  const fresh = await prisma.socialPost.findUnique({ where: { id: posting.id } });
  return { ok: true, posting: fresh ?? posting, published };
}

/**
 * Copies a content item's latest words, picture and settings to its postings that haven't gone
 * out and weren't edited by hand. Each keeps its caption, or caption 1 if that one went. The
 * status guard in each write leaves a posting alone that just started going out.
 * @param item - The content item as just saved.
 * @returns Scheduled postings that now can't go out, with why.
 */
export async function syncPostings(item: SocialPost): Promise<PostingProblem[]> {
  const postings = await prisma.socialPost.findMany({
    where: { sourceId: item.id, status: { in: [...NOT_OUT] }, ...NOT_DETACHED },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      captionIndex: true,
      imageUrl: true,
      targets: { select: { imageUrl: true } },
    },
  });
  const captions = captionsOf(item);
  const problems: PostingProblem[] = [];
  const replaced: (string | null)[] = [];
  for (const p of postings) {
    const data = postingContent(item, clampCaption(captions, p.captionIndex));
    const updated = await prisma.socialPost.updateMany({
      where: { id: p.id, status: p.status, ...NOT_DETACHED },
      data,
    });
    if (updated.count === 0) continue;
    replaced.push(p.imageUrl, ...p.targets.map((t) => t.imageUrl));
    if (p.status !== "scheduled" || !p.scheduledAt) continue;
    const problem = scheduleProblems({ ...item, ...data, isContent: null });
    if (problem) {
      problems.push({ id: p.id, scheduledAt: p.scheduledAt.toISOString(), error: problem.error });
    }
  }
  await deleteUnusedPictures(replaced);
  return problems;
}

/**
 * Scheduled postings of an item that won't go out as they stand, for the item's page.
 * @param item - The content item.
 * @returns Problems, soonest first.
 */
export async function postingProblems(item: SocialPost): Promise<PostingProblem[]> {
  const postings = await prisma.socialPost.findMany({
    where: { sourceId: item.id, status: "scheduled" },
    orderBy: { scheduledAt: "asc" },
  });
  return postings.flatMap((p) => {
    const problem = scheduleProblems(p);
    return problem && p.scheduledAt
      ? [{ id: p.id, scheduledAt: p.scheduledAt.toISOString(), error: problem.error }]
      : [];
  });
}

/**
 * Makes a posting follow its content item again after a hand edit, copying the item over it.
 * @param id - Posting id.
 * @returns Done, or why not.
 */
export async function relinkPosting(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const posting = await prisma.socialPost.findUnique({ where: { id } });
  if (!posting?.sourceId) {
    return { ok: false, error: "This post wasn't made from a content item.", status: 404 };
  }
  const item = await prisma.socialPost.findFirst({
    where: { id: posting.sourceId, ...IS_CONTENT },
  });
  if (!item) return { ok: false, error: "Its content item has been deleted.", status: 404 };
  const data = postingContent(item, clampCaption(captionsOf(item), posting.captionIndex));
  const updated = await prisma.socialPost.updateMany({
    where: { id, status: { in: [...NOT_OUT] } },
    data: { ...data, detached: false },
  });
  if (updated.count === 0) {
    return {
      ok: false,
      error: "It has already gone out, so it can't follow its item again.",
      status: 409,
    };
  }
  await deleteUnusedPictures([posting.imageUrl, ...posting.targets.map((t) => t.imageUrl)]);
  return { ok: true };
}

/**
 * Deletes a content item's postings that haven't gone out and weren't edited by hand, before the
 * item goes. Postings already out, and hand-edited ones, stay as ordinary posts.
 * @param itemId - Content item id.
 * @returns Picture addresses the deleted postings used, for the caller's clean-up.
 */
export async function deleteLinedUpPostings(itemId: string): Promise<(string | null)[]> {
  const where = { sourceId: itemId, status: { in: [...NOT_OUT] }, ...NOT_DETACHED };
  const postings = await prisma.socialPost.findMany({
    where,
    select: { imageUrl: true, targets: { select: { imageUrl: true } } },
  });
  await prisma.socialPost.deleteMany({ where });
  return postings.flatMap((p) => [p.imageUrl, ...p.targets.map((t) => t.imageUrl)]);
}
