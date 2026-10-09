"use client";
// src/features/reviews/components/admin/ReviewCard.tsx
// Single review card with approve/revoke/delete actions.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ROW_BUTTON_CLS } from "./review-admin-classes";
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
      const res = await fetch(`/api/admin/reviews/${row.id}`, { method: "DELETE" });
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
    <Card padding="sm" className="flex flex-col gap-3 sm:p-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-russian-violet">{formatReviewerName(row)}</span>
        {row.verified && <StatusPill tone="success">Verified</StatusPill>}
        <span className="ml-auto shrink-0 text-sm text-admin-muted">
          {formatDateShort(row.createdAt)}
        </span>
      </div>

      {/* Review text */}
      <p className="text-base leading-relaxed text-admin-text">{row.text}</p>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Test reviews get a quick delete; both delete paths open the confirm. */}
        {isTest && (
          <AdminButton
            variant="danger"
            onClick={() => setConfirmOpen(true)}
            disabled={loading !== null}
            className={ROW_BUTTON_CLS}
          >
            {loading === "delete" ? "Deleting…" : "Delete"}
          </AdminButton>
        )}
        {onApprove && (
          <AdminButton
            variant="outline"
            onClick={() => void patch("approve")}
            disabled={loading !== null}
            className={ROW_BUTTON_CLS}
          >
            {loading === "approve" ? "Approving…" : "Approve"}
          </AdminButton>
        )}

        {/* More actions menu (Revoke + Delete) */}
        <div ref={menuRef} className="relative ml-auto">
          <AdminButton
            variant="secondary"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={loading !== null}
            className={ROW_BUTTON_CLS}
            aria-label="More actions"
          >
            ⋯
          </AdminButton>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 flex min-w-32 flex-col rounded-lg border border-admin-border bg-admin-surface shadow-lg">
              {onRevoke && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void patch("revoke");
                  }}
                  disabled={loading !== null}
                  className="rounded-t-lg px-4 py-2 text-left text-sm font-medium text-admin-text transition-colors hover:bg-admin-bg disabled:opacity-50"
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
                  "px-4 py-2 text-left text-sm font-medium text-coquelicot-600 transition-colors hover:bg-coquelicot-500/10 disabled:opacity-50",
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
    </Card>
  );
}
