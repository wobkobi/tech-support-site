"use client";
// src/features/admin/components/AdminTabs.tsx
/**
 * @file AdminTabs.tsx
 * @description Tab switcher for the combined admin page (Reviews / Calendar).
 * Active tab is persisted in the URL via the ?tab= param.
 */

import { useState, useCallback } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
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
import { ContactAdminList, type ContactRow } from "@/features/admin/components/ContactAdminList";
import {
  TravelBlockAdminList,
  type TravelBlockRow,
} from "@/features/admin/components/TravelBlockAdminList";

const TABS = ["reviews", "calendar", "contacts", "travel"] as const;
type Tab = (typeof TABS)[number];

interface AdminTabsProps {
  pending: ReviewRow[];
  approved: ReviewRow[];
  linkHistory: LinkHistoryEntry[];
  bookings: AdminBookingRow[];
  contacts: ContactRow[];
  travelBlocks: TravelBlockRow[];
  token: string;
  /** Initial tab from the URL ?tab= param. Validated internally; defaults to "reviews". */
  initialTab?: string;
}

/**
 * Combined admin tab view for Reviews, Calendar, Contacts, and Travel.
 * Active tab is reflected in the URL so the browser back button and refresh work correctly.
 * @param props - Component props.
 * @param props.pending - Reviews pending approval.
 * @param props.approved - Already-approved reviews.
 * @param props.linkHistory - Review link history entries.
 * @param props.bookings - All booking rows.
 * @param props.contacts - All contact rows.
 * @param props.travelBlocks - Travel block rows.
 * @param props.token - Admin token for API calls.
 * @param props.initialTab - Initial tab to show, from the URL tab param.
 * @returns Admin tabs element.
 */
export function AdminTabs({
  pending: initialPending,
  approved: initialApproved,
  linkHistory,
  bookings,
  contacts,
  travelBlocks,
  token,
  initialTab,
}: AdminTabsProps): React.ReactElement {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() =>
    TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "reviews",
  );
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<string | null>(null);

  /**
   * Switches the active tab and updates the URL without adding a history entry.
   * @param newTab - Tab to activate.
   */
  function switchTab(newTab: Tab): void {
    setTab(newTab);
    router.replace(`/admin?token=${encodeURIComponent(token)}&tab=${newTab}`, { scroll: false });
  }

  const runBackfill = useCallback(async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/admin/contacts/backfill", {
        method: "POST",
        headers: { "X-Admin-Secret": token },
      });
      const data = (await res.json()) as { ok: boolean; upsertedCount?: number; error?: string };
      if (data.ok) {
        setBackfillResult(`Done — ${data.upsertedCount} contacts upserted. Reload to see updates.`);
      } else {
        setBackfillResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setBackfillResult("Network error — try again.");
    } finally {
      setBackfilling(false);
    }
  }, [token]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/contacts/sync", {
        method: "POST",
        headers: { "X-Admin-Secret": token },
      });
      const data = (await res.json()) as {
        ok: boolean;
        importedCount?: number;
        syncedCount?: number;
        error?: string;
      };
      if (data.ok) {
        setSyncResult(
          `Done — ${data.importedCount ?? 0} imported from Google, ${data.syncedCount ?? 0} pushed to Google. Reload to see updates.`,
        );
      } else {
        setSyncResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setSyncResult("Network error — try again.");
    } finally {
      setSyncing(false);
    }
  }, [token]);

  const runMatchContacts = useCallback(async () => {
    setMatching(true);
    setMatchResult(null);
    try {
      const res = await fetch("/api/admin/reviews/match-contacts", {
        method: "POST",
        headers: { "X-Admin-Secret": token },
      });
      const data = (await res.json()) as { ok: boolean; matchedCount?: number; error?: string };
      if (data.ok) {
        setMatchResult(`Done — ${data.matchedCount ?? 0} reviews matched. Reload to see updates.`);
      } else {
        setMatchResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setMatchResult("Network error — try again.");
    } finally {
      setMatching(false);
    }
  }, [token]);

  const pendingCount = initialPending.length;
  const confirmedCount = bookings.filter((b) => b.status === "confirmed").length;
  const heldCount = bookings.filter((b) => b.status === "held").length;

  /** Shared classes for inactive tab buttons. */
  const inactiveTab = "border-transparent text-rich-black/50 hover:text-rich-black";
  /** Shared classes for the active tab button. */
  const activeTab = "border-russian-violet text-russian-violet";
  /** Shared base classes for every tab button. */
  const tabBase =
    "flex items-center gap-2 border-b-2 px-4 pb-3 pt-1 -mb-px text-sm font-semibold transition-colors";

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* Tab bar */}
      <div className="border-seasalt-400/40 border-b">
        <nav className="-mb-px flex" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "reviews"}
            onClick={() => switchTab("reviews")}
            className={cn(tabBase, tab === "reviews" ? activeTab : inactiveTab)}
          >
            Reviews
            {pendingCount > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs font-medium",
                  tab === "reviews"
                    ? "bg-russian-violet/20 text-russian-violet"
                    : "bg-coquelicot-500/20 text-coquelicot-400",
                )}
              >
                {pendingCount}
              </span>
            )}
          </button>

          <button
            role="tab"
            aria-selected={tab === "calendar"}
            onClick={() => switchTab("calendar")}
            className={cn(tabBase, tab === "calendar" ? activeTab : inactiveTab)}
          >
            Calendar
            {confirmedCount + heldCount > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs font-medium",
                  tab === "calendar"
                    ? "bg-russian-violet/20 text-russian-violet"
                    : "bg-moonstone-600/20 text-moonstone-600",
                )}
              >
                {confirmedCount + heldCount}
              </span>
            )}
          </button>

          <button
            role="tab"
            aria-selected={tab === "contacts"}
            onClick={() => switchTab("contacts")}
            className={cn(tabBase, tab === "contacts" ? activeTab : inactiveTab)}
          >
            Contacts
            {contacts.length > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs font-medium",
                  tab === "contacts"
                    ? "bg-russian-violet/20 text-russian-violet"
                    : "bg-seasalt-400/60 text-rich-black/50",
                )}
              >
                {contacts.length}
              </span>
            )}
          </button>

          <button
            role="tab"
            aria-selected={tab === "travel"}
            onClick={() => switchTab("travel")}
            className={cn(tabBase, tab === "travel" ? activeTab : inactiveTab)}
          >
            Travel
            {travelBlocks.length > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs font-medium",
                  tab === "travel"
                    ? "bg-russian-violet/20 text-russian-violet"
                    : "bg-seasalt-400/60 text-rich-black/50",
                )}
              >
                {travelBlocks.length}
              </span>
            )}
          </button>
        </nav>
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
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div />
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={runMatchContacts}
                  disabled={matching}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    matching
                      ? "bg-seasalt-400/40 text-rich-black/40 cursor-not-allowed"
                      : "bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20",
                  )}
                >
                  {matching ? "Matching…" : "Match contacts"}
                </button>
                {matchResult && (
                  <p className="text-rich-black/50 max-w-xs text-right text-xs">{matchResult}</p>
                )}
              </div>
            </div>
            <ReviewApprovalList
              pending={initialPending}
              approved={initialApproved}
              token={token}
              contacts={contacts.map((c) => ({ id: c.id, name: c.name, email: c.email }))}
            />
          </section>
        </>
      )}

      {/* Calendar view */}
      {tab === "calendar" && (
        <section className={cn(CARD, "animate-fade-in")}>
          <BookingAdminList bookings={bookings} token={token} />
        </section>
      )}

      {/* Contacts view */}
      {tab === "contacts" && (
        <section className={cn(CARD, "animate-fade-in")}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-russian-violet mb-1 text-lg font-bold">Contacts</h2>
              <p className="text-rich-black/50 text-xs">
                Customers who have booked. Updated automatically with their latest details on each
                booking.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  onClick={runBackfill}
                  disabled={backfilling}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    backfilling
                      ? "bg-seasalt-400/40 text-rich-black/40 cursor-not-allowed"
                      : "bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20",
                  )}
                >
                  {backfilling ? "Backfilling…" : "Backfill from bookings"}
                </button>
                <button
                  onClick={runSync}
                  disabled={syncing}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    syncing
                      ? "bg-seasalt-400/40 text-rich-black/40 cursor-not-allowed"
                      : "bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20",
                  )}
                >
                  {syncing ? "Syncing…" : "Sync with Google"}
                </button>
              </div>
              {backfillResult && (
                <p className="text-rich-black/50 max-w-xs text-right text-xs">{backfillResult}</p>
              )}
              {syncResult && (
                <p className="text-rich-black/50 max-w-xs text-right text-xs">{syncResult}</p>
              )}
            </div>
          </div>
          <ContactAdminList contacts={contacts} token={token} />
        </section>
      )}

      {/* Travel view */}
      {tab === "travel" && (
        <section className={cn(CARD, "animate-fade-in")}>
          <h2 className="text-russian-violet mb-1 text-lg font-bold">Travel blocks</h2>
          <p className="text-rich-black/50 mb-4 text-xs">
            Travel time blocks computed for calendar events with a location. Refreshed every 15
            minutes by the cron job.
          </p>
          <TravelBlockAdminList blocks={travelBlocks} />
        </section>
      )}
    </div>
  );
}
