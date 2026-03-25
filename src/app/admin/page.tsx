// src/app/admin/page.tsx
/**
 * @file page.tsx
 * @description Combined admin page for reviews and booking management.
 * Access via: /admin?token=<ADMIN_SECRET>
 */

import type { Metadata } from "next";
import type React from "react";
import { notFound } from "next/navigation";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";
import { AdminTabs } from "@/features/admin/components/AdminTabs";
import type { AdminBookingRow } from "@/features/booking/components/admin/BookingAdminList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * Combined admin page with Reviews and Calendar tab views.
 * @param props - Page props.
 * @param props.searchParams - URL search parameters (contains token).
 * @returns Admin page element.
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

  const [reviews, sentBookings, sentRequests, allBookings] = await Promise.all([
    prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        text: true,
        firstName: true,
        lastName: true,
        isAnonymous: true,
        status: true,
        customerRef: true,
        bookingId: true,
        createdAt: true,
      },
    }),
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
    prisma.booking.findMany({
      orderBy: { startAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        notes: true,
        startAt: true,
        endAt: true,
        status: true,
        cancelToken: true,
      },
    }),
  ]);

  const pending = reviews.filter((r) => r.status !== "approved");
  const approved = reviews.filter((r) => r.status === "approved");

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

  const bookingRows: AdminBookingRow[] = allBookings.map((b) => ({
    id: b.id,
    name: b.name,
    email: b.email,
    notes: b.notes ?? null,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    status: b.status as AdminBookingRow["status"],
    cancelToken: b.cancelToken,
  }));

  return (
    <PageShell>
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "animate-fade-in")}>
            <h1 className="text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl">
              Admin
            </h1>
            <div className="flex gap-2">
              <span className="bg-coquelicot-500/20 text-coquelicot-400 rounded-full px-2.5 py-0.5 text-xs font-medium">
                {pending.length} pending reviews
              </span>
              <span className="bg-moonstone-600/20 text-moonstone-600 rounded-full px-2.5 py-0.5 text-xs font-medium">
                {approved.length} approved reviews
              </span>
            </div>
          </section>

          <AdminTabs
            pending={pending}
            approved={approved}
            linkHistory={linkHistory}
            bookings={bookingRows}
            token={token!}
          />
        </div>
      </FrostedSection>
    </PageShell>
  );
}
