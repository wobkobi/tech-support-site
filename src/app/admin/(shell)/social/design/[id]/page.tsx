// src/app/admin/(shell)/social/design/[id]/page.tsx
// Admin post maker editor for one design. `?review=<inbox id>` (from the Inbox's Make a post from
// this review) opens Draft with AI with that Google review as the brief. A design that has gone
// out opens locked instead, offering a copy to edit.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { parseObjectId } from "@/features/business/lib/validation";
import { DesignEditorLoader } from "@/features/social-design/components/DesignEditorLoader";
import { GoneOutDesign } from "@/features/social-design/components/GoneOutDesign";
import { toDesignRow } from "@/features/social-design/lib/design-row";
import { docHash } from "@/features/social-design/lib/doc";
import { designGoneOut } from "@/features/social-design/lib/gone-out.server";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
import { reviewBrief } from "@/features/social/lib/inbox/map";
import { aiConfigured } from "@/shared/lib/ai/json-completion";
import { requireAdminAuth } from "@/shared/lib/auth";
import { canUploadImages } from "@/shared/lib/image-upload";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit design - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin post maker editor page.
 * @param props - Page props.
 * @param props.params - Route params with the design id.
 * @param props.searchParams - `review`, an inbox review to draft from.
 * @returns Page element.
 */
export default async function AdminDesignEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ review?: string | string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const id = parseObjectId((await params).id);
  if (!id) notFound();
  const { review } = await searchParams;
  const reviewId = aiConfigured() ? parseObjectId(review) : null;
  const [design, bound, reviewRow] = await Promise.all([
    prisma.socialDesign.findUnique({ where: { id } }),
    loadBoundValues(),
    reviewId
      ? prisma.socialComment.findFirst({
          where: { id: reviewId, kind: "review" },
          select: { text: true, authorName: true, rating: true },
        })
      : null,
  ]);
  if (!design) notFound();
  const row = toDesignRow(design);
  const goneOut = await designGoneOut(design);
  const seedBrief = reviewRow?.text.trim()
    ? reviewBrief(reviewRow.text, reviewRow.authorName, reviewRow.rating)
    : null;

  if (goneOut) {
    // Same check as the use route: its post pictures must match the design as it is now.
    const hash = docHash(row.doc, bound);
    const formats: readonly string[] = row.doc.formats;
    /**
     * Whether a size's stored picture matches the design as it is now.
     * @param format - The size.
     * @returns True when it's current.
     */
    const current = (format: string): boolean =>
      row.renders.some((r) => r.format === format && r.docHash === hash);
    const canPost =
      current("feed-4x5") && (!formats.includes("google-4x3") || current("google-4x3"));
    return (
      <>
        <PageHeader
          title="Design"
          breadcrumbs={[
            { label: "Social", href: "/admin/social" },
            { label: "Post maker", href: "/admin/social/design" },
            { label: row.name },
          ]}
        />
        <GoneOutDesign
          designId={row.id}
          pictures={[...row.renders].sort(
            (a, b) => formats.indexOf(a.format) - formats.indexOf(b.format),
          )}
          goneOut={goneOut}
          canPost={canPost}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={row.isTemplate ? "Edit template" : "Edit design"}
        breadcrumbs={[
          { label: "Social", href: "/admin/social" },
          { label: "Post maker", href: "/admin/social/design" },
          { label: row.name },
        ]}
      />
      <DesignEditorLoader
        initial={row}
        bound={bound}
        canUpload={canUploadImages()}
        bookingUrl={`${getSiteUrl()}/booking`}
        canDraft={aiConfigured()}
        seedBrief={seedBrief}
      />
    </>
  );
}
