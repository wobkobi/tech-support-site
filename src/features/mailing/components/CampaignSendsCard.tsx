"use client";
// src/features/mailing/components/CampaignSendsCard.tsx
// "Who it went to" card in the email editor: each recipient's copy with its outcome, and
// a retry for the copies that failed.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import type { SendRow } from "@/features/mailing/components/CampaignEditor";
import type { CampaignStatus } from "@/features/mailing/lib/campaign-row";
import type React from "react";

const SEND_PILL: Record<SendRow["status"], { tone: StatusTone; label: string }> = {
  pending: { tone: "neutral", label: "Waiting" },
  sent: { tone: "success", label: "Sent" },
  failed: { tone: "critical", label: "Failed" },
};

/**
 * Per-recipient results for an email that has gone out.
 * @param props - Component props.
 * @param props.sends - One row per recipient's copy.
 * @param props.failedCount - How many copies failed.
 * @param props.status - The email's status; no retry while it's still sending.
 * @param props.retrying - Whether a retry is running.
 * @param props.onRetry - Re-sends only the failed copies.
 * @returns Card element.
 */
export function CampaignSendsCard({
  sends,
  failedCount,
  status,
  retrying,
  onRetry,
}: {
  sends: SendRow[];
  failedCount: number;
  status: CampaignStatus;
  retrying: boolean;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader
        title="Who it went to"
        description={`${sends.filter((s) => s.status === "sent").length} sent, ${failedCount} failed`}
        actions={
          failedCount > 0 && status !== "sending" ? (
            <AdminButton busy={retrying} onClick={onRetry}>
              Retry failed
            </AdminButton>
          ) : undefined
        }
      />
      <ul className="mt-3 max-h-112 divide-y divide-admin-border overflow-y-auto rounded-lg border border-admin-border">
        {sends.map((s) => (
          <li
            key={s.id}
            className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-admin-text">{s.name}</p>
              <p className="truncate text-sm text-admin-muted">{s.email}</p>
              {s.error && <p className="text-sm text-red-700">{s.error}</p>}
            </div>
            <StatusPill tone={SEND_PILL[s.status].tone}>{SEND_PILL[s.status].label}</StatusPill>
          </li>
        ))}
      </ul>
    </Card>
  );
}
