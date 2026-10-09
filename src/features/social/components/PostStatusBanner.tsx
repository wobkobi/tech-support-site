"use client";
// src/features/social/components/PostStatusBanner.tsx
// The tinted banner above a locked post in the composer: when it posts, or how posting
// and taking down went on each platform, with the retry and take-down actions.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { LEDGER_LINK_CLS } from "@/features/business/components/ledger-classes";
import { POST_STATUS_PILL } from "@/features/social/lib/post-display";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { PLATFORM_LABEL, type SocialPlatformKey } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import type React from "react";

/**
 * Explains a locked post: scheduled, posting, posted, partly posted, failed, being
 * taken down or taken down, with each platform's outcome.
 * @param props - Component props.
 * @param props.post - The post.
 * @param props.busy - Which action is running.
 * @param props.onCancelSchedule - Cancels a schedule.
 * @param props.onRetry - Re-posts to the failed platforms.
 * @param props.canRetry - Whether a partly posted or failed post has a platform to retry.
 * @param props.onTakeDown - Asks to take the post down.
 * @param props.canTakeDown - Whether it's up on any platform.
 * @param props.onRefresh - Reloads the page data.
 * @returns Banner element, or null for drafts and presets.
 */
export function PostStatusBanner({
  post,
  busy,
  onCancelSchedule,
  onRetry,
  canRetry,
  onTakeDown,
  canTakeDown,
  onRefresh,
}: {
  post: SocialPostRow;
  busy: string | null;
  onCancelSchedule: () => void;
  onRetry: () => void;
  canRetry: boolean;
  onTakeDown: () => void;
  canTakeDown: boolean;
  onRefresh: () => void;
}): React.ReactElement | null {
  if (post.isPreset || post.status === "draft") return null;
  const box =
    "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm";

  if (post.status === "scheduled") {
    return (
      <div className={cn(box, "border-moonstone-300 bg-moonstone-50 text-moonstone-900")}>
        <span>
          Posts {post.scheduledAt ? formatDateTimeShort(post.scheduledAt) : "soon"}. Cancel the
          schedule to make changes.
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

  const pill = POST_STATUS_PILL[post.status];
  const live = post.targets.filter((t) => t.enabled && t.status !== "skipped");
  const removedAt = post.targets
    .map((t) => t.removedAt)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  return (
    <div
      className={cn(
        box,
        "flex-col items-stretch",
        post.status === "posted" && "border-green-300 bg-green-50 text-green-900",
        (post.status === "partial" || post.status === "posting") &&
          "border-amber-300 bg-amber-50 text-amber-900",
        post.status === "failed" && "border-red-300 bg-red-50 text-red-900",
        post.status === "removing" && "border-amber-300 bg-amber-50 text-amber-900",
        post.status === "removed" && "border-admin-border bg-admin-bg text-admin-text",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          {post.status === "posting"
            ? "Still going. Anything left over is picked up automatically within 15 minutes."
            : post.status === "removing"
              ? "Taking it down. If this still shows after 10 minutes, press Take down again."
              : post.status === "removed" && removedAt
                ? `Taken down ${formatDateTimeShort(removedAt)}`
                : post.postedAt && formatDateTimeShort(post.postedAt)}
        </span>
        <div className="flex flex-wrap gap-2">
          {(post.status === "posting" || post.status === "removing") && (
            <AdminButton size="sm" variant="secondary" onClick={onRefresh}>
              Refresh
            </AdminButton>
          )}
          {canRetry && (
            <AdminButton
              size="sm"
              variant="outline"
              busy={busy === "retry"}
              disabled={busy !== null}
              onClick={onRetry}
            >
              Retry failed
            </AdminButton>
          )}
          {canTakeDown && post.status !== "posting" && (
            <AdminButton
              size="sm"
              variant="danger"
              busy={busy === "takedown"}
              disabled={busy !== null}
              onClick={onTakeDown}
            >
              Take down
            </AdminButton>
          )}
        </div>
      </div>
      <ul className="flex flex-col gap-1">
        {live.map((t) => {
          const label = PLATFORM_LABEL[t.platform as SocialPlatformKey] ?? t.platform;
          return (
            <li key={t.platform}>
              <strong>{label}:</strong>{" "}
              {t.status === "posted" ? (
                <>
                  {t.permalink ? (
                    <a
                      href={t.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className={LEDGER_LINK_CLS}
                    >
                      view the post
                    </a>
                  ) : (
                    "posted"
                  )}
                  {t.error && ` - couldn't take it down: ${t.error}`}
                </>
              ) : t.status === "removed" ? (
                "taken down"
              ) : t.status === "failed" ? (
                (t.error ?? "failed")
              ) : (
                "still processing"
              )}
            </li>
          );
        })}
      </ul>
      <span>To post something similar, press Duplicate above.</span>
    </div>
  );
}
