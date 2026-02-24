"use client";
// src/components/admin/ReviewCard.tsx
/**
 * @file ReviewCard.tsx
 * @description Single review card with approve/revoke/delete actions.
 */

import { useState } from "react";
import { SOFT_CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import { type ReviewRow, displayName, formatDate } from "./review-types";
import type React from "react";

/**
 * Props for ReviewCard component.
 */
interface ReviewCardProps {
  /** Review data */
  row: ReviewRow;
  /** Admin token for API calls */
  token: string;
  /** Callback when review is approved */
  onApprove?: () => void;
  /** Callback when review approval is revoked */
  onRevoke?: () => void;
  /** Callback when review is deleted */
  onDelete: () => void;
}

/**
 * A single review card with action buttons.
 * @param props - Component props.
 * @param props.row - Review data.
 * @param props.token - Admin token for API calls.
 * @param props.onApprove - Callback when review is approved.
 * @param props.onRevoke - Callback when review approval is revoked.
 * @param props.onDelete - Callback when review is deleted.
 * @returns Review card element.
 */
export function ReviewCard({
  row,
  token,
  onApprove,
  onRevoke,
  onDelete,
}: ReviewCardProps): React.ReactElement {
  const [loading, setLoading] = useState<"approve" | "revoke" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Calls the admin API to approve or revoke a review.
   * @param action - Action to perform: approve or revoke.
   * @returns Promise resolving when the action completes.
   */
  async function patch(action: "approve" | "revoke"): Promise<void> {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, token }),
      });
      if (!res.ok) throw new Error("Request failed");
      if (action === "approve") onApprove?.();
      else onRevoke?.();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(null);
    }
  }

  /**
   * Calls the admin API to permanently delete a review.
   * @returns Promise resolving when the delete completes.
   */
  async function remove(): Promise<void> {
    setLoading("delete");
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${row.id}?token=${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Request failed");
      onDelete();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className={cn(SOFT_CARD, "flex flex-col gap-3")}>
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-russian-violet font-semibold">{displayName(row)}</span>
        {row.verified && (
          <span className="bg-moonstone-600/20 text-moonstone-600 rounded-full px-2 py-0.5 text-xs font-medium">
            Verified
          </span>
        )}
        <span className="text-seasalt-300 ml-auto shrink-0 text-xs">
          {formatDate(row.createdAt)}
        </span>
      </div>

      {/* Review text */}
      <p className="text-seasalt-100 leading-relaxed">{row.text}</p>

      {/* Error */}
      {error && <p className="text-coquelicot-400 text-xs">{error}</p>}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {onApprove && (
          <button
            onClick={() => patch("approve")}
            disabled={loading !== null}
            className={cn(
              "bg-moonstone-600 hover:bg-moonstone-700 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {loading === "approve" ? "Approving…" : "Approve"}
          </button>
        )}
        {onRevoke && (
          <button
            onClick={() => patch("revoke")}
            disabled={loading !== null}
            className={cn(
              "border-seasalt-400/60 hover:bg-seasalt-700 rounded-lg border px-4 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {loading === "revoke" ? "Revoking…" : "Revoke"}
          </button>
        )}
        <button
          onClick={remove}
          disabled={loading !== null}
          className={cn(
            "bg-coquelicot-500 hover:bg-coquelicot-600 ml-auto rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {loading === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
