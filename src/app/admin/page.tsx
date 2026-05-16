// src/app/admin/page.tsx
import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { prisma } from "@/shared/lib/prisma";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { DashboardQuickActions } from "@/features/admin/components/DashboardQuickActions";
import { toE164NZ } from "@/shared/lib/normalize-phone";
import { cn } from "@/shared/lib/cn";
import { formatDateShort, formatDateTimeShort } from "@/shared/lib/date-format";
import { formatNZD } from "@/features/business/lib/business";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin dashboard page showing stat cards and live data panels.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search parameters (contains token).
 * @returns Dashboard page element.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    pendingCount,
    approvedCount,
    heldCount,
    confirmedCount,
    contactCount,
    unsyncedCount,
    upcomingBookings,
    pendingReviews,
    recentContacts,
    pastConfirmedBookings,
    allReviewRequests,
    allContacts,
    bookingsWithReviewSent,
    todaysBookings,
    monthIncome,
    outstandingInvoices,
    recentInvoices,
    latestCacheEntry,
  ] = await Promise.all([
    prisma.review.count({ where: { status: "pending" } }),
    prisma.review.count({ where: { status: "approved" } }),
    prisma.booking.count({ where: { status: "held" } }),
    prisma.booking.count({ where: { status: "confirmed" } }),
    prisma.contact.count(),
    prisma.contact.count({ where: { googleContactId: null } }),
    prisma.booking.findMany({
      where: { status: "confirmed", startAt: { gte: now } },
      orderBy: { startAt: "asc" },
      take: 6,
      select: { id: true, name: true, email: true, phone: true, startAt: true, endAt: true },
    }),
    prisma.review.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        text: true,
        firstName: true,
        lastName: true,
        isAnonymous: true,
        createdAt: true,
      },
    }),
    prisma.contact.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    }),
    prisma.booking.findMany({
      where: { status: "confirmed", startAt: { lt: now } },
      orderBy: { startAt: "desc" },
      take: 10,
      select: { id: true, name: true, email: true, startAt: true, reviewSentAt: true },
    }),
    prisma.reviewRequest.findMany({
      select: { email: true, phone: true },
    }),
    prisma.contact.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, phone: true, address: true },
    }),
    prisma.booking.findMany({
      where: { reviewSentAt: { not: null } },
      select: { email: true, phone: true },
    }),
    // Today's confirmed bookings - drives the "today snapshot" bar.
    prisma.booking.findMany({
      where: { status: "confirmed", startAt: { gte: todayStart, lt: todayEnd } },
      orderBy: { startAt: "asc" },
      select: { id: true, name: true, startAt: true, endAt: true },
    }),
    // This-month income (server-side sum).
    prisma.incomeEntry.aggregate({
      where: { date: { gte: monthStart } },
      _sum: { amount: true },
    }),
    // Outstanding (DRAFT or SENT). Overdue flagged separately on the card.
    prisma.invoice.findMany({
      where: { status: { in: ["DRAFT", "SENT"] } },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        number: true,
        total: true,
        dueDate: true,
        status: true,
        clientName: true,
      },
    }),
    // Recent invoices (any status) - feeds the activity timeline.
    prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        number: true,
        clientName: true,
        total: true,
        status: true,
        createdAt: true,
      },
    }),
    // Newest cache row -> calendar freshness for system status.
    prisma.calendarEventCache.findFirst({
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    }),
  ]);

  const sentEmails = new Set<string>([
    ...allReviewRequests.flatMap((r) => (r.email ? [r.email.toLowerCase()] : [])),
    ...bookingsWithReviewSent.flatMap((b) => (b.email ? [b.email.toLowerCase()] : [])),
  ]);
  const sentPhones = new Set<string>([
    ...allReviewRequests.flatMap((r) => (r.phone ? [toE164NZ(r.phone)] : [])),
    ...bookingsWithReviewSent.flatMap((b) => (b.phone ? [toE164NZ(b.phone)] : [])),
  ]);
  const contactsWithoutReviewLinks = allContacts.filter((c) => {
    if (c.email && sentEmails.has(c.email.toLowerCase())) return false;
    if (c.phone && sentPhones.has(toE164NZ(c.phone))) return false;
    return true;
  });

  // --- Derived KPIs for the new dashboard sections ---
  const monthRevenue = monthIncome._sum.amount ?? 0;
  const outstandingTotal = outstandingInvoices.reduce((s, inv) => s + inv.total, 0);
  const overdueInvoices = outstandingInvoices.filter(
    (inv) => inv.status === "SENT" && inv.dueDate < now,
  );

  // --- Unified activity feed: merge recent events across tables and sort by time ---
  type ActivityKind = "booking" | "review" | "contact" | "invoice";
  interface ActivityEvent {
    kind: ActivityKind;
    timestamp: Date;
    title: string;
    detail: string;
  }
  const activity: ActivityEvent[] = [
    ...upcomingBookings.map((b) => ({
      kind: "booking" as const,
      timestamp: b.startAt,
      title: `Booking: ${b.name}`,
      detail: `${formatDateTimeShort(b.startAt.toISOString())}`,
    })),
    ...pendingReviews.map((r) => ({
      kind: "review" as const,
      timestamp: r.createdAt,
      title: `Review pending`,
      detail: r.text.length > 60 ? r.text.slice(0, 60) + "..." : r.text,
    })),
    ...recentContacts.map((c) => ({
      kind: "contact" as const,
      timestamp: c.createdAt,
      title: `New contact: ${c.name}`,
      detail: c.email ?? c.phone ?? "no contact info",
    })),
    ...recentInvoices.map((inv) => ({
      kind: "invoice" as const,
      timestamp: inv.createdAt,
      title: `Invoice ${inv.number}: ${inv.clientName}`,
      detail: `${inv.status} - ${inv.total < 0 ? "-" : ""}$${Math.abs(inv.total).toFixed(2)}`,
    })),
  ]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 10);

  // --- System status freshness ---
  // Use the `now` captured at the top of this request to keep render pure.
  const calendarLastRefreshMs = latestCacheEntry?.fetchedAt
    ? now.getTime() - latestCacheEntry.fetchedAt.getTime()
    : null;

  const stats = [
    {
      label: "Revenue this month",
      value: formatNZD(monthRevenue),
      href: `/admin/business?token=${encodeURIComponent(t)}`,
      urgent: false,
    },
    {
      label: "Outstanding",
      value: formatNZD(outstandingTotal),
      sub: `${outstandingInvoices.length} invoice${outstandingInvoices.length === 1 ? "" : "s"}${overdueInvoices.length > 0 ? `, ${overdueInvoices.length} overdue` : ""}`,
      href: `/admin/business/invoices?token=${encodeURIComponent(t)}`,
      urgent: overdueInvoices.length > 0,
    },
    {
      label: "Pending reviews",
      value: pendingCount,
      href: `/admin/reviews?token=${encodeURIComponent(t)}`,
      urgent: pendingCount > 0,
    },
    {
      label: "Approved reviews",
      value: approvedCount,
      href: `/admin/reviews?token=${encodeURIComponent(t)}`,
      urgent: false,
    },
    {
      label: "Confirmed bookings",
      value: confirmedCount,
      href: `/admin/bookings?token=${encodeURIComponent(t)}`,
      urgent: false,
    },
    {
      label: "Held bookings",
      value: heldCount,
      href: `/admin/bookings?token=${encodeURIComponent(t)}`,
      urgent: heldCount > 0,
    },
    {
      label: "Total contacts",
      value: contactCount,
      href: `/admin/contacts?token=${encodeURIComponent(t)}`,
      urgent: false,
    },
    {
      label: "Unsynced",
      value: unsyncedCount,
      href: `/admin/contacts?token=${encodeURIComponent(t)}`,
      urgent: unsyncedCount > 0,
    },
  ] as { label: string; value: number | string; sub?: string; href: string; urgent: boolean }[];

  return (
    <AdminPageLayout token={t} current="dashboard">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Dashboard</h1>

      {/* Today's snapshot - pinned at the top so the morning glance is instant. */}
      <div
        className={cn(
          "border-russian-violet/20 from-russian-violet/5 bg-linear-to-r mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border to-white px-5 py-4",
        )}
      >
        <p className={cn("text-russian-violet text-sm font-semibold")}>Today</p>
        <p className={cn("text-sm text-slate-700")}>
          <span className={cn("text-russian-violet font-bold")}>{todaysBookings.length}</span>{" "}
          booking{todaysBookings.length === 1 ? "" : "s"}
        </p>
        <p className={cn("text-sm text-slate-700")}>
          <span
            className={cn(
              "font-bold",
              pendingCount > 0 ? "text-coquelicot-400" : "text-russian-violet",
            )}
          >
            {pendingCount}
          </span>{" "}
          review{pendingCount === 1 ? "" : "s"} to approve
        </p>
        {overdueInvoices.length > 0 && (
          <p className={cn("text-sm text-slate-700")}>
            <span className={cn("text-coquelicot-400 font-bold")}>{overdueInvoices.length}</span>{" "}
            overdue invoice{overdueInvoices.length === 1 ? "" : "s"}
          </p>
        )}
        {heldCount > 0 && (
          <p className={cn("text-sm text-slate-700")}>
            <span className={cn("text-coquelicot-400 font-bold")}>{heldCount}</span> held booking
            {heldCount === 1 ? "" : "s"} to action
          </p>
        )}
      </div>

      <DashboardQuickActions
        token={t}
        pastConfirmedBookings={pastConfirmedBookings.map((b) => ({
          id: b.id,
          name: b.name,
          email: b.email,
          startAt: b.startAt.toISOString(),
          reviewSentAt: b.reviewSentAt ? b.reviewSentAt.toISOString() : null,
        }))}
        contactSuggestions={contactsWithoutReviewLinks}
      />

      <div className={cn("mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4")}>
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className={cn(
              "group rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-shadow hover:shadow-md",
            )}
          >
            <p
              className={cn(
                "font-extrabold",
                typeof s.value === "string" ? "text-xl" : "text-2xl",
                s.urgent ? "text-coquelicot-400" : "text-russian-violet",
              )}
            >
              {s.value}
            </p>
            <p className={cn("mt-0.5 text-xs text-slate-500")}>{s.label}</p>
            {s.sub && <p className={cn("mt-0.5 text-[10px] text-slate-400")}>{s.sub}</p>}
          </Link>
        ))}
      </div>

      <div className={cn("grid grid-cols-1 gap-6 lg:grid-cols-2")}>
        {/* Upcoming bookings */}
        <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm")}>
          <div
            className={cn("flex items-center justify-between border-b border-slate-100 px-5 py-4")}
          >
            <h2 className={cn("text-sm font-semibold text-slate-700")}>Upcoming bookings</h2>
            <Link
              href={`/admin/bookings?token=${encodeURIComponent(t)}`}
              className={cn("hover:text-russian-violet text-xs text-slate-400")}
            >
              View all →
            </Link>
          </div>
          {upcomingBookings.length === 0 ? (
            <p className={cn("px-5 py-6 text-sm text-slate-400")}>
              No upcoming confirmed bookings.
            </p>
          ) : (
            <ul className={cn("divide-y divide-slate-100")}>
              {upcomingBookings.map((b) => (
                <li key={b.id} className={cn("flex items-start justify-between gap-3 px-5 py-3")}>
                  <div className={cn("min-w-0")}>
                    <p className={cn("truncate text-sm font-medium text-slate-700")}>{b.name}</p>
                    <p className={cn("truncate text-xs text-slate-400")}>
                      {b.email}
                      {b.phone ? ` · ${b.phone}` : ""}
                    </p>
                  </div>
                  <p className={cn("shrink-0 text-right text-xs text-slate-500")}>
                    {formatDateTimeShort(b.startAt.toISOString())}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pending reviews */}
        <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm")}>
          <div
            className={cn("flex items-center justify-between border-b border-slate-100 px-5 py-4")}
          >
            <h2 className={cn("text-sm font-semibold text-slate-700")}>
              Pending reviews
              {pendingReviews.length > 0 && (
                <span
                  className={cn(
                    "bg-coquelicot-500/15 text-coquelicot-400 ml-2 rounded-full px-2 py-0.5 text-xs font-semibold",
                  )}
                >
                  {pendingCount}
                </span>
              )}
            </h2>
            <Link
              href={`/admin/reviews?token=${encodeURIComponent(t)}`}
              className={cn("hover:text-russian-violet text-xs text-slate-400")}
            >
              Review all →
            </Link>
          </div>
          {pendingReviews.length === 0 ? (
            <p className={cn("px-5 py-6 text-sm text-slate-400")}>No reviews pending approval.</p>
          ) : (
            <ul className={cn("divide-y divide-slate-100")}>
              {pendingReviews.map((r) => {
                const name = r.isAnonymous
                  ? "Anonymous"
                  : [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown";
                return (
                  <li key={r.id} className={cn("px-5 py-3")}>
                    <div className={cn("mb-1 flex items-center justify-between gap-3")}>
                      <p className={cn("text-xs font-medium text-slate-600")}>{name}</p>
                      <p className={cn("shrink-0 text-xs text-slate-400")}>
                        {formatDateShort(r.createdAt.toISOString())}
                      </p>
                    </div>
                    <p className={cn("line-clamp-2 text-xs text-slate-500")}>{r.text}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent activity - unified timeline of bookings, reviews, contacts, invoices. */}
        <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm")}>
          <div
            className={cn("flex items-center justify-between border-b border-slate-100 px-5 py-4")}
          >
            <h2 className={cn("text-sm font-semibold text-slate-700")}>Recent activity</h2>
          </div>
          {activity.length === 0 ? (
            <p className={cn("px-5 py-6 text-sm text-slate-400")}>No activity yet.</p>
          ) : (
            <ul className={cn("divide-y divide-slate-100")}>
              {activity.map((e, i) => (
                <li
                  key={`${e.kind}:${i}:${e.timestamp.getTime()}`}
                  className={cn("flex items-start gap-3 px-5 py-3")}
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      e.kind === "booking" && "bg-moonstone-600/15 text-moonstone-600",
                      e.kind === "review" && "bg-yellow-500/15 text-yellow-600",
                      e.kind === "contact" && "bg-slate-200 text-slate-600",
                      e.kind === "invoice" && "bg-russian-violet/15 text-russian-violet",
                    )}
                    aria-hidden="true"
                  >
                    {e.kind === "booking"
                      ? "B"
                      : e.kind === "review"
                        ? "R"
                        : e.kind === "contact"
                          ? "C"
                          : "I"}
                  </span>
                  <div className={cn("min-w-0 flex-1")}>
                    <p className={cn("truncate text-sm font-medium text-slate-700")}>{e.title}</p>
                    <p className={cn("truncate text-xs text-slate-400")}>{e.detail}</p>
                  </div>
                  <p className={cn("shrink-0 text-xs text-slate-400")}>
                    {formatDateShort(e.timestamp.toISOString())}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* System status - quick view of how fresh the various sync sources are. */}
        <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm")}>
          <div
            className={cn("flex items-center justify-between border-b border-slate-100 px-5 py-4")}
          >
            <h2 className={cn("text-sm font-semibold text-slate-700")}>System status</h2>
            <Link
              href={`/admin/settings?token=${encodeURIComponent(t)}`}
              className={cn("hover:text-russian-violet text-xs text-slate-400")}
            >
              Settings →
            </Link>
          </div>
          <ul className={cn("divide-y divide-slate-100 text-sm")}>
            <li className={cn("flex items-center justify-between px-5 py-3")}>
              <span className={cn("text-slate-600")}>Calendar cache</span>
              <span
                className={cn(
                  "text-xs",
                  calendarLastRefreshMs === null
                    ? "text-coquelicot-400 font-medium"
                    : calendarLastRefreshMs > 30 * 60 * 1000
                      ? "text-yellow-600"
                      : "text-slate-500",
                )}
              >
                {calendarLastRefreshMs === null
                  ? "never refreshed"
                  : `refreshed ${Math.round(calendarLastRefreshMs / 60000)} min ago`}
              </span>
            </li>
            <li className={cn("flex items-center justify-between px-5 py-3")}>
              <span className={cn("text-slate-600")}>Latest invoice</span>
              <span className={cn("text-xs text-slate-500")}>
                {recentInvoices[0]
                  ? `${recentInvoices[0].number} (${formatDateShort(recentInvoices[0].createdAt.toISOString())})`
                  : "none yet"}
              </span>
            </li>
            <li className={cn("flex items-center justify-between px-5 py-3")}>
              <span className={cn("text-slate-600")}>Unsynced contacts</span>
              <span
                className={cn("text-xs", unsyncedCount > 0 ? "text-yellow-600" : "text-slate-500")}
              >
                {unsyncedCount === 0 ? "all synced" : `${unsyncedCount} pending`}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </AdminPageLayout>
  );
}
