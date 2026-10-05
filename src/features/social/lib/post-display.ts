// src/features/social/lib/post-display.ts
// Display helpers shared by the Social page and the composer inside it.

import type { StatusTone } from "@/features/admin/components/ui/StatusPill";
import type { SocialPostRow, SocialPostStatus } from "@/features/social/lib/post-row";
import { PLATFORM_LABEL, type SocialPlatformKey } from "@/features/social/lib/validate";

export const POST_STATUS_PILL: Record<SocialPostStatus, { tone: StatusTone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  scheduled: { tone: "info", label: "Scheduled" },
  posting: { tone: "warning", label: "Posting" },
  posted: { tone: "success", label: "Posted" },
  partial: { tone: "warning", label: "Partly posted" },
  failed: { tone: "critical", label: "Failed" },
  removing: { tone: "warning", label: "Taking down" },
  removed: { tone: "neutral", label: "Taken down" },
};

/** One platform's connection check result. */
export interface Connection {
  platform: SocialPlatformKey;
  ok: boolean;
  label?: string;
  error?: string;
}

/**
 * Names of the platforms a post is up on right now, for take-down wording.
 * @param p - Post row.
 * @returns Display names, empty when it isn't up anywhere.
 */
export function liveOn(p: Pick<SocialPostRow, "targets">): string[] {
  return p.targets
    .filter((t) => t.status === "posted")
    .map((t) => PLATFORM_LABEL[t.platform as SocialPlatformKey] ?? t.platform);
}
