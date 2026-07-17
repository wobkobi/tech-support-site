// src/app/admin/(shell)/reviews/page.tsx
/**
 * @description Admin reviews page. Loads reviews plus booking and contact
 * review-link sends (soft-capped at 1000 each), joins them into a unified link
 * history, summarises the pipeline as StatCards, and renders the
 * {@link ReviewApprovalList}, {@link SendReviewLinkForm}, and
 * {@link ReviewLinkHistoryTable}.
 */
import { Card } from "@/features/admin/components/ui/Card";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { ReviewApprovalList } from "@/features/reviews/components/admin/ReviewApprovalList";
import { ReviewLinkHistoryTable } from "@/features/reviews/components/admin/ReviewLinkHistoryTable";
import { SendReviewLinkForm } from "@/features/reviews/components/admin/SendReviewLinkForm";
import { requireAdminAuth } from "@/shared/lib/auth";
import { toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reviews - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin reviews page for approving/revoking reviews and sending review links.
 * @returns Reviews management page element.
 */
export default async function AdminReviewsPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  // Soft caps to prevent unbounded scans as data grows. The page joins these
  // sets to build a unified link history; if the most recent 1000 ever stops
  // being enough, swap in cursor pagination per section.
  const [reviews, sentBookings, sentContacts, allContacts] = await Promise.all([
    prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        text: true,
        firstName: true,
        lastName: true,
        isAnonymous: true,
        status: true,
        customerRef: true,
        bookingId: true,
        contactId: true,
        createdAt: true,
      },
    }),
    prisma.booking.findMany({
      where: { reviewSentAt: { not: null } },
      orderBy: { reviewSentAt: "desc" },
      take: 1000,
      select: {
        id: true,
        name: true,
        email: true,
        reviewSentAt: true,
        reviewSubmittedAt: true,
        reviewToken: true,
      },
    }),
    // Contacts with manual review-link sends. Replaces the ReviewRequest
    // history table - one row per contact (most-recent send), not per send.
    prisma.contact.findMany({
      where: { reviewLinkSentAt: { not: null }, deletedAt: null },
      orderBy: { reviewLinkSentAt: "desc" },
      take: 1000,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        reviewToken: true,
        reviewLinkSentAt: true,
        reviewLinkSentMode: true,
        reviewLinkSubmittedAt: true,
      },
    }),
    prisma.contact.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { id: true, name: true, email: true, phone: true, address: true },
    }),
  ]);

  const contactMap = new Map(allContacts.map((c) => [c.id, c.name]));

  const reviewCountByContact = new Map<string, number>();
  for (const r of reviews) {
    if (r.contactId) {
      reviewCountByContact.set(r.contactId, (reviewCountByContact.get(r.contactId) ?? 0) + 1);
    }
  }

  const reviewRows = reviews.map((r) => ({
    ...r,
    contactId: r.contactId ?? null,
    contactName: r.contactId ? (contactMap.get(r.contactId) ?? null) : null,
  }));

  const pending = reviewRows.filter((r) => r.status !== "approved");
  const approved = reviewRows.filter((r) => r.status === "approved");

  const contacts = allContacts.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    reviewCount: reviewCountByContact.get(c.id) ?? 0,
  }));

  const sentEmails = new Set<string>([
    ...sentContacts.flatMap((c) => (c.email ? [c.email.toLowerCase()] : [])),
    ...sentBookings.flatMap((b) => (b.email ? [b.email.toLowerCase()] : [])),
  ]);
  const sentPhones = new Set<string>(
    sentContacts.flatMap((c) => (c.phone ? [toE164NZ(c.phone)] : [])),
  );
  const contactSuggestions = allContacts
    .filter((c) => {
      if (c.email && sentEmails.has(c.email.toLowerCase())) return false;
      if (c.phone && sentPhones.has(toE164NZ(c.phone))) return false;
      return true;
    })
    .map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.address }));

  const siteUrl = getSiteUrl();

  const knownTokens = new Set<string>([
    ...sentBookings.map((b) => b.reviewToken),
    ...sentContacts.flatMap((c) => (c.reviewToken ? [c.reviewToken] : [])),
  ]);
  const knownBookingIds = new Set(sentBookings.map((b) => b.id));

  const legacyBookingIds = reviews
    .filter((r) => {
      if (r.customerRef && knownTokens.has(r.customerRef)) return false;
      if (r.bookingId && knownBookingIds.has(r.bookingId)) return false;
      return true;
    })
    .map((r) => r.bookingId)
    .filter((id): id is string => !!id && !knownBookingIds.has(id));

  const legacyBookings =
    legacyBookingIds.length > 0
      ? await prisma.booking.findMany({
          where: { id: { in: legacyBookingIds } },
          select: { id: true, reviewToken: true },
        })
      : [];

  const bookingTokenMap = new Map(legacyBookings.map((b) => [b.id, b.reviewToken]));

  const legacyReviews = reviews.filter((r) => {
    if (r.customerRef && knownTokens.has(r.customerRef)) return false;
    if (r.bookingId && knownBookingIds.has(r.bookingId)) return false;
    return true;
  });

  const linkHistory = [
    ...sentBookings.map((b) => ({
      id: null as string | null,
      customerRef: null as string | null,
      reviewId: null as string | null,
      name: b.name,
      email: b.email,
      phone: null as string | null,
      sentAt: b.reviewSentAt!.toISOString(),
      reviewed: !!b.reviewSubmittedAt,
      source: "Auto" as const,
      reviewUrl: `${siteUrl}/review?token=${b.reviewToken}`,
    })),
    ...sentContacts.map((c) => ({
      id: c.id,
      customerRef: c.reviewToken,
      reviewId: null as string | null,
      name: c.name,
      email: c.email,
      phone: c.phone,
      sentAt: c.reviewLinkSentAt!.toISOString(),
      reviewed: !!c.reviewLinkSubmittedAt,
      source: (c.reviewLinkSentMode === "sms" ? "Manual SMS" : "Manual email") as
        "Auto" | "Manual email" | "Manual SMS" | "Legacy",
      reviewUrl: c.reviewToken ? `${siteUrl}/review?token=${c.reviewToken}` : "",
    })),
    ...legacyReviews.map((r) => {
      const tok =
        (r.customerRef || null) ??
        (r.bookingId ? (bookingTokenMap.get(r.bookingId) ?? null) : null);
      return {
        id: null as string | null,
        customerRef: tok,
        reviewId: r.id,
        name: r.isAnonymous
          ? "Anonymous"
          : [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown",
        email: null as string | null,
        phone: null as string | null,
        sentAt: r.createdAt.toISOString(),
        reviewed: true,
        source: "Legacy" as const,
        reviewUrl: tok ? `${siteUrl}/review?token=${tok}` : "",
      };
    }),
  ].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

  // Summary stats. Computed over the same soft-capped sets loaded above, so at
  // 1000+ reviews or sends these describe the most recent 1000 rather than all
  // time - fine at current volume, and the caps move together if that changes.
  // Legacy rows are sends that predate send-tracking (reviewed by definition),
  // so counting them would report a conversion rate that flatters itself.
  const trackedSends = linkHistory.filter((e) => e.source !== "Legacy");
  // setDate over Date.now() arithmetic: react-hooks/purity rejects Date.now()
  // in render and does not except server components, which only render once per
  // request anyway. setDate also rolls months correctly on its own.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sentLast30 = trackedSends.filter((e) => new Date(e.sentAt) >= thirtyDaysAgo);
  const reviewedLast30 = sentLast30.filter((e) => e.reviewed).length;
  const conversion =
    sentLast30.length > 0 ? Math.round((reviewedLast30 / sentLast30.length) * 100) : null;

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Approve what goes public, and ask past clients for one."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Pending"
          value={pending.length}
          sub={pending.length > 0 ? "waiting on you" : "all caught up"}
          tone={pending.length > 0 ? "warning" : "default"}
        />
        <StatCard label="Approved" value={approved.length} sub="live on the site" tone="success" />
        <StatCard label="Links sent" value={sentLast30.length} sub="last 30 days" />
        <StatCard
          label="Turned into reviews"
          value={conversion === null ? "-" : `${conversion}%`}
          sub={
            conversion === null
              ? "no sends in the last 30 days"
              : `${reviewedLast30} of ${sentLast30.length} sent`
          }
          tone={conversion !== null && conversion >= 50 ? "success" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <ReviewApprovalList
              pending={pending}
              approved={approved}
              contacts={contacts}
              showSendForm={false}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-russian-violet">Send a review link</h2>
            <SendReviewLinkForm contactSuggestions={contactSuggestions} />
          </Card>

          {linkHistory.length > 0 && (
            <Card>
              <h2 className="mb-4 text-sm font-semibold text-russian-violet">Link history</h2>
              <ReviewLinkHistoryTable entries={linkHistory} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
