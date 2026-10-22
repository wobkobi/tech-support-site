// src/app/admin/(shell)/social/(hub)/content/[id]/page.tsx
// Admin page for one content item: the composer in content mode, with its recycling, schedules,
// postings and any lined-up posting that won't go out.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { parseObjectId } from "@/features/business/lib/validation";
import { ContentItemView } from "@/features/social/components/ContentItemView";
import { toStatsRow } from "@/features/social/lib/content-row";
import { IS_CONTENT, NOT_CONTENT } from "@/features/social/lib/filters";
import { SOCIAL_CONTENT_PATH, SOCIAL_POSTS_PATH } from "@/features/social/lib/links";
import { loadOpenPost } from "@/features/social/lib/open-post";
import { toPostRow } from "@/features/social/lib/post-row";
import { NO_STATS } from "@/features/social/lib/postings-core";
import { contentStats, postingProblems } from "@/features/social/lib/postings.server";
import { loadItemQueues } from "@/features/social/lib/queues.server";
import { listTags } from "@/features/social/lib/tags.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Content item - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin content item page.
 * @param props - Page props.
 * @param props.params - Route params with the content item id.
 * @returns Content item page element.
 */
export default async function AdminSocialContentItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const id = parseObjectId((await params).id);
  const item = id ? await prisma.socialPost.findFirst({ where: { id, ...IS_CONTENT } }) : null;
  if (!item) {
    // A post's id opens it in Posts instead.
    if (id && (await prisma.socialPost.count({ where: { id, ...NOT_CONTENT } }))) {
      redirect(`${SOCIAL_POSTS_PATH}?post=${id}`);
    }
    return (
      <Card padding="none">
        <EmptyState
          title="That content item has been deleted."
          action={
            <AdminButton href={SOCIAL_CONTENT_PATH} variant="secondary">
              Back to content
            </AdminButton>
          }
        />
      </Card>
    );
  }

  const [open, postings, stats, problems, tags, schedules] = await Promise.all([
    loadOpenPost(item),
    prisma.socialPost.findMany({ where: { sourceId: item.id }, orderBy: { id: "desc" } }),
    contentStats([item.id]),
    postingProblems(item),
    listTags(),
    loadItemQueues(item.id),
  ]);
  return (
    <ContentItemView
      open={open}
      info={{
        stats: toStatsRow(stats.get(item.id) ?? NO_STATS),
        postings: postings.map(toPostRow),
        problems,
        schedules,
      }}
      tags={tags}
    />
  );
}
