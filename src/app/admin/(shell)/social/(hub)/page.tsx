// src/app/admin/(shell)/social/(hub)/page.tsx
// /admin/social opens the posts page, keeping an old `?post=<id>` link pointed at its post.

import { SOCIAL_POSTS_PATH } from "@/features/social/lib/links";
import { requireAdminAuth } from "@/shared/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Sends /admin/social on to the posts page.
 * @param props - Page props.
 * @param props.searchParams - `post`, a post an older link opened.
 * @returns Never; it always redirects.
 */
export default async function AdminSocialPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string | string[] }>;
}): Promise<never> {
  await requireAdminAuth();
  const { post } = await searchParams;
  redirect(
    typeof post === "string"
      ? `${SOCIAL_POSTS_PATH}?post=${encodeURIComponent(post)}`
      : SOCIAL_POSTS_PATH,
  );
}
