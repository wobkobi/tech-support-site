"use client";
// src/features/social/components/SchedulesView.tsx
// The Schedules tab: each schedule as a card with its times, apps, content and next posting,
// and a pause switch that warns how many lined-up posts it takes off.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { SOCIAL_CONTENT_PATH, SOCIAL_SCHEDULES_PATH, postHref } from "@/features/social/lib/links";
import { describeSlots } from "@/features/social/lib/queue-slots";
import { fillSummary, type FillSummaryInput } from "@/features/social/lib/queues";
import type { QueueSummary } from "@/features/social/lib/queues.server";
import { TAG_COLOURS } from "@/features/social/lib/tags";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { FaPlus } from "react-icons/fa6";

const NEW_HREF = `${SOCIAL_SCHEDULES_PATH}/new`;

/**
 * Schedules list.
 * @param props - Component props.
 * @param props.schedules - Every schedule, A to Z.
 * @param props.contentCount - How many content items there are, to point at Content when none.
 * @param props.fillDays - How many days ahead schedules line posts up.
 * @returns Schedules element.
 */
export function SchedulesView({
  schedules,
  contentCount,
  fillDays,
}: {
  schedules: QueueSummary[];
  contentCount: number;
  fillDays: number;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [pausing, setPausing] = useState<QueueSummary | null>(null);

  /**
   * Pauses or restarts a schedule.
   * @param s - The schedule.
   * @param paused - Paused or running.
   */
  async function setPaused(s: QueueSummary, paused: boolean): Promise<void> {
    setBusy(s.row.id);
    const res = await callApi<{ cleared: number; fill: FillSummaryInput | null }>(
      `/api/admin/social/schedules/${s.row.id}`,
      "PATCH",
      { paused },
    );
    setBusy(null);
    setPausing(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    const head = paused ? `Paused ${s.row.name}.` : `${s.row.name} is running again.`;
    toast([head, fillSummary(res.cleared, res.fill)].join(" ").trim(), { tone: "success" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-admin-muted">
          A schedule posts your content on set days and times, taking turns through the items you
          put in it. Posts are lined up {fillDays} days ahead, and you can change or take off any of
          them in Posts.
        </p>
        <AdminButton href={NEW_HREF}>
          <FaPlus aria-hidden /> New schedule
        </AdminButton>
      </div>

      {schedules.length === 0 ? (
        <Card padding="none">
          <EmptyState
            title="No schedules yet"
            body={
              contentCount === 0
                ? "Add some content first: a schedule takes turns through your content items. The starter set is a quick way in."
                : "Pick the days and times to post, the apps, and which content takes turns. Tech tips on Tuesdays at 9am, say."
            }
            action={
              contentCount === 0 ? (
                <AdminButton href={SOCIAL_CONTENT_PATH}>Go to content</AdminButton>
              ) : (
                <AdminButton href={NEW_HREF}>Make a schedule</AdminButton>
              )
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {schedules.map((s) => (
            <ScheduleCard
              key={s.row.id}
              summary={s}
              busy={busy === s.row.id}
              onPause={() => (s.linedUp > 0 ? setPausing(s) : void setPaused(s, true))}
              onResume={() => void setPaused(s, false)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pausing !== null}
        title={`Pause ${pausing?.row.name ?? "this schedule"}?`}
        body={
          pausing
            ? `${pausing.linedUp === 1 ? "1 lined-up post" : `${pausing.linedUp} lined-up posts`} will be taken off. Posts you edited by hand stay. Turn it back on and it lines posts up again.`
            : undefined
        }
        confirmLabel="Pause"
        busy={pausing !== null && busy === pausing.row.id}
        onConfirm={() => pausing && void setPaused(pausing, true)}
        onCancel={() => setPausing(null)}
      />
    </div>
  );
}

/**
 * One schedule's card.
 * @param props - Component props.
 * @param props.summary - The schedule.
 * @param props.busy - Whether its pause switch is saving.
 * @param props.onPause - Called to pause it.
 * @param props.onResume - Called to turn it back on.
 * @returns Card list item.
 */
function ScheduleCard({
  summary,
  busy,
  onPause,
  onResume,
}: {
  summary: QueueSummary;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
}): React.ReactElement {
  const { row, linedUp, next } = summary;
  const items = row.itemIds.length;
  return (
    <li>
      <Card className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Link
            href={`${SOCIAL_SCHEDULES_PATH}/${row.id}`}
            className="flex min-w-0 items-center gap-2 text-lg font-bold text-admin-text hover:underline"
          >
            <span
              aria-hidden
              className={cn("size-3 shrink-0 rounded-full", TAG_COLOURS[row.colour].dot)}
            />
            <span className="truncate">{row.name}</span>
          </Link>
          {row.paused && <StatusPill tone="neutral">Paused</StatusPill>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-admin-muted">When</dt>
          <dd className="text-admin-text">
            {row.slots.length > 0 ? describeSlots(row.slots) : "No times yet"}
          </dd>
          <dt className="text-admin-muted">Apps</dt>
          <dd className="text-admin-text">
            {row.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}
          </dd>
          <dt className="text-admin-muted">Content</dt>
          <dd className="text-admin-text">
            {items === 0 ? "None yet" : items === 1 ? "1 item" : `${items} items`}
          </dd>
          <dt className="text-admin-muted">Next</dt>
          <dd className="min-w-0 text-admin-text">
            {next ? (
              <Link href={postHref(next)} className="hover:underline">
                {formatDateTimeShort(next.at)}: <span className="wrap-break-word">{next.name}</span>
              </Link>
            ) : row.paused ? (
              "Nothing while it's paused"
            ) : (
              "Nothing lined up"
            )}
            {linedUp > 1 && <span className="text-admin-muted"> ({linedUp} lined up)</span>}
          </dd>
        </dl>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <AdminButton size="sm" variant="secondary" href={`${SOCIAL_SCHEDULES_PATH}/${row.id}`}>
            Edit
          </AdminButton>
          {row.paused ? (
            <AdminButton size="sm" variant="secondary" busy={busy} onClick={onResume}>
              Turn back on
            </AdminButton>
          ) : (
            <AdminButton size="sm" variant="ghost" busy={busy} onClick={onPause}>
              Pause
            </AdminButton>
          )}
        </div>
      </Card>
    </li>
  );
}
