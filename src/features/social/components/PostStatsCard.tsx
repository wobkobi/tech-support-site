"use client";
// src/features/social/components/PostStatsCard.tsx
// A published post's Stats card: each app's latest figures, how its views grew over the set
// ages, why any are missing, when they were read, and Refresh to read them now.

import { formatCount } from "@/features/admin/components/charts/chart-scale";
import { Sparkline } from "@/features/admin/components/charts/Sparkline";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { useToast } from "@/features/admin/components/ui/Toast";
import { timeAgo } from "@/features/business/lib/calculator-draft";
import { callApi } from "@/features/mailing/lib/api-client";
import { AppIcons } from "@/features/social/components/AppIcons";
import type { PostStatsView } from "@/features/social/lib/insights/analytics.server";
import {
  AGE_LABEL,
  engagementRate,
  FIGURE_KEYS,
  FIGURE_LABEL,
} from "@/features/social/lib/insights/metrics";
import { SOCIAL_ANALYTICS_PATH } from "@/features/social/lib/links";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { FaArrowsRotate } from "react-icons/fa6";

/**
 * The Stats card.
 * @param props - Component props.
 * @param props.postId - The post.
 * @param props.stats - Its figures.
 * @returns The card.
 */
export function PostStatsCard({
  postId,
  stats,
}: {
  postId: string;
  stats: PostStatsView;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  /** Reads this post's figures now, then reloads them. */
  async function refresh(): Promise<void> {
    setRefreshing(true);
    const res = await callApi("/api/admin/social/insights/refresh", "POST", { postId });
    setRefreshing(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    router.refresh();
  }

  const synced = stats.apps
    .map((a) => a.syncedAt)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1);
  const loaded = Date.parse(stats.loadedAt);

  return (
    <Card>
      <CardHeader
        title="Stats"
        description={
          refreshing
            ? "Reading the figures..."
            : synced
              ? `Updated ${timeAgo(Date.parse(synced), loaded)}`
              : stats.apps.length > 0
                ? "Figures are read an hour after a post goes out, then at 1, 3, 7 and 28 days."
                : undefined
        }
        actions={
          stats.apps.length > 0 ? (
            <AdminButton variant="outline" onClick={() => void refresh()} disabled={refreshing}>
              <FaArrowsRotate
                aria-hidden
                className={refreshing ? "size-3.5 animate-spin" : "size-3.5"}
              />{" "}
              Refresh
            </AdminButton>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-5">
        {stats.apps.map((app) => {
          const given = FIGURE_KEYS.filter((k) => app.figures[k] !== null);
          const rate = engagementRate(app.figures);
          const views = app.readings.filter((r) => r.views !== null);
          return (
            <section key={app.platform} aria-label={PLATFORM_LABEL[app.platform]}>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="flex items-center gap-2 text-base font-semibold text-admin-text">
                  <AppIcons platforms={[app.platform]} />
                  {PLATFORM_LABEL[app.platform]}
                </h3>
                {app.link && (
                  <a
                    href={app.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-russian-violet hover:underline"
                  >
                    Open on {PLATFORM_LABEL[app.platform]}
                  </a>
                )}
              </div>
              {given.length === 0 ? (
                <p className="text-base text-admin-muted">
                  {app.syncedAt ? "No figures came back yet." : "Not read yet."}
                </p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                  {given.map((key) => (
                    <div key={key}>
                      <dt className="text-sm text-admin-text-secondary">{FIGURE_LABEL[key]}</dt>
                      <dd className="text-lg font-bold text-admin-text tabular-nums">
                        {formatCount(app.figures[key]!)}
                      </dd>
                    </div>
                  ))}
                  {rate !== null && (
                    <div>
                      <dt className="text-sm text-admin-text-secondary">Engagement rate</dt>
                      <dd className="text-lg font-bold text-admin-text tabular-nums">
                        {(rate * 100).toFixed(1)}%
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {views.length >= 2 && (
                <div className="mt-3 max-w-md">
                  <Sparkline values={views.map((r) => r.views!)} />
                  <p className="mt-1 text-sm text-admin-text-secondary">
                    Views at{" "}
                    {views
                      .map(
                        (r) =>
                          `${AGE_LABEL[r.ageHours] ?? `${r.ageHours} hours`}: ${formatCount(r.views!)}`,
                      )
                      .join(", ")}
                  </p>
                </div>
              )}
              {app.note && <p className="mt-2 text-sm text-admin-text-secondary">{app.note}</p>}
            </section>
          );
        })}
        {stats.without.map((w) => (
          <p key={w.platform} className="text-base text-admin-text-secondary">
            <span className="font-semibold text-admin-text">{PLATFORM_LABEL[w.platform]}:</span>{" "}
            {w.reason}
          </p>
        ))}
        <p className="text-sm">
          <Link
            href={SOCIAL_ANALYTICS_PATH}
            className="font-semibold text-russian-violet hover:underline"
          >
            See every post in Analytics
          </Link>
        </p>
      </div>
    </Card>
  );
}
