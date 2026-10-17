// src/app/admin/(shell)/social/design/[id]/page.tsx
// Admin post maker editor for one design.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { parseObjectId } from "@/features/business/lib/validation";
import { DesignEditorLoader } from "@/features/social-design/components/DesignEditorLoader";
import { toDesignRow } from "@/features/social-design/lib/design-row";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
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
 * @returns Page element.
 */
export default async function AdminDesignEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const id = parseObjectId((await params).id);
  if (!id) notFound();
  const [design, bound] = await Promise.all([
    prisma.socialDesign.findUnique({ where: { id } }),
    loadBoundValues(),
  ]);
  if (!design) notFound();
  const row = toDesignRow(design);

  return (
    <>
      <PageHeader
        title={row.isTemplate ? "Edit template" : "Edit design"}
        breadcrumbs={[
          { label: "Social posts", href: "/admin/social" },
          { label: "Post maker", href: "/admin/social/design" },
          { label: row.name },
        ]}
      />
      <DesignEditorLoader
        initial={row}
        bound={bound}
        canUpload={canUploadImages()}
        bookingUrl={`${getSiteUrl()}/booking`}
        canDraft={Boolean(process.env.OPENAI_API_KEY)}
      />
    </>
  );
}
