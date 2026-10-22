// src/app/admin/(shell)/social/(hub)/analytics/page.tsx
// Admin Social Analytics tab: `?range=7|28|90` days up to today and `?app=facebook|instagram|google`,
// all apps when left out. Shows the figures the stats sync kept; Refresh reads them again.

import { SocialAnalyticsView } from "@/features/social/components/SocialAnalyticsView";
import { loadAnalytics } from "@/features/social/lib/insights/analytics.server";
import { readAppFilter, readRange } from "@/features/social/lib/insights/metrics";
import { requireAdminAuth } from "@/shared/lib/auth";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Social analytics - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Social Analytics page.
 * @param props - Page props.
 * @param props.searchParams - `range` and `app`.
 * @returns Analytics page element.
 */
export default async function AdminSocialAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[]; app?: string | string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const params = await searchParams;
  const now = new Date();
  const data = await loadAnalytics(readRange(params.range), readAppFilter(params.app), now);
  return <SocialAnalyticsView data={data} now={now.toISOString()} />;
}
