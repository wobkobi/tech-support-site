// src/features/business/lib/promos.server.ts
// Server-only promo cache upkeep. Kept separate from promos.ts because client components
// import that file for its plain helpers, and revalidateTag fails the build in a module
// the client bundle can reach.

import {
  ACTIVE_PROMO_TAG,
  getActivePromo,
  hasActivePromoCode,
  inWindowWhere,
  PROMO_ORDER,
} from "@/features/business/lib/promos";
import { prisma } from "@/shared/lib/prisma";
import { revalidateTag } from "next/cache";

/**
 * Busts {@link ACTIVE_PROMO_TAG} when a promo has started or ended since the cached
 * answers were taken, by comparing {@link getActivePromo} and
 * {@link hasActivePromoCode} against the same queries run live. Called by the
 * 5-minute publish cron, so the banner and pricing page move on within ~5 minutes of
 * a boundary while costing no ISR writes when nothing changed. Admin edits bust the
 * tag themselves, so only a pure time boundary reaches this.
 * @returns True when the cache was out of date and the tag was busted.
 */
export async function refreshPromoCacheAtBoundary(): Promise<boolean> {
  const now = new Date();
  const [cachedPromo, cachedHasCode, livePromo, liveCodeCount] = await Promise.all([
    getActivePromo(),
    hasActivePromoCode(),
    prisma.promo.findFirst({
      where: inWindowWhere("automatic", now),
      orderBy: PROMO_ORDER,
      select: { id: true },
    }),
    prisma.promo.count({ where: inWindowWhere("code", now) }),
  ]);
  const unchanged =
    (cachedPromo?.id ?? null) === (livePromo?.id ?? null) && cachedHasCode === liveCodeCount > 0;
  if (unchanged) return false;
  revalidateTag(ACTIVE_PROMO_TAG, {});
  return true;
}
