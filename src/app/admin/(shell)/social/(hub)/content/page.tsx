// src/app/admin/(shell)/social/(hub)/content/page.tsx
// Admin Social content tab: every content item and how often it has gone out.

import { ContentList } from "@/features/social/components/ContentList";
import { toContentRow } from "@/features/social/lib/content-row";
import { IS_CONTENT } from "@/features/social/lib/filters";
import { NO_STATS } from "@/features/social/lib/postings-core";
import { contentStats } from "@/features/social/lib/postings.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Social content - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Social content page.
 * @returns Content page element.
 */
export default async function AdminSocialContentPage(): Promise<React.ReactElement> {
  await requireAdminAuth();
  const items = await prisma.socialPost.findMany({
    where: IS_CONTENT,
    orderBy: { updatedAt: "desc" },
  });
  const stats = await contentStats(items.map((i) => i.id));
  const now = new Date();
  return <ContentList rows={items.map((i) => toContentRow(i, stats.get(i.id) ?? NO_STATS, now))} />;
}
