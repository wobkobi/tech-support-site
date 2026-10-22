// src/app/admin/(shell)/social/(hub)/page.tsx
// Admin Social Overview: figures, the set-up list, what needs attention, the next seven days and
// the linked accounts. An old `?post=<id>` link still goes on to that post.

import { SocialOverview } from "@/features/social/components/SocialOverview";
import { SOCIAL_POSTS_PATH } from "@/features/social/lib/links";
import { loadOverview } from "@/features/social/lib/overview-data.server";
import { listTags } from "@/features/social/lib/tags.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Social - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Social Overview page.
 * @param props - Page props.
 * @param props.searchParams - `post`, a post an older link opened.
 * @returns Overview page element.
 */
export default async function AdminSocialPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string | string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const { post } = await searchParams;
  if (typeof post === "string") redirect(`${SOCIAL_POSTS_PATH}?post=${encodeURIComponent(post)}`);
  const [data, tags] = await Promise.all([loadOverview(new Date()), listTags()]);
  return <SocialOverview data={data} tags={tags} />;
}
