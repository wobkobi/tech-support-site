// src/app/admin/page.tsx
/**
 * @description Admin dashboard. Runs a batch of parallel Prisma queries for
 * booking, review, contact, invoice, and income stats, then renders stat cards,
 * {@link DashboardQuickActions}, and live data panels (upcoming bookings,
 * pending reviews, recent contacts, outstanding invoices).
 */
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { DashboardQuickActions } from "@/features/admin/components/DashboardQuickActions";
import { formatNZD } from "@/features/business/lib/business";
import { requireAdminAuth } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import { formatDateShort, formatDateTimeShort } from "@/shared/lib/date-format";
import { toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";
import { FaCaretRight } from "react-icons/fa6";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin dashboard page showing stat cards and live data panels.
 * @returns Dashboard page element.
 */
export default async function AdminPage(): Promise<React.ReactElement> {
  await requireAdminAuth("/admin");

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // --- Parallel dashboard queries ---
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
    contactsWithReviewSent,
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
    prisma.contact.count({ where: { deletedAt: null } }),
    // MongoDB gotcha: contacts created before googleContactId existed in the
    // schema have no field at all, so `null` alone misses them. `isSet: false`
    // covers that case so the unsynced count is accurate.
    prisma.contact.count({
      where: {
        OR: [{ googleContactId: null }, { googleContactId: { isSet: false } }],
        deletedAt: null,
      },
    }),
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
      where: { deletedAt: null },
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
    prisma.contact.findMany({
      where: { reviewLinkSentAt: { not: null }, deletedAt: null },
      select: { email: true, phone: true },
    }),
    prisma.contact.findMany({
      where: { deletedAt: null },
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
    // Newest cache row > calendar freshness for system status.
    prisma.calendarEventCache.findFirst({
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    }),
  ]);

  // --- Review-link coverage ---
  const sentEmails = new Set<string>([
    ...contactsWithReviewSent.flatMap((c) => (c.email ? [c.email.toLowerCase()] : [])),
    ...bookingsWithReviewSent.flatMap((b) => (b.email ? [b.email.toLowerCase()] : [])),
  ]);
  const sentPhones = new Set<string>([
    ...contactsWithReviewSent.flatMap((c) => (c.phone ? [toE164NZ(c.phone)] : [])),
    ...bookingsWithReviewSent.flatMap((b) => (b.phone ? [toE164NZ(b.phone)] : [])),
  ]);
  const contactsWithoutReviewLinks = allContacts.filter((c) => {
    if (c.email && sentEmails.has(c.email.toLowerCase())) return false;
    if (c.phone && sentPhones.has(toE164NZ(c.phone))) return false;
    return true;
  });

  // --- Derived KPIs for the dashboard sections ---
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

  // --- Stat cards ---
  const stats = [
    {
      label: "Revenue this month",
      value: formatNZD(monthRevenue),
      href: `/admin/business`,
      urgent: false,
    },
    {
      label: "Outstanding",
      value: formatNZD(outstandingTotal),
      sub: `${outstandingInvoices.length} invoice${outstandingInvoices.length === 1 ? "" : "s"}${overdueInvoices.length > 0 ? `, ${overdueInvoices.length} overdue` : ""}`,
      href: `/admin/business/invoices`,
      urgent: overdueInvoices.length > 0,
    },
    {
      label: "Pending reviews",
      value: pendingCount,
      href: `/admin/reviews`,
      urgent: pendingCount > 0,
    },
    {
      label: "Approved reviews",
      value: approvedCount,
      href: `/admin/reviews`,
      urgent: false,
    },
    {
      label: "Confirmed bookings",
      value: confirmedCount,
      href: `/admin/bookings`,
      urgent: false,
    },
    {
      label: "Held bookings",
      value: heldCount,
      href: `/admin/bookings`,
      urgent: heldCount > 0,
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
      href: `/admin/contacts`,
      urgent: unsyncedCount > 0,
    },
  ] as { label: string; value: number | string; sub?: string; href: string; urgent: boolean }[];

  return (
    <AdminPageLayout current="dashboard">
      <h1 className="mb-6 text-2xl font-extrabold text-russian-violet">Dashboard</h1>

      {/* Today's snapshot - pinned at the top so the morning glance is instant. */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-russian-violet/20 bg-linear-to-r from-russian-violet/5 to-white px-5 py-4">
        <p className="text-sm font-semibold text-russian-violet">Today</p>
        <p className="text-sm text-slate-700">
          <span className="font-bold text-russian-violet">{todaysBookings.length}</span> booking
          {todaysBookings.length === 1 ? "" : "s"}
        </p>
        <p className="text-sm text-slate-700">
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
          <p className="text-sm text-slate-700">
            <span className="font-bold text-coquelicot-400">{overdueInvoices.length}</span> overdue
            invoice{overdueInvoices.length === 1 ? "" : "s"}
          </p>
        )}
        {heldCount > 0 && (
          <p className="text-sm text-slate-700">
            <span className="font-bold text-coquelicot-400">{heldCount}</span> held booking
            {heldCount === 1 ? "" : "s"} to action
          </p>
        )}
      </div>

      <DashboardQuickActions
        pastConfirmedBookings={pastConfirmedBookings.map((b) => ({
          id: b.id,
          name: b.name,
          email: b.email,
          startAt: b.startAt.toISOString(),
          reviewSentAt: b.reviewSentAt ? b.reviewSentAt.toISOString() : null,
        }))}
        contactSuggestions={contactsWithoutReviewLinks}
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="group rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-shadow hover:shadow-md"
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
            <p className="mt-0.5 text-xs text-slate-500">{s.label}</p>
            {s.sub && <p className="mt-0.5 text-[11px] text-slate-400">{s.sub}</p>}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upcoming bookings */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-700">Upcoming bookings</h2>
            <Link
              href={`/admin/bookings`}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-russian-violet"
            >
              View all
              <FaCaretRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
          {upcomingBookings.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">No upcoming confirmed bookings.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcomingBookings.map((b) => (
                <li key={b.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">{b.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {b.email}
                      {b.phone ? ` · ${b.phone}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-xs text-slate-500">
                    {formatDateTimeShort(b.startAt.toISOString())}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pending reviews */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-700">
              Pending reviews
              {pendingReviews.length > 0 && (
                <span className="ml-2 rounded-full bg-coquelicot-500/15 px-2 py-0.5 text-xs font-semibold text-coquelicot-400">
                  {pendingCount}
                </span>
              )}
            </h2>
            <Link
              href={`/admin/reviews`}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-russian-violet"
            >
              Review all
              <FaCaretRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
          {pendingReviews.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">No reviews pending approval.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pendingReviews.map((r) => {
                const name = r.isAnonymous
                  ? "Anonymous"
                  : [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown";
                return (
                  <li key={r.id} className="px-5 py-3">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-slate-600">{name}</p>
                      <p className="shrink-0 text-xs text-slate-400">
                        {formatDateShort(r.createdAt.toISOString())}
                      </p>
                    </div>
                    <p className="line-clamp-2 text-xs text-slate-500">{r.text}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent activity - unified timeline of bookings, reviews, contacts, invoices. */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-700">Recent activity</h2>
          </div>
          {activity.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((e, i) => (
                <li
                  key={`${e.kind}:${i}:${e.timestamp.getTime()}`}
                  className="flex items-start gap-3 px-5 py-3"
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
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">{e.title}</p>
                    <p className="truncate text-xs text-slate-400">{e.detail}</p>
                  </div>
                  <p className="shrink-0 text-xs text-slate-400">
                    {formatDateShort(e.timestamp.toISOString())}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* System status - quick view of how fresh the various sync sources are. */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-700">System status</h2>
            <Link
              href={`/admin/settings`}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-russian-violet"
            >
              Settings
              <FaCaretRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            <li className="flex items-center justify-between px-5 py-3">
              <span className="text-slate-600">Calendar cache</span>
              <span
                className={cn(
                  "text-xs",
                  calendarLastRefreshMs === null
                    ? "font-medium text-coquelicot-400"
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
            <li className="flex items-center justify-between px-5 py-3">
              <span className="text-slate-600">Latest invoice</span>
              <span className="text-xs text-slate-500">
                {recentInvoices[0]
                  ? `${recentInvoices[0].number} (${formatDateShort(recentInvoices[0].createdAt.toISOString())})`
                  : "none yet"}
              </span>
            </li>
            <li className="flex items-center justify-between px-5 py-3">
              <span className="text-slate-600">Unsynced contacts</span>
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
