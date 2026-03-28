"use client";
// src/features/reviews/components/admin/ReviewApprovalList.tsx
/**
 * @file ReviewApprovalList.tsx
 * @description Interactive client component for approving, revoking, and deleting reviews.
 */

import { useState } from "react";
import type React from "react";
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
  /** Email address */
  email: string;
  /** Number of reviews already linked to this contact */
  reviewCount: number;
}

/**
 * Props for ReviewApprovalList component.
 */
interface ReviewApprovalListProps {
  /** Reviews pending approval */
  pending: ReviewRow[];
  /** Already-approved reviews */
  approved: ReviewRow[];
  /** Admin token for API calls */
  token: string;
  /** Contacts available for linking to reviews */
  contacts: ContactPickerEntry[];
}

/**
 * Renders the full admin review list with pending and approved sections.
 * Uses optimistic UI - cards are moved/removed immediately on action.
 * @param props - Component props.
 * @param props.pending - Reviews awaiting approval.
 * @param props.approved - Already-approved reviews.
 * @param props.token - Admin token.
 * @param props.contacts - Contacts available for linking.
 * @returns Review approval list element.
 */
export function ReviewApprovalList({
  pending: initialPending,
  approved: initialApproved,
  token,
  contacts,
}: ReviewApprovalListProps): React.ReactElement {
  const [pending, setPending] = useState<ReviewRow[]>(initialPending);
  const [approved, setApproved] = useState<ReviewRow[]>(initialApproved);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkSaving, setLinkSaving] = useState<string | null>(null);

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
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Secret": token,
        },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) return;
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
    } catch {
      // silently ignore
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
            className="border-seasalt-400/80 bg-seasalt text-rich-black focus:border-russian-violet focus:ring-russian-violet/30 rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1"
          >
            <option value="">-- no contact --</option>
            {contacts
              .filter((c) => c.id !== row.contactId && c.reviewCount === 0)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email})
                </option>
              ))}
          </select>
          <button
            onClick={() => setLinkingId(null)}
            className="text-rich-black/40 hover:text-rich-black/60 text-xs"
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
          className="bg-moonstone-600/10 text-moonstone-600 hover:bg-moonstone-600/20 rounded-full px-2 py-0.5 text-xs font-medium transition-colors"
          title="Change linked contact"
        >
          {row.contactName}
        </button>
      );
    }

    return (
      <button
        onClick={() => setLinkingId(row.id)}
        className="text-russian-violet/50 hover:text-russian-violet rounded px-1 py-0.5 text-xs transition-colors"
      >
        Link contact
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Send review link to past client */}
      <SendReviewLinkForm token={token} />

      {/* Pending */}
      <section>
        <h2 className="text-russian-violet mb-3 text-lg font-bold">
          Pending{" "}
          {pending.length > 0 && (
            <span className="bg-coquelicot-500/20 text-coquelicot-400 ml-1 rounded-full px-2 py-0.5 text-sm">
              {pending.length}
            </span>
          )}
        </h2>
        {pending.length === 0 ? (
          <p className="text-seasalt-300 text-sm">No reviews pending approval.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((row) => (
              <div key={row.id} className="flex flex-col gap-1">
                <ReviewCard
                  row={row}
                  token={token}
                  onApprove={() => handleApprove(row.id)}
                  onDelete={() => handleDelete(row.id)}
                />
                <div className="pl-1">{renderContactLink(row)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <hr className="border-seasalt-400/30" />

      {/* Approved */}
      <section>
        <h2 className="text-russian-violet mb-3 text-lg font-bold">
          Approved{" "}
          {approved.length > 0 && (
            <span className="bg-moonstone-600/20 text-moonstone-600 ml-1 rounded-full px-2 py-0.5 text-sm">
              {approved.length}
            </span>
          )}
        </h2>
        {approved.length === 0 ? (
          <p className="text-seasalt-300 text-sm">No approved reviews yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {approved.map((row) => (
              <div key={row.id} className="flex flex-col gap-1">
                <ReviewCard
                  row={row}
                  token={token}
                  onRevoke={() => handleRevoke(row.id)}
                  onDelete={() => handleDelete(row.id)}
                />
                <div className="pl-1">{renderContactLink(row)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Barrel exports for backward compatibility
export type { ReviewRow } from "./review-types";
