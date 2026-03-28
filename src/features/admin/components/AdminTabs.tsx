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
import type { ConflictEntry } from "@/app/api/admin/contacts/enrich-from-reviews/route";

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
  /** Conflicts pre-computed at page load (ReviewRequest vs Contact). */
  initialConflicts: ConflictEntry[];
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
 * @param props.initialConflicts - Conflicts pre-computed at page load.
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
  initialConflicts,
}: AdminTabsProps): React.ReactElement {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() =>
    TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "reviews",
  );
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncConfirmPending, setSyncConfirmPending] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[] | null>(
    initialConflicts.length > 0 ? initialConflicts : null,
  );
  const [recalculating, setRecalculating] = useState(false);
  const [recalculateResult, setRecalculateResult] = useState<string | null>(null);

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
        setBackfillResult(`Done — ${data.upsertedCount} contacts upserted.`);
        router.refresh();
      } else {
        setBackfillResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setBackfillResult("Network error — try again.");
    } finally {
      setBackfilling(false);
    }
  }, [token, router]);

  const runSync = useCallback(async () => {
    setSyncConfirmPending(false);
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
          `Done — ${data.importedCount ?? 0} imported from Google, ${data.syncedCount ?? 0} pushed to Google.`,
        );
        router.refresh();
      } else {
        setSyncResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setSyncResult("Network error — try again.");
    } finally {
      setSyncing(false);
    }
  }, [token, router]);

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
        setMatchResult(`Done — ${data.matchedCount ?? 0} reviews matched.`);
        router.refresh();
      } else {
        setMatchResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setMatchResult("Network error — try again.");
    } finally {
      setMatching(false);
    }
  }, [token, router]);

  const runEnrich = useCallback(async () => {
    setEnriching(true);
    setEnrichResult(null);
    setConflicts(null);
    try {
      const res = await fetch("/api/admin/contacts/enrich-from-reviews", {
        method: "POST",
        headers: { "X-Admin-Secret": token },
      });
      const data = (await res.json()) as {
        ok: boolean;
        enrichedCount?: number;
        conflicts?: ConflictEntry[];
        error?: string;
      };
      if (data.ok) {
        const parts: string[] = [];
        if ((data.enrichedCount ?? 0) > 0)
          parts.push(`${data.enrichedCount} phone${data.enrichedCount === 1 ? "" : "s"} filled in`);
        const conflictCount = data.conflicts?.length ?? 0;
        if (conflictCount > 0)
          parts.push(`${conflictCount} conflict${conflictCount === 1 ? "" : "s"} found`);
        setEnrichResult(
          parts.length > 0 ? parts.join(", ") + "." : "No missing data or conflicts found.",
        );
        setConflicts(data.conflicts ?? []);
      } else {
        setEnrichResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setEnrichResult("Network error — try again.");
    } finally {
      setEnriching(false);
    }
  }, [token]);

  const resolveConflict = useCallback(
    async (conflict: ConflictEntry, chosenName: string | null, chosenPhone: string | null) => {
      const body: Record<string, string> = {
        contactId: conflict.contactId,
        sourceId: conflict.sourceId,
        source: conflict.source,
      };
      if (chosenName !== null) body.name = chosenName;
      if (chosenPhone !== null) body.phone = chosenPhone;
      try {
        await fetch("/api/admin/contacts/resolve-conflict", {
          method: "POST",
          headers: { "X-Admin-Secret": token, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        router.refresh();
      } catch {
        // best-effort
      }
      setConflicts((prev) => prev?.filter((c) => c.sourceId !== conflict.sourceId) ?? null);
    },
    [token, router],
  );

  const skipConflict = useCallback((sourceId: string) => {
    setConflicts((prev) => prev?.filter((c) => c.sourceId !== sourceId) ?? null);
  }, []);

  const runRecalculate = useCallback(async () => {
    setRecalculating(true);
    setRecalculateResult(null);
    try {
      const res = await fetch("/api/admin/travel/recalculate", {
        method: "POST",
        headers: { "X-Admin-Secret": token },
      });
      const data = (await res.json()) as { ok: boolean; cachedCount?: number; error?: string };
      if (data.ok) {
        setRecalculateResult(`Done — ${data.cachedCount ?? 0} events cached.`);
        router.refresh();
      } else {
        setRecalculateResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setRecalculateResult("Network error — try again.");
    } finally {
      setRecalculating(false);
    }
  }, [token, router]);

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
              contacts={contacts.map((c) => ({
                id: c.id,
                name: c.name,
                email: c.email,
                reviewCount: c.reviews.length,
              }))}
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
                Customers built from bookings and review requests.
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
                  {backfilling ? "Backfilling…" : "Backfill contacts"}
                </button>
                {syncConfirmPending ? (
                  <div className="border-seasalt-400/40 bg-seasalt flex flex-col gap-2 rounded-lg border p-3 text-xs">
                    <p className="text-rich-black/70 font-medium">Confirm sync with Google?</p>
                    <ul className="text-rich-black/50 list-inside list-disc space-y-0.5">
                      <li>
                        {contacts.filter((c) => !!c.googleContactId).length} synced contacts will
                        have their email, phone and address pushed to Google
                      </li>
                      <li>
                        {contacts.filter((c) => !c.googleContactId).length} unsynced contacts will
                        be created in Google Contacts
                      </li>
                      <li>Google contacts not yet in your local DB will be imported</li>
                    </ul>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void runSync()}
                        className="bg-russian-violet hover:bg-russian-violet/90 rounded px-2.5 py-1 text-xs font-semibold text-white transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setSyncConfirmPending(false)}
                        className="bg-seasalt-400/40 text-rich-black/70 hover:bg-seasalt-400/60 rounded px-2.5 py-1 text-xs font-semibold transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setSyncConfirmPending(true)}
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
                )}
                <button
                  onClick={runEnrich}
                  disabled={enriching}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    enriching
                      ? "bg-seasalt-400/40 text-rich-black/40 cursor-not-allowed"
                      : "bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20",
                  )}
                >
                  {enriching ? "Checking…" : "Enrich from reviews"}
                </button>
              </div>
              {backfillResult && (
                <p className="text-rich-black/50 max-w-xs text-right text-xs">{backfillResult}</p>
              )}
              {syncResult && (
                <p className="text-rich-black/50 max-w-xs text-right text-xs">{syncResult}</p>
              )}
              {enrichResult && (
                <p className="text-rich-black/50 max-w-xs text-right text-xs">{enrichResult}</p>
              )}
            </div>
          </div>
          <ContactAdminList contacts={contacts} token={token} />

          {conflicts !== null && conflicts.length > 0 && (
            <div className="mt-6">
              <h3 className="text-russian-violet mb-1 text-sm font-bold">
                Conflicts ({conflicts.length})
              </h3>
              <p className="text-rich-black/50 mb-3 text-xs">
                These records have data that differs from your contacts. Accept to update the
                contact, or skip to leave it as-is.
              </p>
              <div className="flex flex-col gap-2">
                {conflicts.map((conflict) => (
                  <div
                    key={conflict.sourceId}
                    className="border-coquelicot-500/30 bg-coquelicot-500/5 rounded-lg border p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-rich-black text-sm font-medium">
                        {conflict.contactEmail ?? conflict.contactPhone ?? "Unknown"}
                      </span>
                      <span className="bg-seasalt-400/60 text-rich-black/60 rounded px-1.5 py-0.5 text-xs font-medium">
                        {conflict.source === "ReviewRequest"
                          ? "Review request"
                          : conflict.source === "Booking"
                            ? "Booking"
                            : "Review"}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {conflict.conflictFields.includes("name") && (
                        <div className="space-y-1">
                          <p className="text-rich-black/50 text-xs font-medium uppercase tracking-wide">
                            Name — pick one to apply to both sides
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() =>
                                void resolveConflict(conflict, conflict.contactName, null)
                              }
                              className="border-seasalt-400/60 text-rich-black hover:border-russian-violet hover:text-russian-violet rounded border px-2.5 py-1 text-xs font-medium transition-colors"
                            >
                              {conflict.contactName}
                            </button>
                            <button
                              onClick={() =>
                                void resolveConflict(conflict, conflict.sourceName, null)
                              }
                              className="border-seasalt-400/60 text-rich-black hover:border-russian-violet hover:text-russian-violet rounded border px-2.5 py-1 text-xs font-medium transition-colors"
                            >
                              {conflict.sourceName}
                            </button>
                          </div>
                        </div>
                      )}
                      {conflict.conflictFields.includes("phone") && (
                        <div className="space-y-1">
                          <p className="text-rich-black/50 text-xs font-medium uppercase tracking-wide">
                            Phone — pick one to apply to both sides
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() =>
                                void resolveConflict(conflict, null, conflict.contactPhone)
                              }
                              className="border-seasalt-400/60 text-rich-black hover:border-russian-violet hover:text-russian-violet rounded border px-2.5 py-1 text-xs font-medium transition-colors"
                            >
                              {conflict.contactPhone ?? "—"}
                            </button>
                            <button
                              onClick={() =>
                                void resolveConflict(conflict, null, conflict.sourcePhone)
                              }
                              className="border-seasalt-400/60 text-rich-black hover:border-russian-violet hover:text-russian-violet rounded border px-2.5 py-1 text-xs font-medium transition-colors"
                            >
                              {conflict.sourcePhone}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => skipConflict(conflict.sourceId)}
                        className="text-rich-black/40 hover:text-rich-black/70 rounded px-2 py-1 text-xs font-semibold transition-colors"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {conflicts !== null && conflicts.length === 0 && enrichResult && (
            <p className="text-rich-black/40 mt-4 text-xs">No conflicts remaining.</p>
          )}
        </section>
      )}

      {/* Travel view */}
      {tab === "travel" && (
        <section className={cn(CARD, "animate-fade-in")}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-russian-violet mb-1 text-lg font-bold">Travel blocks</h2>
              <p className="text-rich-black/50 text-xs">
                Travel time blocks computed for calendar events with a location. Refreshed every 15
                minutes by the cron job.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => void runRecalculate()}
                disabled={recalculating}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  recalculating
                    ? "bg-seasalt-400/40 text-rich-black/40 cursor-not-allowed"
                    : "bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20",
                )}
              >
                {recalculating ? "Recalculating…" : "Recalculate travel times"}
              </button>
              {recalculateResult && (
                <p className="text-rich-black/50 max-w-xs text-right text-xs">
                  {recalculateResult}
                </p>
              )}
            </div>
          </div>
          <TravelBlockAdminList blocks={travelBlocks} />
        </section>
      )}
    </div>
  );
}
