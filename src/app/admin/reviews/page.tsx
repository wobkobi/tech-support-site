// src/app/admin/reviews/page.tsx
import type { Metadata } from "next";
import type React from "react";
import { prisma } from "@/shared/lib/prisma";
import { requireAdminToken } from "@/shared/lib/auth";
import { toE164NZ } from "@/shared/lib/normalize-phone";
import { cn } from "@/shared/lib/cn";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { ReviewApprovalList } from "@/features/reviews/components/admin/ReviewApprovalList";
import { ReviewLinkHistoryTable } from "@/features/reviews/components/admin/ReviewLinkHistoryTable";
import { SendReviewLinkForm } from "@/features/reviews/components/admin/SendReviewLinkForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reviews - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin reviews page for approving/revoking reviews and sending review links.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search parameters (contains token).
 * @returns Reviews management page element.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

  // Soft caps to prevent unbounded scans as data grows. The page joins these
  // sets to build a unified link history; if the most recent 1000 ever stops
  // being enough, swap in cursor pagination per section.
  const [reviews, sentBookings, sentRequests, allContacts] = await Promise.all([
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
    prisma.reviewRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        reviewSubmittedAt: true,
        reviewToken: true,
      },
    }),
    prisma.contact.findMany({
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
    ...sentRequests.flatMap((r) => (r.email ? [r.email.toLowerCase()] : [])),
    ...sentBookings.flatMap((b) => (b.email ? [b.email.toLowerCase()] : [])),
  ]);
  const sentPhones = new Set<string>(
    sentRequests.flatMap((r) => (r.phone ? [toE164NZ(r.phone)] : [])),
  );
  const contactSuggestions = allContacts
    .filter((c) => {
      if (c.email && sentEmails.has(c.email.toLowerCase())) return false;
      if (c.phone && sentPhones.has(toE164NZ(c.phone))) return false;
      return true;
    })
    .map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.address }));

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz").replace(
    /\/$/,
    "",
  );

  const knownTokens = new Set([
    ...sentBookings.map((b) => b.reviewToken),
    ...sentRequests.map((r) => r.reviewToken),
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
    ...sentRequests.map((r) => ({
      id: r.id,
      customerRef: r.reviewToken,
      reviewId: null as string | null,
      name: r.name,
      email: r.email,
      phone: r.phone,
      sentAt: r.createdAt.toISOString(),
      reviewed: !!r.reviewSubmittedAt,
      source: (r.email ? "Manual email" : "Manual SMS") as
        | "Auto"
        | "Manual email"
        | "Manual SMS"
        | "Legacy",
      reviewUrl: `${siteUrl}/review?token=${r.reviewToken}`,
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

  return (
    <AdminPageLayout token={t} current="reviews">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>
        Reviews
        {pending.length > 0 && (
          <span
            className={cn(
              "bg-coquelicot-500/20 text-coquelicot-400 ml-3 rounded-full px-2.5 py-0.5 text-sm font-semibold",
            )}
          >
            {pending.length} pending
          </span>
        )}
        <span className={cn("ml-3 text-lg font-semibold text-slate-400")}>
          {approved.length} approved
        </span>
      </h1>

      <div className={cn("grid grid-cols-1 gap-6 lg:grid-cols-3")}>
        <div className={cn("flex flex-col gap-6 lg:col-span-2")}>
          <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
            <ReviewApprovalList
              pending={pending}
              approved={approved}
              token={t}
              contacts={contacts}
              showSendForm={false}
            />
          </div>
        </div>

        <div className={cn("flex flex-col gap-6")}>
          <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
            <h2 className={cn("text-russian-violet mb-4 text-sm font-semibold")}>
              Send a review link
            </h2>
            <SendReviewLinkForm token={t} contactSuggestions={contactSuggestions} />
          </div>

          {linkHistory.length > 0 && (
            <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
              <h2 className={cn("text-russian-violet mb-4 text-sm font-semibold")}>Link history</h2>
              <ReviewLinkHistoryTable entries={linkHistory} token={t} />
            </div>
          )}
        </div>
      </div>
    </AdminPageLayout>
  );
}
