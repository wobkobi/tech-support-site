// src/app/admin/(shell)/social/(hub)/schedules/[id]/page.tsx
// Admin page for one schedule, or a new one at /new: its times, apps, order and content, and
// what its next time slots hold.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { parseObjectId } from "@/features/business/lib/validation";
import { ScheduleEditor } from "@/features/social/components/ScheduleEditor";
import { SOCIAL_SCHEDULES_PATH } from "@/features/social/lib/links";
import { loadQueueEditor } from "@/features/social/lib/queues.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Schedule - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin schedule page.
 * @param props - Page props.
 * @param props.params - Route params with the schedule id, or "new".
 * @returns Schedule page element.
 */
export default async function AdminSocialSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const raw = (await params).id;
  const id = raw === "new" ? null : parseObjectId(raw);
  const { social } = await getSettings();
  const data =
    raw === "new" || id ? await loadQueueEditor(id, new Date(), social.schedules.fillDays) : null;
  if (!data) {
    return (
      <Card padding="none">
        <EmptyState
          title="That schedule has been deleted."
          action={
            <AdminButton href={SOCIAL_SCHEDULES_PATH} variant="secondary">
              Back to schedules
            </AdminButton>
          }
        />
      </Card>
    );
  }
  return (
    <ScheduleEditor
      key={data.row?.id ?? "new"}
      data={data}
      fillDays={social.schedules.fillDays}
      defaultMinute={social.schedules.defaultMinute}
    />
  );
}
