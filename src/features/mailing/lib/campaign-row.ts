// src/features/mailing/lib/campaign-row.ts
// Plain-data campaign shape for the server > client boundary and the mailing API.

import type { StatusTone } from "@/features/admin/components/ui/StatusPill";
import { audienceOf, type CampaignAudience } from "@/features/mailing/lib/audience";
import type { Campaign } from "@prisma/client";

/** Campaign lifecycle, mirroring the CampaignStatus enum. */
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "failed";

/** How each status shows as a pill, in Mailing and on a post's linked email. */
export const CAMPAIGN_STATUS_PILL: Record<CampaignStatus, { tone: StatusTone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  scheduled: { tone: "info", label: "Scheduled" },
  sending: { tone: "warning", label: "Sending" },
  sent: { tone: "success", label: "Sent" },
  failed: { tone: "critical", label: "Failed" },
};

/** A campaign as the admin UI sees it. */
export interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  preheader: string | null;
  body: string;
  isPreset: boolean;
  status: CampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  excludedContactIds: string[];
  promoId: string | null;
  audience: CampaignAudience;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Maps a campaign row to its plain shape.
 * @param c - Campaign as stored.
 * @returns The plain shape.
 */
export function toCampaignRow(c: Campaign): CampaignRow {
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    preheader: c.preheader,
    body: c.body,
    isPreset: c.isPreset,
    status: c.status,
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    sentAt: c.sentAt?.toISOString() ?? null,
    excludedContactIds: c.excludedContactIds,
    promoId: c.promoId,
    audience: audienceOf(c.audience),
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
