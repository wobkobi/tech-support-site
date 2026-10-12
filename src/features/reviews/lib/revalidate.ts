// src/features/reviews/lib/revalidate.ts
// ISR revalidation for the public review pages. Call after any review status change so
// the home page, review routes and service detail pages pick up the latest approved reviews.

import { revalidatePath, revalidateTag } from "next/cache";

/**
 * Triggers ISR revalidation for all public review pages, including the service detail
 * pages that quote pinned reviews.
 * Call after any review status change (approve, revoke, delete).
 * {@link revalidateTag}("reviews") clears the unstable_cache entry on the home page
 * so ISR regeneration picks up the latest approved reviews immediately.
 * The second argument ({}) is a Next.js 16 CacheLifeConfig - the fields are
 * optional but the argument itself is required.
 */
export function revalidateReviewPaths(): void {
  revalidateTag("reviews", {});
  revalidatePath("/reviews");
  revalidatePath("/review");
  revalidatePath("/");
  // Service detail pages quote pinned reviews; an unapproved one must drop off now.
  revalidatePath("/services/[slug]", "page");
}
