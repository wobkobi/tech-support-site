// src/app/admin/reviews/page.tsx
/**
 * @file page.tsx
 * @description Admin review approval page. Protected by ADMIN_SECRET token in the URL.
 * Access via: /admin/reviews?token=<ADMIN_SECRET>
 */

import type { Metadata } from "next";
import type React from "react";
import { notFound } from "next/navigation";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import { ReviewApprovalList } from "@/features/reviews/components/admin/ReviewApprovalList";
import { ReviewLinkHistoryTable } from "@/features/reviews/components/admin/ReviewLinkHistoryTable";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin - Reviews",
  robots: { index: false, follow: false },
};

/**
 * Admin reviews page - renders access-denied or the approval UI depending on token validity.
 * @param props - Page props.
 * @param props.searchParams - URL search parameters (contains token).
 * @returns Admin page element.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;

  if (!isValidAdminToken(token ?? null)) {
    // Log invalid admin access attempts for monitoring and debugging without exposing the token value.
    console.warn("Invalid admin token used to access /admin/reviews", {
      tokenPresent: Boolean(token),
    });
    console.warn("[admin/reviews] Invalid token attempt", { tokenPresent: Boolean(token) });
    notFound();
  }

  const [reviews, sentBookings, sentRequests, allReviews, allBookings] = await Promise.all([
    prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        text: true,
        firstName: true,
        lastName: true,
        isAnonymous: true,
        status: true,
        createdAt: true,
      },
    }),
    // Auto-sent review emails (post-booking cron)
    prisma.booking.findMany({
      where: { reviewSentAt: { not: null } },
      orderBy: { reviewSentAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        reviewSentAt: true,
        reviewSubmittedAt: true,
        reviewToken: true,
      },
    }),
    // Manually sent review links (both email and SMS)
    prisma.reviewRequest.findMany({
      orderBy: { createdAt: "desc" },
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
    // All reviews - used to find any not covered by Auto or Manual lists
    prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isAnonymous: true,
        customerRef: true,
        bookingId: true,
        createdAt: true,
      },
    }),
    // All booking id→reviewToken pairs (for legacy reviews linked via bookingId only)
    prisma.booking.findMany({
      select: { id: true, reviewToken: true },
    }),
  ]);

  const pending = reviews.filter((r) => r.status !== "approved");
  const approved = reviews.filter((r) => r.status === "approved");

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz").replace(
    /\/$/,
    "",
  );

  // Tokens already covered by Auto or Manual lists
  const knownTokens = new Set([
    ...sentBookings.map((b) => b.reviewToken),
    ...sentRequests.map((r) => r.reviewToken),
  ]);
  // Booking ids already shown as Auto entries (to avoid duplicating via bookingId)
  const knownBookingIds = new Set(sentBookings.map((b) => b.id));
  // Map bookingId → reviewToken for all bookings (used when review has bookingId but no customerRef)
  const bookingTokenMap = new Map(allBookings.map((b) => [b.id, b.reviewToken]));

  const legacyReviews = allReviews.filter((r) => {
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
      // Resolve the review token: use customerRef if set, otherwise look up via bookingId
      // Normalize empty strings to null before resolving the token
      const token =
        (r.customerRef || null) ??
        (r.bookingId ? (bookingTokenMap.get(r.bookingId) ?? null) : null);
      return {
        id: null as string | null,
        customerRef: token,
        reviewId: r.id,
        name: r.isAnonymous
          ? "Anonymous"
          : [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown",
        email: null as string | null,
        phone: null as string | null,
        sentAt: r.createdAt.toISOString(),
        reviewed: true,
        source: "Legacy" as const,
        reviewUrl: token ? `${siteUrl}/review?token=${token}` : "",
      };
    }),
  ].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

  return (
    <PageShell>
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "animate-fade-in")}>
            <h1
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Review Approval
            </h1>
            <div className="flex gap-2">
              <span className="bg-coquelicot-500/20 text-coquelicot-400 rounded-full px-2.5 py-0.5 text-xs font-medium">
                {pending.length} pending
              </span>
              <span className="bg-moonstone-600/20 text-moonstone-600 rounded-full px-2.5 py-0.5 text-xs font-medium">
                {approved.length} approved
              </span>
            </div>
          </section>

          {/* Review link history - check before sending a new link */}
          <section className={cn(CARD, "animate-slide-up animate-fill-both")}>
            <h2 className={cn("text-russian-violet mb-1 text-lg font-bold")}>
              Review link history
            </h2>
            <p className={cn("text-rich-black/50 mb-4 text-xs")}>
              Everyone who has already been sent a review link. Click ✎ to add or edit their contact
              details.
            </p>
            <ReviewLinkHistoryTable entries={linkHistory} token={token!} />
          </section>

          <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
            <ReviewApprovalList pending={pending} approved={approved} token={token!} />
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
