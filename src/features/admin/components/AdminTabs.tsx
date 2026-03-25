"use client";
// src/features/admin/components/AdminTabs.tsx
/**
 * @file AdminTabs.tsx
 * @description Tab switcher for the combined admin page (Reviews / Calendar).
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { CARD } from "@/shared/components/PageLayout";
import { ReviewApprovalList } from "@/features/reviews/components/admin/ReviewApprovalList";
import { ReviewLinkHistoryTable } from "@/features/reviews/components/admin/ReviewLinkHistoryTable";
import type { ReviewRow } from "@/features/reviews/components/admin/review-types";
import type { LinkHistoryEntry } from "@/features/reviews/components/admin/ReviewLinkHistoryTable";
import {
  BookingAdminList,
  type AdminBookingRow,
} from "@/features/booking/components/admin/BookingAdminList";

type Tab = "reviews" | "calendar";

interface AdminTabsProps {
  pending: ReviewRow[];
  approved: ReviewRow[];
  linkHistory: LinkHistoryEntry[];
  bookings: AdminBookingRow[];
  token: string;
}

/**
 * Combined admin tab view for Reviews and Calendar (bookings).
 * @param props - Component props.
 * @param props.pending - Reviews pending approval.
 * @param props.approved - Already-approved reviews.
 * @param props.linkHistory - Review link history entries.
 * @param props.bookings - All booking rows.
 * @param props.token - Admin token for API calls.
 * @returns Admin tabs element.
 */
export function AdminTabs({
  pending: initialPending,
  approved: initialApproved,
  linkHistory,
  bookings,
  token,
}: AdminTabsProps): React.ReactElement {
  const [tab, setTab] = useState<Tab>("reviews");

  const pendingCount = initialPending.length;
  const confirmedCount = bookings.filter((b) => b.status === "confirmed").length;
  const heldCount = bookings.filter((b) => b.status === "held").length;

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* Tab bar */}
      <div className="border-seasalt-400/40 bg-seasalt-900/40 flex gap-1 rounded-xl border p-1">
        <button
          onClick={() => setTab("reviews")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
            tab === "reviews"
              ? "bg-russian-violet text-white shadow-sm"
              : "text-rich-black/60 hover:text-rich-black",
          )}
        >
          Reviews
          {pendingCount > 0 && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs font-medium",
                tab === "reviews"
                  ? "bg-white/20 text-white"
                  : "bg-coquelicot-500/20 text-coquelicot-400",
              )}
            >
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("calendar")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
            tab === "calendar"
              ? "bg-russian-violet text-white shadow-sm"
              : "text-rich-black/60 hover:text-rich-black",
          )}
        >
          Calendar
          {(confirmedCount > 0 || heldCount > 0) && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs font-medium",
                tab === "calendar"
                  ? "bg-white/20 text-white"
                  : "bg-moonstone-600/20 text-moonstone-600",
              )}
            >
              {confirmedCount + heldCount}
            </span>
          )}
        </button>
      </div>

      {/* Reviews view */}
      {tab === "reviews" && (
        <>
          <section className={cn(CARD, "animate-fade-in")}>
            <h2 className="text-russian-violet mb-1 text-lg font-bold">Review link history</h2>
            <p className="text-rich-black/50 mb-4 text-xs">
              Everyone who has already been sent a review link. Click ✎ to add or edit their contact
              details.
            </p>
            <ReviewLinkHistoryTable entries={linkHistory} token={token} />
          </section>

          <section className={cn(CARD, "animate-slide-up animate-fill-both")}>
            <ReviewApprovalList pending={initialPending} approved={initialApproved} token={token} />
          </section>
        </>
      )}

      {/* Calendar view */}
      {tab === "calendar" && (
        <section className={cn(CARD, "animate-fade-in")}>
          <BookingAdminList bookings={bookings} token={token} />
        </section>
      )}
    </div>
  );
}
