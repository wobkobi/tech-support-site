"use client";
// src/features/reviews/components/admin/ReviewApprovalList.tsx
/**
 * @description Interactive client component for approving, revoking, and deleting
 * reviews, with search, filter chips (status / verified / unlinked), and sort.
 */

import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";
import type { ReviewRow } from "./review-types";
import { ReviewCard } from "./ReviewCard";
import { SendReviewLinkForm } from "./SendReviewLinkForm";

/**
 * A slim contact entry for the contact picker.
 */
interface ContactPickerEntry {
  /** Contact database ID */
  id: string;
  /** Display name */
  name: string;
  /** Email address, or null for phone-only contacts */
  email: string | null;
  /** Number of reviews already linked to this contact */
  reviewCount: number;
}

/**
 * Props for the {@link ReviewApprovalList} component.
 */
interface ReviewApprovalListProps {
  /** Reviews pending approval */
  pending: ReviewRow[];
  /** Already-approved reviews */
  approved: ReviewRow[];
  /** Contacts available for linking to reviews */
  contacts: ContactPickerEntry[];
  /** Whether to show the {@link SendReviewLinkForm} at the top. Defaults to true. */
  showSendForm?: boolean;
}

type StatusFilter = "all" | "pending" | "approved";
type Sort = "newest" | "oldest";

/**
 * Classes for a filter chip button.
 * @param active - Whether the chip is selected.
 * @returns Class string.
 */
function chipClass(active: boolean): string {
  return cn(
    "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
    active
      ? "border-russian-violet bg-russian-violet text-white"
      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100",
  );
}

/**
 * Renders the full admin review list with pending and approved sections.
 * Uses optimistic UI - cards are moved/removed immediately on action.
 * @param props - Component props.
 * @param props.pending - Reviews awaiting approval.
 * @param props.approved - Already-approved reviews.
 * @param props.contacts - Contacts available for linking.
 * @param props.showSendForm - Whether to show the {@link SendReviewLinkForm} at the top. Defaults to true.
 * @returns Review approval list element.
 */
export function ReviewApprovalList({
  pending: initialPending,
  approved: initialApproved,
  contacts,
  showSendForm = true,
}: ReviewApprovalListProps): React.ReactElement {
  const { toast } = useToast();
  const [pending, setPending] = useState<ReviewRow[]>(initialPending);
  const [approved, setApproved] = useState<ReviewRow[]>(initialApproved);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkSaving, setLinkSaving] = useState<string | null>(null);

  /**
   * True when a row matches the current search query and filter chips.
   * @param row - Review row to test.
   * @returns Whether the row is visible.
   */
  function passesFilters(row: ReviewRow): boolean {
    const q = query.trim().toLowerCase();
    if (q) {
      const name = [row.firstName, row.lastName].filter(Boolean).join(" ").toLowerCase();
      const hit =
        name.includes(q) ||
        row.text.toLowerCase().includes(q) ||
        (row.contactName?.toLowerCase().includes(q) ?? false);
      if (!hit) return false;
    }
    if (verifiedOnly && row.verified !== true) return false;
    if (unlinkedOnly && row.contactId !== null) return false;
    return true;
  }

  /**
   * Moves a review from pending to approved.
   * @param id - Review ID to approve.
   */
  function handleApprove(id: string): void {
    const row = pending.find((r) => r.id === id);
    if (!row) return;
    setPending((prev) => prev.filter((r) => r.id !== id));
    setApproved((prev) => [{ ...row, status: "approved" }, ...prev]);
  }

  /**
   * Moves a review from approved back to pending.
   * @param id - Review ID to revoke.
   */
  function handleRevoke(id: string): void {
    const row = approved.find((r) => r.id === id);
    if (!row) return;
    setApproved((prev) => prev.filter((r) => r.id !== id));
    setPending((prev) => [{ ...row, status: "pending" }, ...prev]);
  }

  /**
   * Removes a review from whichever list contains it.
   * @param id - Review ID to delete.
   */
  function handleDelete(id: string): void {
    setPending((prev) => prev.filter((r) => r.id !== id));
    setApproved((prev) => prev.filter((r) => r.id !== id));
  }

  /**
   * Updates the contactId for a review via the admin API, then updates local state.
   * @param reviewId - The review to link.
   * @param contactId - The contact to link to, or null to unlink.
   */
  async function handleLinkContact(reviewId: string, contactId: string | null): Promise<void> {
    setLinkSaving(reviewId);
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) {
        toast("Couldn't update the linked contact.", { tone: "error" });
        return;
      }
      const contactName = contactId
        ? (contacts.find((c) => c.id === contactId)?.name ?? null)
        : null;
      setPending((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, contactId, contactName } : r)),
      );
      setApproved((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, contactId, contactName } : r)),
      );
      setLinkingId(null);
      toast(contactId ? "Contact linked." : "Contact unlinked.", { tone: "success" });
    } catch {
      toast("Network error - try again.", { tone: "error" });
    } finally {
      setLinkSaving(null);
    }
  }

  /**
   * Renders the contact-link UI for a single review row.
   * @param row - The review row to render the link UI for.
   * @returns Contact link element.
   */
  function renderContactLink(row: ReviewRow): React.ReactElement {
    if (linkingId === row.id) {
      return (
        <div className="flex items-center gap-2">
          <select
            aria-label="Select contact"
            defaultValue=""
            disabled={linkSaving === row.id}
            onChange={(e) => {
              const val = e.target.value;
              void handleLinkContact(row.id, val || null);
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
          >
            <option value="">-- no contact --</option>
            {contacts
              .filter((c) => c.id !== row.contactId && c.reviewCount === 0)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` (${c.email})` : ""}
                </option>
              ))}
          </select>
          <button
            onClick={() => setLinkingId(null)}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Cancel
          </button>
        </div>
      );
    }

    if (row.contactId && row.contactName) {
      return (
        <button
          onClick={() => setLinkingId(row.id)}
          className="rounded-full bg-moonstone-600/10 px-2 py-0.5 text-xs font-medium text-moonstone-600 transition-colors hover:bg-moonstone-600/20"
          title="Change linked contact"
        >
          {row.contactName}
        </button>
      );
    }

    return (
      <button
        onClick={() => setLinkingId(row.id)}
        className="rounded px-1 py-0.5 text-xs text-russian-violet/50 transition-colors hover:text-russian-violet"
      >
        Link contact
      </button>
    );
  }

  /**
   * Compares two rows by creation time for the current sort direction.
   * @param a - First row.
   * @param b - Second row.
   * @returns Negative/positive comparator result.
   */
  function bySort(a: ReviewRow, b: ReviewRow): number {
    return sort === "newest"
      ? b.createdAt.getTime() - a.createdAt.getTime()
      : a.createdAt.getTime() - b.createdAt.getTime();
  }

  const visiblePending = pending.filter(passesFilters).sort(bySort);
  const visibleApproved = approved.filter(passesFilters).sort(bySort);
  const filtered = query.trim() !== "" || verifiedOnly || unlinkedOnly;
  const showPending = statusFilter !== "approved";
  const showApproved = statusFilter !== "pending";

  return (
    <div className="flex flex-col gap-6">
      {/* Send review link to past client */}
      {showSendForm && <SendReviewLinkForm />}

      {/* Search */}
      <input
        type="search"
        placeholder="Search name, review text…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
      />

      {/* Filter chips + sort */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "pending", "approved"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={chipClass(statusFilter === s)}
          >
            {s === "all" ? "All" : s === "pending" ? "Pending" : "Approved"}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button
          type="button"
          onClick={() => setVerifiedOnly((v) => !v)}
          className={chipClass(verifiedOnly)}
        >
          Verified only
        </button>
        <button
          type="button"
          onClick={() => setUnlinkedOnly((v) => !v)}
          className={chipClass(unlinkedOnly)}
        >
          Unlinked only
        </button>
        <select
          aria-label="Sort reviews"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="ml-auto rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {/* Pending */}
      {showPending && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-russian-violet">
            Pending
            {visiblePending.length > 0 && (
              <StatusPill tone="warning">{visiblePending.length}</StatusPill>
            )}
          </h2>
          {visiblePending.length === 0 ? (
            <p className="text-sm text-slate-400">
              {filtered ? "No matching pending reviews." : "No reviews pending approval."}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {visiblePending.map((row) => (
                <div key={row.id} className="flex flex-col gap-1">
                  <ReviewCard
                    row={row}
                    onApprove={() => handleApprove(row.id)}
                    onDelete={() => handleDelete(row.id)}
                  />
                  <div className="pl-1">{renderContactLink(row)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {showPending && showApproved && <hr className="border-slate-200" />}

      {/* Approved */}
      {showApproved && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-russian-violet">
            Approved
            {visibleApproved.length > 0 && (
              <StatusPill tone="success">{visibleApproved.length}</StatusPill>
            )}
          </h2>
          {visibleApproved.length === 0 ? (
            <p className="text-sm text-slate-400">
              {filtered ? "No matching approved reviews." : "No approved reviews yet."}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {visibleApproved.map((row) => (
                <div key={row.id} className="flex flex-col gap-1">
                  <ReviewCard
                    row={row}
                    onRevoke={() => handleRevoke(row.id)}
                    onDelete={() => handleDelete(row.id)}
                  />
                  <div className="pl-1">{renderContactLink(row)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Barrel exports for backward compatibility
export type { ReviewRow } from "./review-types";
