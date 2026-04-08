// src/app/admin/page.tsx
import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";
import { AdminSidebar } from "@/features/admin/components/AdminSidebar";
import { DashboardQuickActions } from "@/features/admin/components/DashboardQuickActions";
import { toE164NZ } from "@/shared/lib/normalize-phone";
import { cn } from "@/shared/lib/cn";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * Formats a UTC ISO string as a short NZ local date + time.
 * @param iso - ISO 8601 date string.
 * @returns Formatted date-time string in NZ locale.
 */
function formatNZDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/**
 * Formats a UTC ISO string as a short NZ local date.
 * @param iso - ISO 8601 date string.
 * @returns Formatted date string in NZ locale.
 */
function formatNZDate(iso: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

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

  if (!isValidAdminToken(token ?? null)) {
    console.warn("[admin] Invalid token attempt", { tokenPresent: Boolean(token) });
    notFound();
  }

  const t = token!;
  const now = new Date();

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
      select: { id: true, name: true, email: true, phone: true },
    }),
    // Bookings that already had a review email sent (via the booking flow, not ReviewRequest)
    prisma.booking.findMany({
      where: { reviewSentAt: { not: null } },
      select: { email: true, phone: true },
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

  const stats = [
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
  ];

  return (
    <div className={cn("flex min-h-screen")}>
      <AdminSidebar token={t} current="dashboard" />

      <div className={cn("ml-56 flex-1 bg-slate-50")}>
        <div className={cn("mx-auto max-w-7xl px-6 py-8")}>
          <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Dashboard</h1>

          {/* Quick actions */}
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

          {/* Stat row */}
          <div className={cn("mb-8 grid grid-cols-3 gap-3 sm:grid-cols-6")}>
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
                    "text-2xl font-extrabold",
                    s.urgent ? "text-coquelicot-400" : "text-russian-violet",
                  )}
                >
                  {s.value}
                </p>
                <p className={cn("mt-0.5 text-xs text-slate-500")}>{s.label}</p>
              </Link>
            ))}
          </div>

          <div className={cn("grid grid-cols-1 gap-6 lg:grid-cols-2")}>
            {/* Upcoming bookings */}
            <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm")}>
              <div
                className={cn(
                  "flex items-center justify-between border-b border-slate-100 px-5 py-4",
                )}
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
                    <li
                      key={b.id}
                      className={cn("flex items-start justify-between gap-3 px-5 py-3")}
                    >
                      <div className={cn("min-w-0")}>
                        <p className={cn("truncate text-sm font-medium text-slate-700")}>
                          {b.name}
                        </p>
                        <p className={cn("truncate text-xs text-slate-400")}>
                          {b.email}
                          {b.phone ? ` · ${b.phone}` : ""}
                        </p>
                      </div>
                      <p className={cn("shrink-0 text-right text-xs text-slate-500")}>
                        {formatNZDateTime(b.startAt.toISOString())}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Pending reviews */}
            <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm")}>
              <div
                className={cn(
                  "flex items-center justify-between border-b border-slate-100 px-5 py-4",
                )}
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
                <p className={cn("px-5 py-6 text-sm text-slate-400")}>
                  No reviews pending approval.
                </p>
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
                            {formatNZDate(r.createdAt.toISOString())}
                          </p>
                        </div>
                        <p className={cn("line-clamp-2 text-xs text-slate-500")}>{r.text}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Recent contacts */}
            <div
              className={cn("rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-2")}
            >
              <div
                className={cn(
                  "flex items-center justify-between border-b border-slate-100 px-5 py-4",
                )}
              >
                <h2 className={cn("text-sm font-semibold text-slate-700")}>Recent contacts</h2>
                <Link
                  href={`/admin/contacts?token=${encodeURIComponent(t)}`}
                  className={cn("hover:text-russian-violet text-xs text-slate-400")}
                >
                  View all →
                </Link>
              </div>
              {recentContacts.length === 0 ? (
                <p className={cn("px-5 py-6 text-sm text-slate-400")}>No contacts yet.</p>
              ) : (
                <ul className={cn("divide-y divide-slate-100")}>
                  {recentContacts.map((c) => (
                    <li
                      key={c.id}
                      className={cn("flex items-center justify-between gap-4 px-5 py-3")}
                    >
                      <div className={cn("min-w-0 flex-1")}>
                        <p className={cn("truncate text-sm font-medium text-slate-700")}>
                          {c.name}
                        </p>
                        <p className={cn("truncate text-xs text-slate-400")}>
                          {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact info"}
                        </p>
                      </div>
                      <p className={cn("shrink-0 text-xs text-slate-400")}>
                        {formatNZDate(c.createdAt.toISOString())}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
