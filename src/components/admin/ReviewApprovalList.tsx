"use client";
// src/components/admin/ReviewApprovalList.tsx
/**
 * @file ReviewApprovalList.tsx
 * @description Interactive client component for approving, revoking, and deleting reviews.
 */

import { useState } from "react";
import type React from "react";
import type { ReviewRow } from "./review-types";
import { ReviewCard } from "./ReviewCard";
import { AddReviewForm } from "./AddReviewForm";
import { SendReviewLinkForm } from "./SendReviewLinkForm";

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
}

/**
 * Renders the full admin review list with pending and approved sections.
 * Uses optimistic UI - cards are moved/removed immediately on action.
 * @param props - Component props.
 * @param props.pending - Reviews awaiting approval.
 * @param props.approved - Already-approved reviews.
 * @param props.token - Admin token.
 * @returns Review approval list element.
 */
export function ReviewApprovalList({
  pending: initialPending,
  approved: initialApproved,
  token,
}: ReviewApprovalListProps): React.ReactElement {
  const [pending, setPending] = useState<ReviewRow[]>(initialPending);
  const [approved, setApproved] = useState<ReviewRow[]>(initialApproved);

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

  return (
    <div className="flex flex-col gap-8">
      {/* Send review link to past client */}
      <SendReviewLinkForm token={token} />

      {/* Add past review */}
      <AddReviewForm token={token} onAdded={(row) => setApproved((prev) => [row, ...prev])} />

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
              <ReviewCard
                key={row.id}
                row={row}
                token={token}
                onApprove={() => handleApprove(row.id)}
                onDelete={() => handleDelete(row.id)}
              />
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
              <ReviewCard
                key={row.id}
                row={row}
                token={token}
                onRevoke={() => handleRevoke(row.id)}
                onDelete={() => handleDelete(row.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Barrel exports for backward compatibility
export type { ReviewRow } from "./review-types";
