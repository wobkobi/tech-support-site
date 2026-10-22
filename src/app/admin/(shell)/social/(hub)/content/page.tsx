// src/app/admin/(shell)/social/(hub)/content/page.tsx
// Admin Social content tab: the content library, with how often each item has had postings.

import { ContentLibraryView } from "@/features/social/components/ContentLibraryView";
import { librarySummary } from "@/features/social/lib/library";
import { loadContentRows, postedSince } from "@/features/social/lib/postings.server";
import { listTags } from "@/features/social/lib/tags.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { nzDateParts, nzMidnightUtc } from "@/shared/lib/timezone-utils";
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
  const now = new Date();
  const [year, month] = nzDateParts(now);
  const [rows, tags] = await Promise.all([loadContentRows(now), listTags()]);
  const posted = await postedSince(
    rows.map((r) => r.item.id),
    nzMidnightUtc(year, month, 1),
  );
  return <ContentLibraryView rows={rows} tags={tags} summary={librarySummary(rows, posted, now)} />;
}
