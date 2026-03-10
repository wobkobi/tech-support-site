// src/features/reviews/lib/revalidate.ts
import { revalidatePath } from "next/cache";

/**
 * Triggers ISR revalidation for all public review pages.
 * Call after any review status change (approve, revoke, delete).
 */
export function revalidateReviewPaths(): void {
  revalidatePath("/reviews");
  revalidatePath("/review");
  revalidatePath("/");
}
