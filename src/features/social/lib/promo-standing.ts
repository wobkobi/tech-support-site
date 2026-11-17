// src/features/social/lib/promo-standing.ts
// Where a promo stands for posts tied to it: live (with the window it can be advertised in),
// off for now, or ended for good. Pure, so the queue filler, the cron sweep and checks agree.

import { nzDateKey } from "@/shared/lib/timezone-utils";

/** A promo as a post tied to it sees it. */
export type PromoStanding =
  /** Can be advertised from `from` up to (not including) `to`, in ms. */
  | { state: "live"; from: number; to: number }
  /** Switched off, used up or a code promo: posts wait, since it may come back. */
  | { state: "off" }
  /** Past its end date or deleted: posts tied to it never go out again. */
  | { state: "ended"; endAt: Date | null };

/** The promo fields the standing reads. */
export interface PromoForStanding {
  startAt: Date;
  endAt: Date;
  isActive: boolean;
  kind: string;
}

/**
 * Where a promo stands now. Only automatic promos are advertised, matching publish's check.
 * @param promo - The promo, or null when it was deleted.
 * @param usedUp - Whether its total cap is reached.
 * @param now - Now.
 * @returns Its standing.
 */
export function promoStanding(
  promo: PromoForStanding | null,
  usedUp: boolean,
  now: Date,
): PromoStanding {
  if (!promo) return { state: "ended", endAt: null };
  if (promo.endAt.getTime() <= now.getTime()) return { state: "ended", endAt: promo.endAt };
  if (!promo.isActive || promo.kind !== "automatic" || usedUp) return { state: "off" };
  return { state: "live", from: promo.startAt.getTime(), to: promo.endAt.getTime() };
}

/**
 * Whether a post tied to a promo could go out at a time.
 * @param standing - The promo's standing.
 * @param at - When it would go out.
 * @returns True only when the promo is live and the time is inside its dates.
 */
export function promoCovers(standing: PromoStanding, at: Date): boolean {
  const ms = at.getTime();
  return standing.state === "live" && ms >= standing.from && ms < standing.to;
}

/**
 * The last day to post a content item tied to an ended promo: the promo's last NZ day, or the day
 * before now when the promo was deleted. Stored as UTC midnight of that NZ date, as the item's
 * Last day to post is.
 * @param endAt - When the promo ended, or null when it was deleted.
 * @param now - Now.
 * @returns The date to store.
 */
export function retiredLastDay(endAt: Date | null, now: Date): Date {
  // The end instant is exclusive, so its last day is the NZ day of the millisecond before.
  const at = endAt ? new Date(endAt.getTime() - 1) : new Date(now.getTime() - 24 * 3600_000);
  return new Date(`${nzDateKey(at)}T00:00:00.000Z`);
}
