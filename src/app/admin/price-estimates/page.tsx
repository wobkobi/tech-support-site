// src/app/admin/price-estimates/page.tsx
import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { prisma } from "@/shared/lib/prisma";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";

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
 * @param root0.searchParams - URL search parameters (carries the admin token).
 * @returns Price estimates admin page element.
 */
export default async function AdminPriceEstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; showDev?: string }>;
}): Promise<React.ReactElement> {
  const { token, showDev } = await searchParams;
  const t = requireAdminToken(token);
  const includeDev = showDev === "1";

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // By default the admin page hides rows logged from `npm run dev` so my own
  // test submissions don't pollute the audit view. The ?showDev=1 toggle in
  // the header flips this for when I do want to inspect them.
  const envFilter = includeDev ? {} : { environment: "production" };

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
      : prisma.priceEstimateLog.count({ where: { environment: { not: "production" } } }),
  ]);

  const stats = [
    { label: "Today", value: todayCount },
    { label: "Last 7 days", value: weekCount },
    { label: "Last 30 days", value: monthCount },
  ];

  const toggleHref = includeDev
    ? `/admin/price-estimates?token=${encodeURIComponent(t)}`
    : `/admin/price-estimates?token=${encodeURIComponent(t)}&showDev=1`;

  return (
    <AdminPageLayout token={t} current="price-estimates">
      <div className={cn("mb-6 flex flex-wrap items-center justify-between gap-4")}>
        <div>
          <h1 className={cn("text-russian-violet text-2xl font-extrabold")}>Price estimates</h1>
          <p className={cn("mt-1 text-sm text-slate-500")}>
            Read-only audit log of public pricing wizard submissions. Rows are deleted after 30
            days.
            {includeDev ? " Showing dev submissions too." : ""}
          </p>
        </div>
        <div className={cn("flex flex-wrap items-center gap-2")}>
          {stats.map((s) => (
            <span
              key={s.label}
              className={cn(
                "rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700",
              )}
            >
              <span className={cn("text-russian-violet")}>{s.value}</span> {s.label}
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

      <div className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6")}>
        {logs.length === 0 ? (
          <p className={cn("py-8 text-center text-sm text-slate-400")}>
            No price estimates logged yet.
          </p>
        ) : (
          <ul className={cn("divide-y divide-slate-100")}>
            {logs.map((log) => (
              <li key={log.id} className={cn("py-4")}>
                <div className={cn("mb-2 flex flex-wrap items-baseline justify-between gap-2")}>
                  <p className={cn("flex items-center gap-2 text-xs text-slate-400")}>
                    {formatDateTimeShort(log.createdAt.toISOString())}
                    {log.environment !== "production" && (
                      <span
                        className={cn(
                          "border-coquelicot/40 bg-coquelicot/10 text-coquelicot-500 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        )}
                      >
                        {log.environment}
                      </span>
                    )}
                  </p>
                  <div className={cn("flex flex-wrap items-center gap-2 text-xs")}>
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
                    <span className={cn("text-slate-500")}>
                      {formatMins(log.aiEstimatedMins)} at ${log.hourlyRate.toFixed(0)}/h
                    </span>
                    <span className={cn("text-russian-violet font-bold")}>
                      ${log.priceLow} - ${log.priceHigh}
                    </span>
                  </div>
                </div>

                <p className={cn("mb-2 whitespace-pre-wrap text-sm text-slate-700")}>
                  {log.description}
                </p>

                {log.aiExplanation && (
                  <p className={cn("mb-2 text-xs italic text-slate-500")}>
                    AI: {log.aiExplanation}
                  </p>
                )}

                {log.aiTasks.length > 0 && (
                  <div className={cn("mb-2 flex flex-wrap gap-1.5")}>
                    {log.aiTasks.map((task, i) => (
                      <span
                        key={`${log.id}-task-${i}`}
                        className={cn("rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600")}
                      >
                        {task.label}: {formatMins(task.mins)}
                      </span>
                    ))}
                  </div>
                )}

                <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400")}>
                  {log.address && (
                    <span>
                      <span className={cn("font-medium text-slate-500")}>Address:</span>{" "}
                      {log.address}
                      {log.travelMins != null && log.travelMins > 0
                        ? ` (${formatMins(log.travelMins)} drive)`
                        : ""}
                    </span>
                  )}
                  {log.promoLabel && (
                    <span>
                      <span className={cn("font-medium text-slate-500")}>Promo:</span>{" "}
                      {log.promoLabel}
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
