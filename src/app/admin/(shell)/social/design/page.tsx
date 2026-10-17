// src/app/admin/(shell)/social/design/page.tsx
// Admin post maker home: start a design and the designs and templates made so far.
// `?post=<id>` (from the composer's "Design a picture") starts a design for that post.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { parseObjectId } from "@/features/business/lib/validation";
import { DesignList } from "@/features/social-design/components/DesignList";
import { toDesignSummary } from "@/features/social-design/lib/design-row";
import { ensureStarterTemplates } from "@/features/social-design/templates/seed";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Post maker - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin post maker page.
 * @param props - Page props.
 * @param props.searchParams - `post`, the id of the post a new design is for.
 * @returns Page element.
 */
export default async function AdminPostMakerPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string | string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  await ensureStarterTemplates();
  const { post: wanted } = await searchParams;
  const postId = typeof wanted === "string" ? parseObjectId(wanted) : null;
  const [designs, forPost] = await Promise.all([
    prisma.socialDesign.findMany({ orderBy: { updatedAt: "desc" } }),
    postId
      ? prisma.socialPost.findUnique({ where: { id: postId }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Post maker"
        description="Design a picture once and get every size, ready for each app."
        breadcrumbs={[{ label: "Social posts", href: "/admin/social" }, { label: "Post maker" }]}
      />
      <DesignList initial={designs.map(toDesignSummary)} forPost={forPost} />
    </>
  );
}
