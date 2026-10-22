// src/features/social/lib/connections.server.ts
// Whether each platform's credentials still work, from a harmless read on each. Cached for ten
// minutes, so the Overview and the composer's previews don't make three live calls on every open.

import { PLATFORMS } from "@/features/social/lib/platforms";
import type { Connection } from "@/features/social/lib/post-display";
import { SOCIAL_PLATFORMS } from "@/features/social/lib/validate";
import { revalidateTag, unstable_cache } from "next/cache";

/** Cache tag on the connection check. */
export const CONNECTIONS_TAG = "social-connections";

/**
 * Checks every platform now.
 * @returns One result per platform; a platform without its keys says which are missing.
 */
async function checkLive(): Promise<Connection[]> {
  return Promise.all(
    SOCIAL_PLATFORMS.map(async (platform): Promise<Connection> => {
      const adapter = PLATFORMS[platform];
      const missing = adapter.missingEnv();
      if (missing.length > 0) {
        return { platform, ok: false, error: `Not set up: ${missing.join(", ")} missing.` };
      }
      return { platform, ...(await adapter.checkConnection()) };
    }),
  );
}

/** The last check, at most ten minutes old. */
export const checkConnections = unstable_cache(checkLive, ["social-connections"], {
  tags: [CONNECTIONS_TAG],
  revalidate: 600,
});

/**
 * Checks again for the Check again button. Expiring the tag outright, not stale-while-revalidate,
 * means the next cached read misses too, so a token fixed a minute ago shows as working everywhere.
 * @returns Fresh results.
 */
export async function recheckConnections(): Promise<Connection[]> {
  revalidateTag(CONNECTIONS_TAG, { expire: 0 });
  return checkLive();
}
