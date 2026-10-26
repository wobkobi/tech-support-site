// src/features/admin/lib/dashboard-data.ts
// Admin dashboard data: one batch of parallel Prisma queries plus the derived values.

import "server-only";

import type { BarGroup } from "@/features/admin/components/charts/BarChart";
import { meetingTypeFromNotes } from "@/features/booking/lib/booking";
import { balanceDue, formatNZD } from "@/features/business/lib/business";
import { isInvoiceOverdue, NOT_A_QUOTE_FILTER } from "@/features/business/lib/invoice-status";
import {
  basisExpenseRows,
  basisIncomeRows,
  ledgerMonthGroups,
} from "@/features/business/lib/ledger-chart";
import { bucketByNzMonth, nzMonthOf, nzMonthsEnding } from "@/features/business/lib/monthly";
import { loadGstStatus } from "@/features/business/lib/tax/load";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { nzDateKey, nzDateParts, nzMidnightUtc } from "@/shared/lib/timezone-utils";
import type { Booking, Contact, Invoice, Review } from "@prisma/client";

/** Record kind behind one row of the activity feed. */
export type ActivityKind = "booking" | "review" | "contact" | "invoice";

/** One row of the unified activity feed. */
export interface ActivityEvent {
  kind: ActivityKind;
  timestamp: Date;
  title: string;
  detail: string;
  href: string;
}

/** A confirmed booking from now on, as the upcoming-bookings panel reads it. */
export type UpcomingBooking = Pick<
  Booking,
  "id" | "name" | "email" | "phone" | "startAt" | "endAt" | "address" | "meetingType" | "notes"
>;

/** A pending review, as the pending-reviews panel reads it. */
export type PendingReviewRow = Pick<
  Review,
  "id" | "text" | "firstName" | "lastName" | "isAnonymous" | "createdAt"
>;

/** A past confirmed booking waiting to be completed. */
export type PastConfirmedBooking = Pick<
  Booking,
  "id" | "name" | "email" | "startAt" | "reviewSentAt"
>;

/** A retainer client, as the retainers-due panel reads it. */
export type RetainerContact = Pick<Contact, "id" | "name" | "retainerTier" | "retainerPrice">;

/** An unpaid invoice (DRAFT or SENT, quotes excluded). */
export type OutstandingInvoice = Pick<
  Invoice,
  "id" | "number" | "total" | "alreadyPaid" | "dueDate" | "status" | "clientName"
>;

/** A recently created invoice or quote. */
export type RecentInvoice = Pick<
  Invoice,
  "id" | "number" | "clientName" | "total" | "status" | "isQuote" | "createdAt"
>;

/** A contact never sent a review link, offered as a suggestion in the review-link form. */
export type ReviewLinkCandidate = Pick<Contact, "id" | "name" | "email" | "phone" | "address">;

/** Everything the dashboard page and its sections render. */
export interface DashboardData {
  /** NZ "YYYY-MM-DD" key for today, used by the today-filtered bookings link. */
  todayKey: string;
  pendingCount: number;
  approvedCount: number;
  confirmedCount: number;
  contactCount: number;
  unsyncedCount: number;
  /** Today's confirmed bookings (NZ day). */
  todaysBookings: Pick<Booking, "id" | "name" | "startAt" | "endAt">[];
  /** The soonest upcoming booking, if any. */
  nextJob: UpcomingBooking | undefined;
  /** The upcoming bookings after {@link DashboardData.nextJob}. */
  laterBookings: UpcomingBooking[];
  /** Address for the next job's Maps button; null for remote jobs or no address. */
  nextJobAddress: string | null;

  pendingReviews: PendingReviewRow[];
  pastConfirmedBookings: PastConfirmedBooking[];
  /** Every retainer client; the retainers panel only shows when there is at least one. */
  retainerContacts: RetainerContact[];
  /** Retainer clients with no "retainer" invoice issued this month. */
  retainersDue: RetainerContact[];
  contactsWithoutReviewLinks: ReviewLinkCandidate[];
  outstandingInvoices: OutstandingInvoice[];
  overdueInvoices: OutstandingInvoice[];
  /** Sum of the balance still owed across {@link DashboardData.outstandingInvoices}. */
  outstandingTotal: number;
  /** This NZ month's income total. */
  monthRevenue: number;
  recentInvoices: RecentInvoice[];
  /** Newest ten events across bookings, reviews, contacts and invoices. */
  activity: ActivityEvent[];
  /** Milliseconds since the calendar cache was last refreshed, or null when never. */
  calendarLastRefreshMs: number | null;
  /** Income vs expenses for the last 12 NZ months, oldest first. */
  incomeExpenseGroups: BarGroup[];
  /** Income per month for the sparkline (GST-inclusive, like {@link DashboardData.monthRevenue}). */
  revenueTrend: number[];
  /** GST registered; the chart's series read "(excl. GST)" only when true. */
  gstRegistered: boolean;
}

/**
 * Runs the dashboard's queries and derives every value its sections show.
 * @param now - Request instant; every date bound is built from it.
 * @returns The dashboard data.
 */
export async function loadDashboardData(now: Date): Promise<DashboardData> {
  // Bounds on NZ midnight; Vercel runs in UTC, 12-13h behind.
  const [nzYear, nzMonth, nzDay] = nzDateParts(now);
  const todayStart = nzMidnightUtc(nzYear, nzMonth, nzDay);
  const todayEnd = nzMidnightUtc(nzYear, nzMonth, nzDay + 1);
  const monthStart = nzMidnightUtc(nzYear, nzMonth, 1);
  const monthEnd = nzMidnightUtc(nzYear, nzMonth + 1, 1);
  // The income vs expenses chart covers the 12 NZ months ending with this one.
  const months = nzMonthsEnding(nzMonthOf(now), 12);
  const first = months[0] ?? nzMonthOf(now);
  const chartStart = nzMidnightUtc(first.year, first.month, 1);

  // --- Parallel dashboard queries ---
  const [
    pendingCount,
    approvedCount,
    confirmedCount,
    contactCount,
    unsyncedCount,
    upcomingBookings,
    pendingReviews,
    recentContacts,
    pastConfirmedBookings,
    contactsWithReviewSent,
    unsentContacts,
    bookingsWithReviewSent,
    todaysBookings,
    monthIncome,
    outstandingInvoices,
    recentInvoices,
    latestCacheEntry,
    retainerContacts,
    invoicesWithReviewSent,
    reviewAskOptOuts,
    chartIncome,
    chartExpenses,
    gst,
  ] = await Promise.all([
    prisma.review.count({ where: { status: "pending" } }),
    prisma.review.count({ where: { status: "approved" } }),
    prisma.booking.count({ where: { status: "confirmed" } }),
    prisma.contact.count({ where: { deletedAt: null } }),
    // `isSet: false` catches rows created before the field existed; `null` alone misses them.
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
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        startAt: true,
        endAt: true,
        address: true,
        meetingType: true,
        notes: true,
      },
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
    // Suggestion candidates: contacts never stamped as sent (isSet covers pre-field rows).
    prisma.contact.findMany({
      where: {
        deletedAt: null,
        OR: [{ reviewLinkSentAt: null }, { reviewLinkSentAt: { isSet: false } }],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, phone: true, address: true },
    }),
    prisma.booking.findMany({
      where: { reviewSentAt: { not: null } },
      select: { email: true, phone: true },
    }),
    // Today's confirmed bookings - drives the "Bookings today" card.
    prisma.booking.findMany({
      where: { status: "confirmed", startAt: { gte: todayStart, lt: todayEnd } },
      orderBy: { startAt: "asc" },
      select: { id: true, name: true, startAt: true, endAt: true },
    }),
    // This-month income, bounded at month end so a future-dated entry can't lift the card.
    prisma.incomeEntry.aggregate({
      where: { date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    // Outstanding (DRAFT or SENT), quotes excluded.
    prisma.invoice.findMany({
      where: { status: { in: ["DRAFT", "SENT"] }, ...NOT_A_QUOTE_FILTER },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        number: true,
        total: true,
        alreadyPaid: true,
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
        isQuote: true,
        createdAt: true,
      },
    }),
    // Newest cache row > calendar freshness for system status.
    prisma.calendarEventCache.findFirst({
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    }),
    // Retainer clients; isSet guards pre-field rows.
    prisma.contact.findMany({
      where: { deletedAt: null, retainerTier: { isSet: true, not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, retainerTier: true, retainerPrice: true },
    }),
    // Review asks sent from an invoice (automatic or Send now) count as asked too.
    prisma.invoice.findMany({
      where: { reviewLinkSentAt: { not: null } },
      select: { contactId: true, clientEmail: true },
    }),
    // Anyone who stopped review asks, or unsubscribed from email, isn't suggested.
    Promise.all([
      prisma.reviewAskOptOut.findMany({ select: { email: true, contactId: true } }),
      prisma.emailOptOut.findMany({ select: { email: true, contactId: true } }),
    ]).then(([a, b]) => [...a, ...b]),
    // Chart series: income and expense rows for its 12 months, bucketed per NZ month below.
    prisma.incomeEntry.findMany({
      where: { date: { gte: chartStart } },
      select: { date: true, amount: true },
    }),
    prisma.expenseEntry.findMany({
      where: { date: { gte: chartStart } },
      select: { date: true, amountIncl: true, amountExcl: true },
    }),
    // GST basis for the chart's income and expense series.
    loadGstStatus(),
  ]);

  // --- Retainers due this month ---
  // Invoiced = a "retainer" line on an invoice issued this month. Matched in JS: the Mongo
  // connector can't regex-filter composite lineItems.
  let retainersDue: typeof retainerContacts = [];
  if (retainerContacts.length > 0) {
    const monthInvoices = await prisma.invoice.findMany({
      where: {
        contactId: { in: retainerContacts.map((r) => r.id) },
        issueDate: { gte: monthStart },
        status: { not: "VOIDED" },
        // A QUOTE for a retainer must not count as invoiced.
        ...NOT_A_QUOTE_FILTER,
      },
      select: { contactId: true, lineItems: true },
    });
    const invoicedIds = new Set(
      monthInvoices
        .filter((inv) => inv.lineItems.some((li) => /retainer/i.test(li.description)))
        .map((inv) => inv.contactId),
    );
    retainersDue = retainerContacts.filter((r) => !invoicedIds.has(r.id));
  }

  // --- Review-link coverage ---
  const sentEmails = new Set<string>([
    ...contactsWithReviewSent.flatMap((c) => (c.email ? [c.email.toLowerCase()] : [])),
    ...bookingsWithReviewSent.flatMap((b) => (b.email ? [b.email.toLowerCase()] : [])),
    ...invoicesWithReviewSent.flatMap((i) => (i.clientEmail ? [i.clientEmail.toLowerCase()] : [])),
    ...reviewAskOptOuts.map((o) => o.email.toLowerCase()),
  ]);
  const skipIds = new Set<string>([
    ...invoicesWithReviewSent.flatMap((i) => (i.contactId ? [i.contactId] : [])),
    ...reviewAskOptOuts.flatMap((o) => (o.contactId ? [o.contactId] : [])),
  ]);
  const sentPhones = new Set<string>([
    ...contactsWithReviewSent.flatMap((c) => (c.phone ? [toE164NZ(c.phone)] : [])),
    ...bookingsWithReviewSent.flatMap((b) => (b.phone ? [toE164NZ(b.phone)] : [])),
  ]);
  // An unsent contact sharing an email/phone with any sent record is already covered.
  const contactsWithoutReviewLinks = unsentContacts.filter((c) => {
    if (skipIds.has(c.id)) return false;
    if (c.email && sentEmails.has(c.email.toLowerCase())) return false;
    if (c.phone && sentPhones.has(toE164NZ(c.phone))) return false;
    return true;
  });

  // --- Derived KPIs for the dashboard sections ---
  const monthRevenue = monthIncome._sum.amount ?? 0;
  // Money handed over on the day is already in, so only the balance is outstanding.
  const outstandingTotal = outstandingInvoices.reduce((s, inv) => s + balanceDue(inv), 0);
  // Same rule as the invoice list, so the alert count matches what its link opens.
  const overdueInvoices = outstandingInvoices.filter((inv) => isInvoiceOverdue(inv, now));
  const todayKey = nzDateKey(now);

  // --- Next job ---
  // Remote jobs get no Maps button; an unknown meeting type with an address still does.
  const [nextJob, ...laterBookings] = upcomingBookings;
  const nextJobAddress =
    nextJob && (nextJob.meetingType ?? meetingTypeFromNotes(nextJob.notes)) !== "remote"
      ? nextJob.address || null
      : null;

  // --- Unified activity feed: merge recent events across tables and sort by time ---
  const activity: ActivityEvent[] = [
    ...upcomingBookings.map((b) => ({
      kind: "booking" as const,
      timestamp: b.startAt,
      title: `Booking: ${b.name}`,
      detail: `${formatDateTimeShort(b.startAt.toISOString())}`,
      href: `/admin/bookings/${b.id}`,
    })),
    ...pendingReviews.map((r) => ({
      kind: "review" as const,
      timestamp: r.createdAt,
      title: `Review pending`,
      detail: r.text.length > 60 ? r.text.slice(0, 60) + "..." : r.text,
      href: "/admin/reviews",
    })),
    ...recentContacts.map((c) => ({
      kind: "contact" as const,
      timestamp: c.createdAt,
      title: `New contact: ${c.name}`,
      detail: c.email ?? c.phone ?? "no contact info",
      href: `/admin/contacts/${c.id}`,
    })),
    ...recentInvoices.map((inv) => ({
      kind: "invoice" as const,
      timestamp: inv.createdAt,
      title: `${inv.isQuote ? "Quote" : "Invoice"} ${inv.number}: ${inv.clientName}`,
      detail: `${inv.isQuote ? "Quote" : inv.status.charAt(0) + inv.status.slice(1).toLowerCase()} - ${formatNZD(inv.total)}`,
      href: `/admin/business/invoices/${inv.id}`,
    })),
  ]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 10);

  // --- System status freshness ---
  // Use the `now` passed in for this request to keep render pure.
  const calendarLastRefreshMs = latestCacheEntry?.fetchedAt
    ? now.getTime() - latestCacheEntry.fetchedAt.getTime()
    : null;

  // --- Income vs expenses chart ---
  // Bars on the GST basis; the sparkline stays money received, like its card.
  const incomeExpenseGroups = ledgerMonthGroups(
    { income: basisIncomeRows(chartIncome, gst), expenses: basisExpenseRows(chartExpenses, gst) },
    months,
    now,
  );
  const revenueTrend = bucketByNzMonth(chartIncome, { date: "date", amount: "amount" }, months);

  return {
    todayKey,
    pendingCount,
    approvedCount,
    confirmedCount,
    contactCount,
    unsyncedCount,
    todaysBookings,
    nextJob,
    laterBookings,
    nextJobAddress,

    pendingReviews,
    pastConfirmedBookings,
    retainerContacts,
    retainersDue,
    contactsWithoutReviewLinks,
    outstandingInvoices,
    overdueInvoices,
    outstandingTotal,
    monthRevenue,
    recentInvoices,
    activity,
    calendarLastRefreshMs,
    incomeExpenseGroups,
    revenueTrend,
    gstRegistered: gst.registered,
  };
}
