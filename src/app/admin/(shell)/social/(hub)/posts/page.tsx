// src/app/admin/(shell)/social/(hub)/posts/page.tsx
// Admin social posts page: new post, composer (`?post=<id>`) and history. Seeds presets on first
// visit. Content items have their own tab; their postings show here as ordinary posts.

import { parseObjectId } from "@/features/business/lib/validation";
import { SocialView } from "@/features/social/components/SocialView";
import { IS_CONTENT, NOT_CONTENT } from "@/features/social/lib/filters";
import { SOCIAL_CONTENT_PATH } from "@/features/social/lib/links";
import { loadOpenPost } from "@/features/social/lib/open-post";
import { toPostRow } from "@/features/social/lib/post-row";
import { ensureStarterPostPresets } from "@/features/social/lib/presets";
import { listTags } from "@/features/social/lib/tags.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Social posts - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Social posts page.
 * @param props - Page props.
 * @param props.searchParams - `post`, the id of the post open in the composer.
 * @returns Social page element.
 */
export default async function AdminSocialPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string | string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  await ensureStarterPostPresets();

  const { post: wanted } = await searchParams;
  const openId = typeof wanted === "string" ? parseObjectId(wanted) : null;
  // Newest first by id, which grows with creation time and ignores edits.
  const [posts, tags] = await Promise.all([
    prisma.socialPost.findMany({ where: NOT_CONTENT, orderBy: { id: "desc" } }),
    listTags(),
  ]);
  const found = openId ? posts.find((p) => p.id === openId) : undefined;
  if (openId && !found) {
    // An old link to a content item opens it on its own page.
    const item = await prisma.socialPost.findFirst({
      where: { id: openId, ...IS_CONTENT },
      select: { id: true },
    });
    if (item) redirect(`${SOCIAL_CONTENT_PATH}/${item.id}`);
  }
  const open = found ? await loadOpenPost(found) : null;

  return (
    <SocialView
      initial={posts.map(toPostRow)}
      tags={tags}
      open={open}
      openMissing={typeof wanted === "string" && !found}
    />
  );
}
