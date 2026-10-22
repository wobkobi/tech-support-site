// src/app/admin/(shell)/social/(hub)/schedules/page.tsx
// Admin Social schedules tab: every schedule with its times, apps, items and next posting.

import { SchedulesView } from "@/features/social/components/SchedulesView";
import { IS_CONTENT } from "@/features/social/lib/filters";
import { loadQueueSummaries } from "@/features/social/lib/queues.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Social schedules - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Social schedules page.
 * @returns Schedules page element.
 */
export default async function AdminSocialSchedulesPage(): Promise<React.ReactElement> {
  await requireAdminAuth();
  const [schedules, contentCount, { social }] = await Promise.all([
    loadQueueSummaries(),
    prisma.socialPost.count({ where: IS_CONTENT }),
    getSettings(),
  ]);
  return (
    <SchedulesView
      schedules={schedules}
      contentCount={contentCount}
      fillDays={social.schedules.fillDays}
    />
  );
}
