"use client";
// src/features/mailing/components/CampaignStatusBanner.tsx
// The tinted banner above a locked email in the editor: scheduled, sending, sent or failed.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import type { CampaignRow } from "@/features/mailing/lib/campaign-row";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import type React from "react";

/**
 * Explains a locked email: scheduled, sending, sent or failed.
 * @param props - Component props.
 * @param props.campaign - The email.
 * @param props.busy - Which action is running.
 * @param props.onCancelSchedule - Cancels a schedule.
 * @param props.onRefresh - Reloads the page data.
 * @returns Banner element, or null for drafts and presets.
 */
export function CampaignStatusBanner({
  campaign,
  busy,
  onCancelSchedule,
  onRefresh,
}: {
  campaign: CampaignRow;
  busy: string | null;
  onCancelSchedule: () => void;
  onRefresh: () => void;
}): React.ReactElement | null {
  if (campaign.isPreset || campaign.status === "draft") return null;
  const box =
    "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm";

  if (campaign.status === "scheduled") {
    return (
      <div className={cn(box, "border-moonstone-300 bg-moonstone-50 text-moonstone-900")}>
        <span>
          Sends {campaign.scheduledAt ? formatDateTimeShort(campaign.scheduledAt) : "soon"}. Cancel
          the schedule to make changes.
        </span>
        <AdminButton
          size="sm"
          variant="secondary"
          busy={busy === "unschedule"}
          onClick={onCancelSchedule}
        >
          Cancel schedule
        </AdminButton>
      </div>
    );
  }
  if (campaign.status === "sending") {
    return (
      <div className={cn(box, "border-amber-300 bg-amber-50 text-amber-900")}>
        <span>Sending now. Anything left over is picked up automatically within 15 minutes.</span>
        <AdminButton size="sm" variant="secondary" onClick={onRefresh}>
          Refresh
        </AdminButton>
      </div>
    );
  }
  return (
    <div
      className={cn(
        box,
        campaign.status === "sent"
          ? "border-green-300 bg-green-50 text-green-900"
          : "border-red-300 bg-red-50 text-red-900",
      )}
    >
      <span>
        {campaign.status === "sent" ? "Sent" : "Nothing went out"}
        {campaign.sentAt && ` ${formatDateTimeShort(campaign.sentAt)}`} - {campaign.sentCount} sent
        {campaign.failedCount > 0 && `, ${campaign.failedCount} failed`}. Duplicate it from the
        Mailing page to send something similar.
      </span>
    </div>
  );
}
