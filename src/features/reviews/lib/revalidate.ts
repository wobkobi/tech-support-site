// src/features/reviews/lib/revalidate.ts
import { revalidatePath, revalidateTag } from "next/cache";

/**
 * Triggers ISR revalidation for all public review pages.
 * Call after any review status change (approve, revoke, delete).
 * revalidateTag("reviews") clears the unstable_cache entry on the home page
 * so ISR regeneration picks up the latest approved reviews immediately.
 * The second argument ({}) is a Next.js 16 CacheLifeConfig (all fields optional).
 */
export function revalidateReviewPaths(): void {
  revalidateTag("reviews", {});
  revalidatePath("/reviews");
  revalidatePath("/review");
  revalidatePath("/");
}
