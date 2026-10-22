"use client";
// src/features/social/components/SocialOverview.tsx
// The Social Overview: a warning when the Meta token is close to running out, figures either side
// of now, the set-up list until it's done, what needs attention and new comments beside whether
// each app is connected, the next seven days, views over the last seven, and what each app can do.

import { BarChart } from "@/features/admin/components/charts/BarChart";
import { appSeries } from "@/features/admin/components/charts/series";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { StatStrip } from "@/features/admin/components/ui/StatStrip";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { InboxRow } from "@/features/social/components/InboxRow";
import { OverviewWeek } from "@/features/social/components/OverviewWeek";
import { SocialChecklist } from "@/features/social/components/SocialChecklist";
import { SocialConnections } from "@/features/social/components/SocialConnections";
import {
  APP_PERMISSIONS_ID,
  SocialPermissions,
} from "@/features/social/components/SocialPermissions";
import { shortDay, timeOfDay, type ColourContext } from "@/features/social/lib/calendar";
import { checklistOf, type ChecklistKey } from "@/features/social/lib/checklist";
import type { InboxSummary } from "@/features/social/lib/inbox/inbox-data.server";
import { inboxHref, readInboxQuery } from "@/features/social/lib/inbox/map";
import { dayLabel } from "@/features/social/lib/insights/metrics";
import {
  calendarHref,
  postHref,
  SOCIAL_ANALYTICS_PATH,
  SOCIAL_CONTENT_PATH,
  SOCIAL_INBOX_PATH,
  SOCIAL_POSTS_PATH,
  SOCIAL_SCHEDULES_PATH,
} from "@/features/social/lib/links";
import type { AttentionItem, OverviewData } from "@/features/social/lib/overview-data.server";
import {
  coreReady,
  tokenWarning,
  type Permissions,
  type TokenWarning,
} from "@/features/social/lib/permissions";
import type { Connection } from "@/features/social/lib/post-display";
import type { SocialTagRow } from "@/features/social/lib/tags";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import { Notice } from "@/shared/components/Notice";
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
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [warning, setWarning] = useState<TokenWarning | null>(null);
  const [checking, setChecking] = useState(false);
  const [skipped, setSkipped] = useState<ChecklistKey[]>(data.skipped);
  const [busyKey, setBusyKey] = useState<ChecklistKey | null>(null);

  // The browser asks for the connections and permissions so the page doesn't wait on three apps
  // to answer.
  useEffect(() => {
    let live = true;
    void callApi<{ connections: Connection[] }>("/api/admin/social/connections").then((res) => {
      if (!live) return;
      if (res.ok) setConnections(res.connections);
      else setConnectionsError(res.error);
    });
    void callApi<{ permissions: Permissions }>("/api/admin/social/permissions").then((res) => {
      if (!live) return;
      if (!res.ok) {
        setPermissionsError(res.error);
        return;
      }
      setPermissions(res.permissions);
      setWarning(tokenWarning(res.permissions.token, new Date()));
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
    {
      ...data.facts,
      connected: connections ? connections.filter((c) => c.ok).length : null,
      permissions: coreReady(permissions),
    },
    skipped,
  );

  /** Checks every app's connection and permissions again, skipping the cache. */
  async function checkAgain(): Promise<void> {
    setChecking(true);
    const [res, perms] = await Promise.all([
      callApi<{ connections: Connection[] }>("/api/admin/social/connections?fresh=1"),
      callApi<{ permissions: Permissions }>("/api/admin/social/permissions?fresh=1"),
    ]);
    setChecking(false);
    if (perms.ok) {
      setPermissions(perms.permissions);
      setPermissionsError(null);
      setWarning(tokenWarning(perms.permissions.token, new Date()));
    } else {
      toast(perms.error, { tone: "error" });
    }
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
      {warning && (
        <Notice tone="warn" role="alert" onGrey>
          {warning.text}{" "}
          <a href={`#${APP_PERMISSIONS_ID}`} className="font-semibold text-russian-violet">
            See what each app can do
          </a>
        </Notice>
      )}

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
        <div className="flex min-w-0 flex-col gap-6">
          <NeedsAttention items={data.attention} />
          <NewComments inbox={data.inbox} now={data.now} />
        </div>
        <SocialConnections
          connections={connections}
          error={connectionsError}
          checking={checking}
          onCheck={() => void checkAgain()}
        />
      </div>

      <OverviewWeek today={data.today} entries={data.week} ctx={ctx} />

      <BarChart
        title="Views, last 7 days"
        description={
          <>
            {dayLabel(data.views.from)} to {dayLabel(data.views.to)}.{" "}
            <Link href={SOCIAL_ANALYTICS_PATH} className="font-semibold text-russian-violet">
              See Analytics
            </Link>
          </>
        }
        series={appSeries(data.views.series)}
        groups={data.views.groups}
        groupHeading="Day"
        emptyText="No views read for these days yet. They come in once the stats sync runs."
        format="count"
      />

      <SocialPermissions permissions={permissions} error={permissionsError} />
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
 * New comments card: the unread and waiting counts, the newest unread threads, and which apps'
 * comments aren't coming through.
 * @param props - Component props.
 * @param props.inbox - The inbox summary.
 * @param props.now - When the page loaded, as ISO.
 * @returns Card element.
 */
function NewComments({ inbox, now }: { inbox: InboxSummary; now: string }): React.ReactElement {
  const query = readInboxQuery({});
  const counts = [
    inbox.unread > 0 && `${inbox.unread} unread`,
    inbox.needsReply > 0 && `${inbox.needsReply} waiting for a reply`,
  ].filter((s): s is string => typeof s === "string");
  return (
    <Card>
      <CardHeader
        title="New comments"
        description={counts.length > 0 ? counts.join(", ") : undefined}
        actions={
          <AdminButton href={SOCIAL_INBOX_PATH} variant="outline" size="xs">
            Open the inbox
          </AdminButton>
        }
      />
      {inbox.latest.length === 0 ? (
        <p className="text-base text-admin-muted">
          Nothing new. Comments on your posts and Google reviews show here when they come in.
        </p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-xl border border-admin-border">
          {inbox.latest.map((row) => (
            <InboxRow
              key={row.id}
              row={row}
              href={inboxHref(query, row.id)}
              open={false}
              nowMs={Date.parse(now)}
            />
          ))}
        </ul>
      )}
      {inbox.failing.length > 0 && (
        <p className="mt-3 text-sm text-admin-muted">
          {inbox.failing.map((p) => PLATFORM_LABEL[p]).join(" and ")}{" "}
          {inbox.failing.length === 1 ? "isn't" : "aren't"} being read. The Inbox says why.
        </p>
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
