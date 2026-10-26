// src/features/business/lib/promos.server.ts
// Server-only promo cache upkeep, apart from client-imported promos.ts: revalidateTag fails
// the build in a module the client bundle can reach.

import {
  ACTIVE_PROMO_TAG,
  getActivePromo,
  hasActivePromoCode,
  inWindowWhere,
  loadAdvertisedPromo,
} from "@/features/business/lib/promos";
import { prisma } from "@/shared/lib/prisma";
import { revalidateTag } from "next/cache";

/**
 * Busts {@link ACTIVE_PROMO_TAG} when {@link getActivePromo} or {@link hasActivePromoCode} differ
 * from the live queries: a promo started or ended, or a total cap filled or freed up. Run by the
 * 5-minute publish cron and after redemption writes on a capped promo.
 * @returns True when the cache was out of date and the tag was busted.
 */
export async function refreshPromoCacheAtBoundary(): Promise<boolean> {
  const now = new Date();
  const [cachedPromo, cachedHasCode, livePromo, liveCodeCount] = await Promise.all([
    getActivePromo(),
    hasActivePromoCode(),
    loadAdvertisedPromo(now),
    prisma.promo.count({ where: inWindowWhere("code", now) }),
  ]);
  const unchanged =
    (cachedPromo?.id ?? null) === (livePromo?.id ?? null) && cachedHasCode === liveCodeCount > 0;
  if (unchanged) return false;
  revalidateTag(ACTIVE_PROMO_TAG, {});
  return true;
}
