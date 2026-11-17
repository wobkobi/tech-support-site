// src/features/social/lib/promo-retire.server.ts
// Server-only: keeps schedules away from promos that aren't running. Content items tied to an
// ended promo are retired (their last day to post becomes the promo's last day, with one push
// per promo), and schedule postings whose promo won't be running at their time are taken off
// before they fail. Run by the publish-scheduled cron ahead of its due posts.

import { countedRedemptionsWhere } from "@/features/business/lib/promos";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import { deleteUnusedMedia } from "@/features/social-design/lib/picture-store";
import { IS_CONTENT, NOT_DETACHED } from "@/features/social/lib/filters";
import { SOCIAL_CONTENT_PATH } from "@/features/social/lib/links";
import { MEDIA_SELECT, mediaUrlsOf } from "@/features/social/lib/media";
import { writePostMeta } from "@/features/social/lib/post-meta.server";
import {
  promoCovers,
  promoStanding,
  retiredLastDay,
  type PromoStanding,
} from "@/features/social/lib/promo-standing";
import { prisma } from "@/shared/lib/prisma";

/**
 * Loads where each promo stands now.
 * @param ids - Promo ids; repeats are fine.
 * @param now - Now.
 * @returns Standing and title by id; a deleted promo is ended with no title.
 */
export async function loadPromoStandings(
  ids: readonly string[],
  now: Date,
): Promise<Map<string, { standing: PromoStanding; title: string | null }>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, { standing: PromoStanding; title: string | null }>();
  if (unique.length === 0) return out;
  const rows = await prisma.promo.findMany({ where: { id: { in: unique } } });
  for (const id of unique) {
    const row = rows.find((r) => r.id === id) ?? null;
    const usedUp =
      row?.maxRedemptions != null &&
      (await prisma.promoRedemption.count({ where: countedRedemptionsWhere(row) })) >=
        row.maxRedemptions;
    out.set(id, { standing: promoStanding(row, usedUp, now), title: row?.title ?? null });
  }
  return out;
}

/** What a sweep did. */
export interface PromoSweep {
  /** Content items given a last day to post. */
  retired: number;
  /** Schedule postings taken off. */
  cleared: number;
}

/**
 * Retires content items whose promo has ended and takes off schedule postings whose promo won't
 * be running at their time, so a schedule never lines up (or fails, with a push each) on a
 * promo that's over. Postings edited by hand and posts scheduled by hand are left to fail at
 * their time as usual, with their own push.
 * @param now - Now.
 * @returns What it did.
 */
export async function sweepPromoQueues(now: Date): Promise<PromoSweep> {
  const [items, lined] = await Promise.all([
    prisma.socialPost.findMany({
      where: { ...IS_CONTENT, promoId: { not: null } },
      select: { id: true, name: true, promoId: true },
    }),
    prisma.socialPost.findMany({
      where: {
        status: "scheduled",
        queueId: { not: null },
        promoId: { not: null },
        ...NOT_DETACHED,
      },
      select: { id: true, promoId: true, scheduledAt: true, ...MEDIA_SELECT },
    }),
  ]);
  const promoIds = [...items, ...lined].flatMap((p) => (p.promoId ? [p.promoId] : []));
  const standings = await loadPromoStandings(promoIds, now);
  const done: PromoSweep = { retired: 0, cleared: 0 };

  // Retire: one push per ended promo naming what stopped, sent only for items changed now.
  const retiredByPromo = new Map<string, string[]>();
  for (const item of items) {
    const standing = item.promoId ? standings.get(item.promoId)?.standing : undefined;
    if (standing?.state !== "ended") continue;
    const lastDay = retiredLastDay(standing.endAt, now);
    const result = await writePostMeta(item.id, (post) =>
      post.expiresAt && post.expiresAt.getTime() <= lastDay.getTime()
        ? null
        : { expiresAt: lastDay },
    );
    if (result !== "done") continue;
    done.retired++;
    retiredByPromo.set(item.promoId!, [...(retiredByPromo.get(item.promoId!) ?? []), item.name]);
  }
  for (const [promoId, names] of retiredByPromo) {
    const title = standings.get(promoId)?.title;
    const what = names.length === 1 ? `"${names[0]}"` : `${names.length} content items`;
    await sendOwnerPush({
      title: "Promo posts stopped",
      body: `${title ? `"${title}"` : "A promo"} has ended, so ${what} won't be posted again.`,
      url: SOCIAL_CONTENT_PATH,
      tag: `social-promo-ended-${promoId}`,
    });
  }

  // Take off schedule postings an ended promo, or a live one's dates, won't cover. A promo that's
  // only off keeps its postings, since it may come back. The status guard spares one going out.
  const dead = lined.filter((p) => {
    const standing = p.promoId ? standings.get(p.promoId)?.standing : undefined;
    if (!standing || standing.state === "off" || !p.scheduledAt) return false;
    return !promoCovers(standing, p.scheduledAt);
  });
  if (dead.length > 0) {
    const deleted = await prisma.socialPost.deleteMany({
      where: { id: { in: dead.map((p) => p.id) }, status: "scheduled" },
    });
    done.cleared = deleted.count;
    await deleteUnusedMedia(dead.flatMap(mediaUrlsOf));
  }
  return done;
}
