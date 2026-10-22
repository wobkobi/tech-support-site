// src/features/social/lib/permissions.server.ts
// The permissions grid's facts: which apps have their keys, the Meta token's permissions and
// expiry, and a read against each Google API. Cached under the connection check's tag, so Check
// again refreshes both.

import { CONNECTIONS_TAG } from "@/features/social/lib/connections.server";
import { probeGoogle } from "@/features/social/lib/google-business";
import { inspectToken } from "@/features/social/lib/meta-token.server";
import type { MetaTokenInfo, Permissions } from "@/features/social/lib/permissions";
import { PLATFORMS } from "@/features/social/lib/platforms";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { revalidateTag, unstable_cache } from "next/cache";

/**
 * Checks everything now.
 * @returns The grid's facts.
 */
async function checkLive(): Promise<Permissions> {
  const setUp = Object.fromEntries(
    SOCIAL_PLATFORMS.map((p) => [p, PLATFORMS[p].missingEnv().length === 0]),
  ) as Record<SocialPlatformKey, boolean>;
  const [token, google] = await Promise.all([
    inspectToken().then(
      (info): { info: MetaTokenInfo | null; error: string | null } => ({ info, error: null }),
      (error: unknown) => ({
        info: null,
        error: error instanceof Error ? error.message : "Couldn't read the Meta token.",
      }),
    ),
    setUp.google ? probeGoogle(new Date()) : null,
  ]);
  return { setUp, token: token.info, tokenError: token.error, google };
}

/** The last check, at most ten minutes old. */
export const checkPermissions = unstable_cache(checkLive, ["social-permissions"], {
  tags: [CONNECTIONS_TAG],
  revalidate: 600,
});

/**
 * Checks again for the Check again button, expiring the cache as the connection check does.
 * @returns Fresh results.
 */
export async function recheckPermissions(): Promise<Permissions> {
  revalidateTag(CONNECTIONS_TAG, { expire: 0 });
  return checkLive();
}
