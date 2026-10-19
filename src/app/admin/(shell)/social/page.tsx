// src/app/admin/(shell)/social/page.tsx
// Admin social posts page: new post, composer (`?post=<id>`) and history. Seeds presets on first visit.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
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
import { FaPalette } from "react-icons/fa6";

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
  // Newest first by id, which grows with creation time and ignores edits.
  const posts = await prisma.socialPost.findMany({ orderBy: { id: "desc" } });
  const found = openId ? posts.find((p) => p.id === openId) : undefined;
  const open = found ? await loadOpenPost(found) : null;

  return (
    <>
      <PageHeader
        title="Social posts"
        description="Write a post once and send it to Facebook, Instagram and Google, now or at a set time."
        actions={
          <AdminButton href="/admin/social/design" variant="outline">
            <FaPalette aria-hidden className="size-3.5" /> Post maker
          </AdminButton>
        }
      />
      <SocialView
        initial={posts.map(toPostRow)}
        open={open}
        openMissing={typeof wanted === "string" && !found}
      />
    </>
  );
}
