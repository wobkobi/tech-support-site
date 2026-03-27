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
import type { ContactRow } from "@/features/admin/components/ContactAdminList";
import type { TravelBlockRow } from "@/features/admin/components/TravelBlockAdminList";

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
  searchParams: Promise<{ token?: string; tab?: string }>;
}): Promise<React.ReactElement> {
  const { token, tab } = await searchParams;

  if (!isValidAdminToken(token ?? null)) {
    console.warn("[admin] Invalid token attempt", { tokenPresent: Boolean(token) });
    notFound();
  }

  const [reviews, sentBookings, sentRequests, allBookings, allContacts] = await Promise.all([
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
        contactId: true,
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
        phone: true,
        notes: true,
        startAt: true,
        endAt: true,
        createdAt: true,
        status: true,
        cancelToken: true,
        reviewSentAt: true,
      },
    }),
    prisma.contact.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        createdAt: true,
        googleContactId: true,
      },
    }),
  ]);

  // Build a map of contactId → contact name for denormalised display.
  const contactMap = new Map(allContacts.map((c) => [c.id, c.name]));

  // Group reviews that have a contactId by that contactId for per-contact display.
  const reviewsByContactId = new Map<
    string,
    Array<{
      id: string;
      text: string;
      firstName: string | null;
      lastName: string | null;
      customerRef: string | null;
    }>
  >();
  for (const r of reviews) {
    if (r.contactId) {
      const existing = reviewsByContactId.get(r.contactId) ?? [];
      existing.push({
        id: r.id,
        text: r.text,
        firstName: r.firstName,
        lastName: r.lastName,
        customerRef: r.customerRef ?? null,
      });
      reviewsByContactId.set(r.contactId, existing);
    }
  }

  // Map raw DB review rows to ReviewRow (adding contactName from contactMap).
  const reviewRows = reviews.map((r) => ({
    ...r,
    contactId: r.contactId ?? null,
    contactName: r.contactId ? (contactMap.get(r.contactId) ?? null) : null,
  }));

  const pending = reviewRows.filter((r) => r.status !== "approved");
  const approved = reviewRows.filter((r) => r.status === "approved");

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
    phone: b.phone ?? null,
    notes: b.notes ?? null,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    createdAt: b.createdAt.toISOString(),
    status: b.status as AdminBookingRow["status"],
    cancelToken: b.cancelToken,
    reviewSentAt: b.reviewSentAt?.toISOString() ?? null,
  }));

  const contactRows: ContactRow[] = allContacts.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone ?? null,
    address: c.address ?? null,
    createdAt: c.createdAt.toISOString(),
    googleContactId: c.googleContactId ?? null,
    reviews: reviewsByContactId.get(c.id) ?? [],
  }));

  const travelBlocks = await prisma.travelBlock.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sourceEventId: true,
      calendarEmail: true,
      summary: true,
      eventStartAt: true,
      eventEndAt: true,
      rawTravelMinutes: true,
      roundedMinutes: true,
      rawTravelBackMinutes: true,
      roundedBackMinutes: true,
      beforeEventId: true,
      afterEventId: true,
      createdAt: true,
    },
  });
  const syntheticIds = travelBlocks
    .flatMap((b) => [b.beforeEventId, b.afterEventId])
    .filter((id): id is string => id !== null);
  const travelCacheEntries =
    syntheticIds.length > 0
      ? await prisma.calendarEventCache.findMany({
          where: { eventId: { in: syntheticIds } },
          select: { eventId: true, expiresAt: true },
        })
      : [];
  const travelCacheMap = new Map(travelCacheEntries.map((e) => [e.eventId, e.expiresAt]));

  const travelBlockRows: TravelBlockRow[] = travelBlocks.map((b) => ({
    id: b.id,
    sourceEventId: b.sourceEventId,
    calendarEmail: b.calendarEmail,
    summary: b.summary ?? null,
    eventStartAt: b.eventStartAt.toISOString(),
    eventEndAt: b.eventEndAt.toISOString(),
    rawTravelMinutes: b.rawTravelMinutes ?? null,
    roundedMinutes: b.roundedMinutes ?? null,
    rawTravelBackMinutes: b.rawTravelBackMinutes ?? null,
    roundedBackMinutes: b.roundedBackMinutes ?? null,
    beforeEventId: b.beforeEventId ?? null,
    afterEventId: b.afterEventId ?? null,
    beforeExpiresAt: b.beforeEventId
      ? (travelCacheMap.get(b.beforeEventId)?.toISOString() ?? null)
      : null,
    afterExpiresAt: b.afterEventId
      ? (travelCacheMap.get(b.afterEventId)?.toISOString() ?? null)
      : null,
    createdAt: b.createdAt.toISOString(),
  }));

  const confirmedCount = allBookings.filter((b) => b.status === "confirmed").length;
  const heldCount = allBookings.filter((b) => b.status === "held").length;

  return (
    <PageShell>
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "animate-fade-in")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-russian-violet text-2xl font-extrabold sm:text-3xl">Admin</h1>
              <div className="flex flex-wrap gap-2">
                {pending.length > 0 && (
                  <span className="bg-coquelicot-500/20 text-coquelicot-400 rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {pending.length} pending
                  </span>
                )}
                <span className="bg-moonstone-600/20 text-moonstone-600 rounded-full px-2.5 py-0.5 text-xs font-medium">
                  {approved.length} approved
                </span>
                {confirmedCount > 0 && (
                  <span className="bg-russian-violet/10 text-russian-violet rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {confirmedCount} confirmed
                  </span>
                )}
                {heldCount > 0 && (
                  <span className="bg-mustard-400/20 text-mustard-200 rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {heldCount} held
                  </span>
                )}
              </div>
            </div>
          </section>

          <AdminTabs
            pending={pending}
            approved={approved}
            linkHistory={linkHistory}
            bookings={bookingRows}
            contacts={contactRows}
            travelBlocks={travelBlockRows}
            token={token!}
            initialTab={tab}
          />
        </div>
      </FrostedSection>
    </PageShell>
  );
}
