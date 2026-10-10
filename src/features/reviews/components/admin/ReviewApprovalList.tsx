"use client";
// src/features/reviews/components/admin/ReviewApprovalList.tsx
// Interactive client component for approving, revoking, and deleting reviews, with
// search, filter chips (status / verified / unlinked), and sort.

import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { adminChipClass } from "@/features/admin/components/ui/chip-classes";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ADMIN_LINK_CLS } from "@/features/admin/components/ui/field-classes";
import { ListToolbar } from "@/features/admin/components/ui/ListToolbar";
import { ShowMoreButton } from "@/features/admin/components/ui/ShowMoreButton";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { useShowMore } from "@/features/admin/hooks/use-show-more";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";
import { ContactPicker, type ContactPickerEntry } from "./ContactPicker";
import type { ReviewRow } from "./review-types";
import { ReviewCard } from "./ReviewCard";
import { SendReviewLinkForm } from "./SendReviewLinkForm";

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
  /** Which status chip starts selected. Defaults to "all". */
  initialStatus?: StatusFilter;
}

type StatusFilter = "all" | "pending" | "approved";
type Sort = "newest" | "oldest";

/** Approved reviews per "Show more" batch. */
const APPROVED_BATCH = 10;

/**
 * Renders the full admin review list with pending and approved sections.
 * Uses optimistic UI - cards are moved/removed immediately on action.
 * @param props - Component props.
 * @param props.pending - Reviews awaiting approval.
 * @param props.approved - Already-approved reviews.
 * @param props.contacts - Contacts available for linking.
 * @param props.showSendForm - Whether to show the {@link SendReviewLinkForm} at the top. Defaults to true.
 * @param props.initialStatus - Which status chip starts selected. Defaults to "all".
 * @returns Review approval list element.
 */
export function ReviewApprovalList({
  pending: initialPending,
  approved: initialApproved,
  contacts,
  showSendForm = true,
  initialStatus = "all",
}: ReviewApprovalListProps): React.ReactElement {
  const { toast } = useToast();
  const [pending, setPending] = useState<ReviewRow[]>(initialPending);
  const [approved, setApproved] = useState<ReviewRow[]>(initialApproved);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
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
        <div className="max-w-sm">
          <ContactPicker
            contacts={contacts}
            value={row.contactId}
            busy={linkSaving === row.id}
            onSelect={(contactId) => void handleLinkContact(row.id, contactId)}
            onCancel={() => setLinkingId(null)}
          />
        </div>
      );
    }

    if (row.contactId && row.contactName) {
      return (
        <button
          onClick={() => setLinkingId(row.id)}
          className="rounded-full bg-moonstone-400/10 px-2.5 py-0.5 text-sm font-semibold text-moonstone-700 transition-colors hover:bg-moonstone-400/20"
          title="Change linked contact"
        >
          {row.contactName}
        </button>
      );
    }

    return (
      <button
        onClick={() => setLinkingId(row.id)}
        className={cn("rounded px-1 py-0.5 text-sm", ADMIN_LINK_CLS)}
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
  // Pending stays whole: every one of those wants a decision. Approved reviews
  // are long cards and only grow, so they come in batches.
  const approvedPager = useShowMore(
    visibleApproved,
    APPROVED_BATCH,
    [query, statusFilter, verifiedOnly, unlinkedOnly, sort].join("|"),
  );
  const filtered = query.trim() !== "" || verifiedOnly || unlinkedOnly;
  const showPending = statusFilter !== "approved";
  const showApproved = statusFilter !== "pending";

  return (
    <div className="flex flex-col gap-6">
      {/* Send review link to past client */}
      {showSendForm && <SendReviewLinkForm />}

      {/* Search, filter chips and sort */}
      <ListToolbar
        className="mb-0"
        search={
          <AdminInput
            type="search"
            placeholder="Search name, review text…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10"
          />
        }
        filters={
          <>
            {(["all", "pending", "approved"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={adminChipClass(statusFilter === s)}
              >
                {s === "all" ? "All" : s === "pending" ? "Pending" : "Approved"}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-admin-border" />
            <button
              type="button"
              onClick={() => setVerifiedOnly((v) => !v)}
              className={adminChipClass(verifiedOnly)}
            >
              Verified only
            </button>
            <button
              type="button"
              onClick={() => setUnlinkedOnly((v) => !v)}
              className={adminChipClass(unlinkedOnly)}
            >
              Unlinked only
            </button>
          </>
        }
        actions={
          <AdminSelect
            aria-label="Sort reviews"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-10 w-auto"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </AdminSelect>
        }
      />

      {/* Pending */}
      {showPending && (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-admin-text">
            Pending
            {visiblePending.length > 0 && (
              <StatusPill tone="warning">{visiblePending.length}</StatusPill>
            )}
          </h3>
          {visiblePending.length === 0 ? (
            <EmptyState
              className="py-4"
              title={filtered ? "No matching pending reviews." : "No reviews pending approval."}
            />
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

      {showPending && showApproved && <hr className="border-admin-border" />}

      {/* Approved */}
      {showApproved && (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-admin-text">
            Approved
            {visibleApproved.length > 0 && (
              <StatusPill tone="success">{visibleApproved.length}</StatusPill>
            )}
          </h3>
          {visibleApproved.length === 0 ? (
            <EmptyState
              className="py-4"
              title={filtered ? "No matching approved reviews." : "No approved reviews yet."}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {approvedPager.visible.map((row) => (
                <div key={row.id} className="flex flex-col gap-1">
                  <ReviewCard
                    row={row}
                    onRevoke={() => handleRevoke(row.id)}
                    onDelete={() => handleDelete(row.id)}
                  />
                  <div className="pl-1">{renderContactLink(row)}</div>
                </div>
              ))}
              <ShowMoreButton pager={approvedPager} noun={["review", "reviews"]} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
