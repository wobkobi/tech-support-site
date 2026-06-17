// src/app/admin/bookings/page.tsx
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import {
  BookingAdminList,
  type AdminBookingRow,
} from "@/features/booking/components/admin/BookingAdminList";
import { requireAdminAuth } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bookings - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin bookings page listing all bookings with status filters.
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
      notes: true,
      startAt: true,
      endAt: true,
      createdAt: true,
      status: true,
      cancelToken: true,
      reviewSentAt: true,
      quotedLowAtBooking: true,
      quotedHighAtBooking: true,
    },
  });

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
    quotedLow: b.quotedLowAtBooking ?? null,
    quotedHigh: b.quotedHighAtBooking ?? null,
  }));

  const confirmedCount = allBookings.filter((b) => b.status === "confirmed").length;
  const heldCount = allBookings.filter((b) => b.status === "held").length;
  const completedCount = allBookings.filter((b) => b.status === "completed").length;
  const cancelledCount = allBookings.filter((b) => b.status === "cancelled").length;

  const statusStats = [
    {
      label: "Confirmed",
      value: confirmedCount,
      className: "bg-moonstone-600/15 text-moonstone-600",
    },
    {
      label: "Held",
      value: heldCount,
      className: heldCount > 0 ? "bg-yellow-100 text-yellow-700" : "bg-slate-100 text-slate-500",
    },
    { label: "Completed", value: completedCount, className: "bg-green-100 text-green-700" },
    { label: "Cancelled", value: cancelledCount, className: "bg-slate-100 text-slate-500" },
  ];

  return (
    <AdminPageLayout current="bookings">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold text-russian-violet">Bookings</h1>
        <div className="flex flex-wrap gap-2">
          {statusStats.map((s) => (
            <span
              key={s.label}
              className={cn("rounded-full px-3 py-1 text-xs font-semibold", s.className)}
            >
              {s.value} {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <BookingAdminList bookings={bookingRows} />
      </div>
    </AdminPageLayout>
  );
}
