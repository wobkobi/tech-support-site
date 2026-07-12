// src/app/admin/(shell)/bookings/page.tsx
/**
 * @description Admin bookings list. Loads the most recent 1000 bookings (soft
 * cap to avoid unbounded scans), maps them to {@link AdminBookingRow}s, and
 * renders the filterable {@link BookingAdminList} (which owns the summary
 * StatCards, search, date-range filter, and sort). The select is kept to just
 * the columns the list shows; the detail page loads the full booking row itself.
 */
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import {
  BookingAdminList,
  type AdminBookingRow,
} from "@/features/booking/components/admin/BookingAdminList";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bookings - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin bookings page listing all bookings with StatCards, filters, and sort.
 * @returns Bookings page element.
 */
export default async function AdminBookingsPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  // Soft cap to prevent unbounded scans as the booking history grows.
  // Swap for cursor pagination if more than the most recent 1000 bookings ever needs to be visible.
  const allBookings = await prisma.booking.findMany({
    orderBy: { startAt: "desc" },
    take: 1000,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      startAt: true,
      endAt: true,
      createdAt: true,
      status: true,
      cancelToken: true,
      reviewSentAt: true,
      cancelledAt: true,
      noShow: true,
      quotedLowAtBooking: true,
      quotedHighAtBooking: true,
    },
  });

  const bookingRows: AdminBookingRow[] = allBookings.map((b) => ({
    id: b.id,
    name: b.name,
    email: b.email,
    phone: b.phone ?? null,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    createdAt: b.createdAt.toISOString(),
    status: b.status as AdminBookingRow["status"],
    cancelToken: b.cancelToken,
    reviewSentAt: b.reviewSentAt?.toISOString() ?? null,
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    noShow: b.noShow,
    quotedLow: b.quotedLowAtBooking ?? null,
    quotedHigh: b.quotedHighAtBooking ?? null,
  }));

  return (
    <>
      <PageHeader title="Bookings" description="Search, filter, and manage customer bookings." />
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <BookingAdminList bookings={bookingRows} />
      </div>
    </>
  );
}
