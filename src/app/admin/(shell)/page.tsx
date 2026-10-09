// src/app/admin/(shell)/page.tsx
// Admin dashboard. Loads everything through loadDashboardData, then renders the KPI row
// (revenue with a 12-month sparkline, outstanding, bookings today, pending reviews), alerts
// for overdue invoices and held bookings, the work column (next job and upcoming bookings,
// events to complete) beside pending reviews, retainers due and the review-link form, the
// income vs expenses chart, the secondary stats, then recent activity and system status.
// Counts link to the list filtered to what they count (?status=held), and rows to their record.

import { BarChart } from "@/features/admin/components/charts/BarChart";
import { incomeExpenseSeries } from "@/features/admin/components/charts/series";
import { Sparkline } from "@/features/admin/components/charts/Sparkline";
import { CompleteEventsPanel } from "@/features/admin/components/CompleteEventsPanel";
import { DashboardAlerts } from "@/features/admin/components/dashboard/DashboardAlerts";
import { PendingReviewsPanel } from "@/features/admin/components/dashboard/PendingReviewsPanel";
import { RecentActivityPanel } from "@/features/admin/components/dashboard/RecentActivityPanel";
import { RetainersDuePanel } from "@/features/admin/components/dashboard/RetainersDuePanel";
import { SystemStatusPanel } from "@/features/admin/components/dashboard/SystemStatusPanel";
import { UpcomingBookingsPanel } from "@/features/admin/components/dashboard/UpcomingBookingsPanel";
import { Card } from "@/features/admin/components/ui/Card";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { loadDashboardData } from "@/features/admin/lib/dashboard-data";
import { formatNZD } from "@/features/business/lib/business";
import { SendReviewLinkForm } from "@/features/reviews/components/admin/SendReviewLinkForm";
import { requireAdminAuth } from "@/shared/lib/auth";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/** One stat card's content and target. */
interface DashboardStat {
  label: string;
  value: number | string;
  sub?: string;
  href: string;
  urgent: boolean;
  trend?: React.ReactNode;
}

/**
 * Admin dashboard page showing stat cards, alerts, live data panels and the income chart.
 * @returns Dashboard page element.
 */
export default async function AdminPage(): Promise<React.ReactElement> {
  await requireAdminAuth("/admin");

  const data = await loadDashboardData(new Date());
  const {
    todayKey,
    monthRevenue,
    outstandingTotal,
    outstandingInvoices,
    overdueInvoices,
    pendingCount,
    approvedCount,
    confirmedCount,
    heldCount,
    contactCount,
    unsyncedCount,
  } = data;

  // --- KPI row: the money and today's workload ---
  const kpis: DashboardStat[] = [
    {
      label: "Revenue this month",
      value: formatNZD(monthRevenue),
      // Money received: once registered the chart below counts income excl. GST, so say
      // which side this figure is on.
      sub: data.gstRegistered ? "Incl. GST" : undefined,
      href: `/admin/business`,
      urgent: false,
      trend: <Sparkline values={data.revenueTrend} />,
    },
    {
      label: "Outstanding",
      value: formatNZD(outstandingTotal),
      sub: `${outstandingInvoices.length} invoice${outstandingInvoices.length === 1 ? "" : "s"}${overdueInvoices.length > 0 ? `, ${overdueInvoices.length} overdue` : ""}`,
      // Overdue ones are the ones to chase; otherwise the list's own cards split
      // drafts from sent.
      href:
        overdueInvoices.length > 0
          ? `/admin/business/invoices?status=overdue`
          : `/admin/business/invoices`,
      urgent: overdueInvoices.length > 0,
    },
    {
      label: "Bookings today",
      value: data.todaysBookings.length,
      href: `/admin/bookings?from=${todayKey}&to=${todayKey}`,
      urgent: false,
    },
    {
      label: "Pending reviews",
      value: pendingCount,
      href: `/admin/reviews`,
      urgent: pendingCount > 0,
    },
  ];

  // --- Secondary stats: running totals, below the chart ---
  const secondaryStats: DashboardStat[] = [
    {
      label: "Confirmed bookings",
      value: confirmedCount,
      href: `/admin/bookings?status=confirmed`,
      urgent: false,
    },
    {
      label: "Held bookings",
      value: heldCount,
      href: `/admin/bookings?status=held`,
      urgent: heldCount > 0,
    },
    {
      label: "Approved reviews",
      value: approvedCount,
      href: `/admin/reviews`,
      urgent: false,
    },
    {
      label: "Total contacts",
      value: contactCount,
      href: `/admin/contacts`,
      urgent: false,
    },
    {
      label: "Unsynced",
      value: unsyncedCount,
      href: `/admin/contacts?sync=unsynced`,
      urgent: unsyncedCount > 0,
    },
  ];

  return (
    <>
      <PageHeader title="Dashboard" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.value}
            sub={s.sub}
            href={s.href}
            trend={s.trend}
            tone={s.urgent ? "critical" : "violet"}
          />
        ))}
      </div>

      <DashboardAlerts overdueCount={overdueInvoices.length} heldCount={heldCount} />

      {/* What needs doing comes first: the next jobs on the left, anything waiting on a
          decision on the right. Stats and history sit below. */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <UpcomingBookingsPanel
            nextJob={data.nextJob}
            nextJobAddress={data.nextJobAddress}
            laterBookings={data.laterBookings}
          />
          <CompleteEventsPanel
            pastConfirmedBookings={data.pastConfirmedBookings.map((b) => ({
              id: b.id,
              name: b.name,
              email: b.email,
              startAt: b.startAt.toISOString(),
              reviewSentAt: b.reviewSentAt ? b.reviewSentAt.toISOString() : null,
            }))}
          />
        </div>

        <div className="flex flex-col gap-6">
          <PendingReviewsPanel pendingReviews={data.pendingReviews} pendingCount={pendingCount} />
          {/* Hidden entirely until at least one retainer client exists. */}
          {data.retainerContacts.length > 0 && (
            <RetainersDuePanel retainersDue={data.retainersDue} />
          )}
          <Card>
            <h2 className="mb-4 text-base font-extrabold text-admin-text">Send review link</h2>
            <SendReviewLinkForm contactSuggestions={data.contactsWithoutReviewLinks} defaultOpen />
          </Card>
        </div>
      </div>

      <BarChart
        title="Income vs expenses"
        description="Last 12 months"
        series={incomeExpenseSeries(data.gstRegistered)}
        groups={data.incomeExpenseGroups}
        groupHeading="Month"
        differenceLabel="Profit"
        emptyText="No income or expenses recorded in the last 12 months."
        className="mb-8"
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {secondaryStats.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.value}
            href={s.href}
            tone={s.urgent ? "critical" : "violet"}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentActivityPanel activity={data.activity} />
        <SystemStatusPanel
          calendarLastRefreshMs={data.calendarLastRefreshMs}
          latestInvoice={data.recentInvoices[0]}
          unsyncedCount={unsyncedCount}
        />
      </div>
    </>
  );
}
