// src/app/admin/bookings/page.tsx
import type { Metadata } from "next";
import type React from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import { AdminSidebar } from "@/features/admin/components/AdminSidebar";
import {
  BookingAdminList,
  type AdminBookingRow,
} from "@/features/booking/components/admin/BookingAdminList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calendar — Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin calendar page listing all bookings with status filters.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search parameters (contains token).
 * @returns Calendar page element.
 */
export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;

  if (!isValidAdminToken(token ?? null)) {
    console.warn("[admin/bookings] Invalid token attempt", { tokenPresent: Boolean(token) });
    notFound();
  }

  const t = token!;

  const allBookings = await prisma.booking.findMany({
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
    <div className={cn("flex min-h-screen")}>
      <AdminSidebar token={t} current="bookings" />

      <div className={cn("ml-56 flex-1 bg-slate-50")}>
        <div className={cn("mx-auto max-w-7xl px-6 py-8")}>
          <div className={cn("mb-6 flex flex-wrap items-center justify-between gap-4")}>
            <h1 className={cn("text-russian-violet text-2xl font-extrabold")}>Calendar</h1>
            <div className={cn("flex flex-wrap gap-2")}>
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

          <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
            <BookingAdminList bookings={bookingRows} token={t} />
          </div>
        </div>
      </div>
    </div>
  );
}
