// src/app/admin/(shell)/social/design/page.tsx
// Admin post maker home: start a design and the designs and templates made so far.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
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
 * @returns Page element.
 */
export default async function AdminPostMakerPage(): Promise<React.ReactElement> {
  await requireAdminAuth();
  await ensureStarterTemplates();
  const designs = await prisma.socialDesign.findMany({ orderBy: { updatedAt: "desc" } });

  return (
    <>
      <PageHeader
        title="Post maker"
        description="Design a picture once and get every size, ready for each app."
        breadcrumbs={[{ label: "Social posts", href: "/admin/social" }, { label: "Post maker" }]}
      />
      <DesignList initial={designs.map(toDesignSummary)} />
    </>
  );
}
