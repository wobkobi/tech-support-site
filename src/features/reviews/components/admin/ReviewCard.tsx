"use client";
// src/features/reviews/components/admin/ReviewCard.tsx
/**
 * @file ReviewCard.tsx
 * @description Single review card with approve/revoke/delete actions.
 */

import { useState, useRef, useEffect } from "react";
import { SOFT_CARD } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import { type ReviewRow, formatDate } from "./review-types";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    /**
     * Closes the menu when a click occurs outside the menu element.
     * @param e - The mouse event.
     */
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

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
        headers: { "Content-Type": "application/json", "X-Admin-Secret": token },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Request failed");
      if (action === "approve") onApprove?.();
      else onRevoke?.();
    } catch {
      setError("Something went wrong.");
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
      const res = await fetch(`/api/admin/reviews/${row.id}`, {
        method: "DELETE",
        headers: { "X-Admin-Secret": token },
      });
      if (!res.ok) throw new Error("Request failed");
      onDelete();
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className={cn(SOFT_CARD, "flex flex-col gap-3")}>
      {/* Header row */}
      <div className={cn("flex flex-wrap items-center gap-2")}>
        <span className={cn("text-russian-violet font-semibold")}>{formatReviewerName(row)}</span>
        {row.verified && (
          <span
            className={cn(
              "bg-moonstone-600/20 text-moonstone-600 rounded-full px-2 py-0.5 text-xs font-medium",
            )}
          >
            Verified
          </span>
        )}
        <span className={cn("ml-auto shrink-0 text-xs text-slate-400")}>
          {formatDate(row.createdAt)}
        </span>
      </div>

      {/* Review text */}
      <p className={cn("leading-relaxed text-slate-700")}>{row.text}</p>

      {/* Error */}
      {error && <p className={cn("text-coquelicot-400 text-xs")}>{error}</p>}

      {/* Actions */}
      <div className={cn("flex flex-wrap items-center gap-2")}>
        {`${row.firstName ?? ""} ${row.lastName ?? ""}`.toLowerCase().includes("test") && (
          <button
            onClick={() => {
              if (confirm("Permanently delete this test review? This cannot be undone.")) {
                void remove();
              }
            }}
            disabled={loading !== null}
            className={cn(
              "rounded-lg bg-red-500/20 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/30 disabled:opacity-50",
            )}
          >
            {loading === "delete" ? "Deleting…" : "Delete"}
          </button>
        )}
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

        {/* More actions menu (Revoke + Delete) */}
        <div ref={menuRef} className={cn("relative ml-auto")}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={loading !== null}
            className={cn(
              "rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50",
            )}
            aria-label="More actions"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              className={cn(
                "absolute right-0 z-10 mt-1 flex min-w-32 flex-col rounded-lg border border-slate-200 bg-white shadow-lg",
              )}
            >
              {onRevoke && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void patch("revoke");
                  }}
                  disabled={loading !== null}
                  className={cn(
                    "rounded-t-lg px-4 py-2 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50",
                  )}
                >
                  {loading === "revoke" ? "Revoking…" : "Revoke"}
                </button>
              )}
              {confirmDelete ? (
                <div
                  className={cn(
                    "flex flex-col gap-1 px-4 py-2",
                    onRevoke ? "rounded-b-lg" : "rounded-lg",
                  )}
                >
                  <span className={cn("text-xs text-slate-600")}>Delete permanently?</span>
                  <div className={cn("flex gap-3")}>
                    <button
                      type="button"
                      disabled={loading !== null}
                      onClick={() => {
                        setMenuOpen(false);
                        void remove();
                      }}
                      className={cn(
                        "text-coquelicot-500 text-xs font-semibold disabled:opacity-50",
                      )}
                    >
                      {loading === "delete" ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className={cn("text-xs text-slate-400 hover:text-slate-600")}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={loading !== null}
                  className={cn(
                    "text-coquelicot-500 hover:bg-coquelicot-500/10 px-4 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50",
                    onRevoke ? "rounded-b-lg" : "rounded-lg",
                  )}
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
