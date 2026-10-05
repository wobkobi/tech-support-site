// src/app/admin/(shell)/social/page.tsx
// Admin social posts page: starting a post, the post being written, and the posting
// history, all on one page. `?post=<id>` picks which post is open in the composer.
// Seeds the starter presets on the first visit.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { parseObjectId } from "@/features/business/lib/validation";
import { SocialView } from "@/features/social/components/SocialView";
import { loadOpenPost } from "@/features/social/lib/open-post";
import { toPostRow } from "@/features/social/lib/post-row";
import { ensureStarterPostPresets } from "@/features/social/lib/presets";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Social posts - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Social page.
 * @param props - Page props.
 * @param props.searchParams - `post`, the id of the post open in the composer.
 * @returns Social page element.
 */
export default async function AdminSocialPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string | string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  await ensureStarterPostPresets();

  const { post: wanted } = await searchParams;
  const openId = typeof wanted === "string" ? parseObjectId(wanted) : null;
  // Newest created first. Ids grow with creation time, so the order holds still while
  // posts are edited, and presets made together keep the order they were made in.
  const posts = await prisma.socialPost.findMany({ orderBy: { id: "desc" } });
  const found = openId ? posts.find((p) => p.id === openId) : undefined;
  const open = found ? await loadOpenPost(found) : null;

  return (
    <>
      <PageHeader
        title="Social posts"
        description="Write a post once and send it to Facebook and Instagram, now or at a set time."
      />
      <SocialView
        initial={posts.map(toPostRow)}
        open={open}
        openMissing={typeof wanted === "string" && !found}
      />
    </>
  );
}
