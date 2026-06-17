// src/app/admin/price-estimates/page.tsx
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { requireAdminAuth } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { AppEnvironment, type Prisma } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Price estimates - Admin",
  robots: { index: false, follow: false },
};

/**
 * Formats a minute count as a compact "Xh Ym" string.
 * @param mins - Minutes (non-negative integer).
 * @returns "45 min" / "1h" / "1h 30m".
 */
function formatMins(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Admin audit page for the public price estimator. Lists the last 500 logs
 * with the raw description, AI interpretation, per-task split, and the price
 * range shown to the user. Cleaned up automatically after 30 days.
 * @param root0 - Page props.
 * @param root0.searchParams - URL params with optional `?showDev=1` to include dev/test entries.
 * @returns Price estimates admin page element.
 */
export default async function AdminPriceEstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ showDev?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth("/admin/price-estimates");
  const { showDev } = await searchParams;
  const includeDev = showDev === "1";

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Hide rows logged from `npm run dev` by default so local test submissions
  // don't pollute the audit view. The ?showDev=1 toggle in the header flips
  // this when inspecting them is wanted.
  const envFilter: Prisma.PriceEstimateLogWhereInput = includeDev
    ? {}
    : { environment: AppEnvironment.production };

  const [logs, todayCount, weekCount, monthCount, devCount] = await Promise.all([
    prisma.priceEstimateLog.findMany({
      where: envFilter,
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.priceEstimateLog.count({ where: { ...envFilter, createdAt: { gte: dayStart } } }),
    prisma.priceEstimateLog.count({ where: { ...envFilter, createdAt: { gte: weekAgo } } }),
    prisma.priceEstimateLog.count({ where: { ...envFilter, createdAt: { gte: monthAgo } } }),
    // Always count hidden dev rows so the toggle can show a hint like "5 dev".
    includeDev
      ? Promise.resolve(0)
      : prisma.priceEstimateLog.count({
          where: { environment: { not: AppEnvironment.production } },
        }),
  ]);

  const stats = [
    { label: "Today", value: todayCount },
    { label: "Last 7 days", value: weekCount },
    { label: "Last 30 days", value: monthCount },
  ];

  const toggleHref = includeDev ? `/admin/price-estimates` : `/admin/price-estimates?showDev=1`;

  return (
    <AdminPageLayout current="price-estimates">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-russian-violet">Price estimates</h1>
          <p className="mt-1 text-sm text-slate-500">
            Read-only audit log of public pricing wizard submissions. Rows are deleted after 30
            days.
            {includeDev ? " Showing dev submissions too." : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stats.map((s) => (
            <span
              key={s.label}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
            >
              <span className="text-russian-violet">{s.value}</span> {s.label}
            </span>
          ))}
          <Link
            href={toggleHref}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              includeDev
                ? "border-coquelicot/40 bg-coquelicot/10 text-coquelicot-500 hover:bg-coquelicot/20"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {includeDev ? "Hide dev" : devCount > 0 ? `Show dev (${devCount})` : "Show dev"}
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {logs.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No price estimates logged yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {logs.map((log) => (
              <li key={log.id} className="py-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="flex items-center gap-2 text-xs text-slate-400">
                    {formatDateTimeShort(log.createdAt.toISOString())}
                    {log.environment !== "production" && (
                      <span className="rounded-md border border-coquelicot/40 bg-coquelicot/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-coquelicot-500 uppercase">
                        {log.environment}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-semibold",
                        log.aiCategory === "complex"
                          ? "bg-coquelicot-500/15 text-coquelicot-400"
                          : "bg-moonstone-600/15 text-moonstone-600",
                      )}
                    >
                      {log.aiCategory}
                    </span>
                    <span className="text-slate-500">
                      {formatMins(log.aiEstimatedMins)} at ${log.hourlyRate.toFixed(0)}/hr
                    </span>
                    <span className="font-bold text-russian-violet">
                      ${log.priceLow} - ${log.priceHigh}
                    </span>
                  </div>
                </div>

                <p className="mb-2 text-sm whitespace-pre-wrap text-slate-700">{log.description}</p>

                {log.aiExplanation && (
                  <p className="mb-2 text-xs text-slate-500 italic">AI: {log.aiExplanation}</p>
                )}

                {log.aiTasks.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {log.aiTasks.map((task, i) => (
                      <span
                        key={`${log.id}-task-${i}`}
                        className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                      >
                        {task.label}: {formatMins(task.mins)}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  {log.address && (
                    <span>
                      <span className="font-medium text-slate-500">Address:</span> {log.address}
                      {log.travelMins != null && log.travelMins > 0
                        ? ` (${formatMins(log.travelMins)} drive)`
                        : ""}
                    </span>
                  )}
                  {log.promoLabel && (
                    <span>
                      <span className="font-medium text-slate-500">Promo:</span> {log.promoLabel}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPageLayout>
  );
}
