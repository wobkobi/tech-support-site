// src/features/reviews/lib/revalidate.ts
// ISR revalidation for the public review pages, called after any review status change.

import { revalidatePath, revalidateTag } from "next/cache";

/**
 * Revalidates every public review page, including service pages quoting pinned reviews.
 * {@link revalidateTag} needs its second `{}` argument in Next.js 16.
 */
export function revalidateReviewPaths(): void {
  revalidateTag("reviews", {});
  revalidatePath("/reviews");
  revalidatePath("/review");
  revalidatePath("/");
  // Service detail pages quote pinned reviews; an unapproved one must drop off now.
  revalidatePath("/services/[slug]", "page");
}
