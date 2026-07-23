"use client";
// src/features/reviews/components/admin/ReviewCard.tsx
/**
 * @description Single review card with approve/revoke/delete actions.
 */

import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { SOFT_CARD } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { type ReviewRow } from "./review-types";

/**
 * Props for the {@link ReviewCard} component.
 */
interface ReviewCardProps {
  /** Review data */
  row: ReviewRow;
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
 * @param props.onApprove - Callback when review is approved.
 * @param props.onRevoke - Callback when review approval is revoked.
 * @param props.onDelete - Callback when review is deleted.
 * @returns Review card element.
 */
export function ReviewCard({
  row,
  onApprove,
  onRevoke,
  onDelete,
}: ReviewCardProps): React.ReactElement {
  const { toast } = useToast();
  const [loading, setLoading] = useState<"approve" | "revoke" | "delete" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    /**
     * Closes the menu when a click occurs outside the menu element.
     * @param e - The mouse event.
     */
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
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
    try {
      const res = await fetch(`/api/admin/reviews/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Request failed");
      if (action === "approve") onApprove?.();
      else onRevoke?.();
    } catch {
      toast("Something went wrong.", { tone: "error" });
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
    try {
      const res = await fetch(`/api/admin/reviews/${row.id}`, { method: "DELETE", headers: {} });
      if (!res.ok) throw new Error("Request failed");
      onDelete();
    } catch {
      toast("Something went wrong.", { tone: "error" });
    } finally {
      setLoading(null);
      setConfirmOpen(false);
    }
  }

  const isTest = `${row.firstName ?? ""} ${row.lastName ?? ""}`.toLowerCase().includes("test");

  return (
    <div className={cn(SOFT_CARD, "flex flex-col gap-3")}>
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-russian-violet">{formatReviewerName(row)}</span>
        {row.verified && <StatusPill tone="success">Verified</StatusPill>}
        <span className="ml-auto shrink-0 text-xs text-slate-400">
          {formatDateShort(row.createdAt)}
        </span>
      </div>

      {/* Review text */}
      <p className="leading-relaxed text-slate-700">{row.text}</p>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Test reviews get a quick delete; both delete paths open the confirm. */}
        {isTest && (
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={loading !== null}
            className="rounded-lg bg-red-500/20 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/30 disabled:opacity-50"
          >
            {loading === "delete" ? "Deleting…" : "Delete"}
          </button>
        )}
        {onApprove && (
          <button
            onClick={() => patch("approve")}
            disabled={loading !== null}
            className="rounded-lg bg-moonstone-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-moonstone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading === "approve" ? "Approving…" : "Approve"}
          </button>
        )}

        {/* More actions menu (Revoke + Delete) */}
        <div ref={menuRef} className="relative ml-auto">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={loading !== null}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="More actions"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 flex min-w-32 flex-col rounded-lg border border-slate-200 bg-white shadow-lg">
              {onRevoke && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void patch("revoke");
                  }}
                  disabled={loading !== null}
                  className="rounded-t-lg px-4 py-2 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50"
                >
                  {loading === "revoke" ? "Revoking…" : "Revoke"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmOpen(true);
                }}
                disabled={loading !== null}
                className={cn(
                  "px-4 py-2 text-left text-sm font-medium text-coquelicot-400 transition-colors hover:bg-coquelicot-500/10 disabled:opacity-50",
                  onRevoke ? "rounded-b-lg" : "rounded-lg",
                )}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this review?"
        body="This permanently deletes the review and cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={loading === "delete"}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
