// src/app/admin/reviews/page.tsx
/**
 * @file page.tsx
 * @description Redirects legacy /admin/reviews URL to /admin.
 */

import { redirect } from "next/navigation";

/**
 * Redirects to /admin, preserving the token query param.
 * @param props - Page props.
 * @param props.searchParams - URL search parameters (contains token).
 */
export default async function AdminReviewsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<never> {
  const { token } = await searchParams;
  redirect(`/admin${token ? `?token=${token}` : ""}`);
}
