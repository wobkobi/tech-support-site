"use client";
// src/features/social/components/SocialOverview.tsx
// The Social Overview: figures either side of now, the set-up list until it's done, what needs
// attention beside whether each app is connected, then the next seven days.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { StatStrip } from "@/features/admin/components/ui/StatStrip";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { OverviewWeek } from "@/features/social/components/OverviewWeek";
import { SocialChecklist } from "@/features/social/components/SocialChecklist";
import { SocialConnections } from "@/features/social/components/SocialConnections";
import { shortDay, timeOfDay, type ColourContext } from "@/features/social/lib/calendar";
import { checklistOf, type ChecklistKey } from "@/features/social/lib/checklist";
import {
  calendarHref,
  postHref,
  SOCIAL_CONTENT_PATH,
  SOCIAL_POSTS_PATH,
  SOCIAL_SCHEDULES_PATH,
} from "@/features/social/lib/links";
import type { AttentionItem, OverviewData } from "@/features/social/lib/overview-data.server";
import type { Connection } from "@/features/social/lib/post-display";
import type { SocialTagRow } from "@/features/social/lib/tags";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { nzDateKey } from "@/shared/lib/timezone-utils";
import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { FaCircleInfo, FaTriangleExclamation } from "react-icons/fa6";

/**
 * Social Overview.
 * @param props - Component props.
 * @param props.data - What the server loaded.
 * @param props.tags - Every tag, for the chips' details.
 * @returns The overview.
 */
export function SocialOverview({
  data,
  tags,
}: {
  data: OverviewData;
  tags: SocialTagRow[];
}): React.ReactElement {
  const { toast } = useToast();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [skipped, setSkipped] = useState<ChecklistKey[]>(data.skipped);
  const [busyKey, setBusyKey] = useState<ChecklistKey | null>(null);

  // The browser asks for the connections so the page doesn't wait on three apps to answer.
  useEffect(() => {
    let live = true;
    void callApi<{ connections: Connection[] }>("/api/admin/social/connections").then((res) => {
      if (!live) return;
      if (res.ok) setConnections(res.connections);
      else setConnectionsError(res.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const ctx: ColourContext = useMemo(
    () => ({
      queues: new Map(data.schedules.map((s) => [s.id, { name: s.name, colour: s.colour }])),
      tags: new Map(tags.map((t) => [t.id, { name: t.name, colour: t.colour }])),
    }),
    [data.schedules, tags],
  );

  const list = checklistOf(
    { ...data.facts, connected: connections ? connections.filter((c) => c.ok).length : null },
    skipped,
  );

  /** Checks every app again, skipping the cache. */
  async function checkAgain(): Promise<void> {
    setChecking(true);
    const res = await callApi<{ connections: Connection[] }>(
      "/api/admin/social/connections?fresh=1",
    );
    setChecking(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setConnections(res.connections);
    setConnectionsError(null);
  }

  /**
   * Skips a set-up step or puts it back.
   * @param key - The step.
   * @param skip - True to skip.
   */
  async function skipStep(key: ChecklistKey, skip: boolean): Promise<void> {
    setBusyKey(key);
    const res = await callApi<{ skipped: ChecklistKey[] }>("/api/admin/social/checklist", "PUT", {
      key,
      skipped: skip,
    });
    setBusyKey(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setSkipped(res.skipped);
  }

  const { stats } = data;
  const weekHref = calendarHref({ view: "week", colour: "status" });

  return (
    <div className="flex flex-col gap-6">
      <StatStrip label="Social at a glance" className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Posted, last 7 days" value={stats.posted} href={SOCIAL_POSTS_PATH} />
        <StatCard label="Scheduled, next 7 days" value={stats.scheduled} href={weekHref} />
        <StatCard
          label="Next post"
          value={
            stats.next
              ? `${shortDay(nzDateKey(new Date(stats.next.at)))}, ${timeOfDay(stats.next.at)}`
              : "None"
          }
          sub={stats.next?.name ?? "Nothing scheduled"}
          href={stats.next ? postHref({ id: stats.next.id }) : undefined}
        />
        <StatCard
          label="Failed or partly posted"
          value={stats.problems}
          sub="Last 30 days"
          tone={stats.problems > 0 ? "critical" : "default"}
          href={SOCIAL_POSTS_PATH}
        />
        <StatCard
          label="Open times, next 7 days"
          value={stats.open}
          sub="In a schedule, nothing lined up"
          tone={stats.open > 0 ? "warning" : "default"}
          href={weekHref}
        />
        <StatCard label="Content items" value={stats.items} href={SOCIAL_CONTENT_PATH} />
      </StatStrip>

      {!list.complete && (
        <SocialChecklist
          list={list}
          busyKey={busyKey}
          onSkip={(key, skip) => void skipStep(key, skip)}
        />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <NeedsAttention items={data.attention} />
        <SocialConnections
          connections={connections}
          error={connectionsError}
          checking={checking}
          onCheck={() => void checkAgain()}
        />
      </div>

      <OverviewWeek today={data.today} entries={data.week} ctx={ctx} />
    </div>
  );
}

/**
 * Needs attention card.
 * @param props - Component props.
 * @param props.items - What needs attention.
 * @returns Card element.
 */
function NeedsAttention({ items }: { items: AttentionItem[] }): React.ReactElement {
  return (
    <Card>
      <CardHeader title="Needs attention" />
      {items.length === 0 ? (
        <p className="text-base text-admin-muted">Nothing needs you right now.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <AttentionRow key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One thing that needs attention, with a link to sort it.
 * @param props - Component props.
 * @param props.item - The thing.
 * @returns List item.
 */
function AttentionRow({ item }: { item: AttentionItem }): React.ReactElement {
  let text: string;
  let href: string;
  let action: string;
  if (item.kind === "problem") {
    const what = item.status === "partial" ? "only partly posted" : "failed";
    text = `"${item.name}" ${what}${item.at ? ` (${formatDateTimeShort(item.at)})` : ""}.`;
    href = postHref({ id: item.id });
    action = "Open the post";
  } else if (item.kind === "spent") {
    text = `"${item.name}" has finished but is still in ${item.schedules.join(", ")}, so it's skipped there.`;
    href = postHref({ id: item.id, isContent: true });
    action = "Open the item";
  } else {
    const times = `${item.count} empty time${item.count === 1 ? "" : "s"} in the next ${item.days} days`;
    text = item.noItems
      ? `${item.name} has ${times}: it has no content items yet.`
      : `${item.name} has ${times}: nothing in it can go out then.`;
    href = `${SOCIAL_SCHEDULES_PATH}/${item.id}`;
    action = "Open the schedule";
  }
  const Icon = item.kind === "problem" ? FaTriangleExclamation : FaCircleInfo;
  return (
    <li className="flex items-start gap-3">
      <Icon
        aria-hidden
        className={
          item.kind === "problem"
            ? "mt-1 size-4 shrink-0 text-coquelicot-700"
            : "mt-1 size-4 shrink-0 text-russian-violet"
        }
      />
      <p className="min-w-0 flex-1 text-base text-admin-text">
        {text}{" "}
        <Link href={href} className="font-semibold whitespace-nowrap text-russian-violet">
          {action}
        </Link>
      </p>
    </li>
  );
}
