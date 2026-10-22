// src/features/social/components/ScheduleUpcoming.tsx
// A schedule's next time slots and what each holds: the lined-up post, or why it's empty.

import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { postHref } from "@/features/social/lib/links";
import type { UpcomingSlot, UpcomingState } from "@/features/social/lib/queue-slots";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";

/** What an empty slot says, by why it's empty. */
const EMPTY_TEXT: Record<Exclude<UpcomingState, "lined-up">, string> = {
  skipped: "Left empty: you took this one off.",
  empty: "Nothing to post: add content or turn on recycling.",
  "no-items": "Nothing to post: add content to this schedule.",
  later: "Lined up nearer the time.",
  paused: "Paused.",
};

/** Pills for a lined-up post that has started going out. */
const STATUS_PILL: Record<string, { tone: StatusTone; label: string }> = {
  posting: { tone: "info", label: "Posting" },
  posted: { tone: "success", label: "Posted" },
  partial: { tone: "warning", label: "Partly posted" },
  failed: { tone: "critical", label: "Failed" },
  removing: { tone: "info", label: "Taking down" },
  removed: { tone: "neutral", label: "Taken down" },
};

/**
 * Upcoming slots list.
 * @param props - Component props.
 * @param props.slots - The next slots, soonest first.
 * @param props.dirty - Whether there are unsaved changes, which the list doesn't show yet.
 * @returns List element.
 */
export function ScheduleUpcoming({
  slots,
  dirty,
}: {
  slots: UpcomingSlot[];
  dirty: boolean;
}): React.ReactElement {
  if (slots.length === 0) {
    return <p className="text-admin-muted">Add some times and save to see what goes out when.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {dirty && (
        <p className="text-sm text-admin-muted">
          This shows the saved schedule. Save to update it.
        </p>
      )}
      <ol className="flex flex-col divide-y divide-admin-border">
        {slots.map((s) => {
          const pill = s.post ? STATUS_PILL[s.post.status] : undefined;
          return (
            <li key={s.at} className="flex flex-col gap-0.5 py-2.5">
              <span className="text-sm font-semibold text-admin-text">
                {formatDateTimeShort(s.at)}
              </span>
              {s.post ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={postHref(s.post)}
                    className="wrap-break-word text-admin-text hover:underline"
                  >
                    {s.post.name || "Untitled"}
                  </Link>
                  {s.post.captionIndex !== null && s.post.captionIndex > 0 && (
                    <span className="text-sm text-admin-muted">
                      Caption {s.post.captionIndex + 1}
                    </span>
                  )}
                  {pill && <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
                </span>
              ) : (
                <span
                  className={cn(
                    "text-admin-muted",
                    (s.state === "empty" || s.state === "no-items") && "text-coquelicot-700",
                  )}
                >
                  {EMPTY_TEXT[s.state as Exclude<UpcomingState, "lined-up">]}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
