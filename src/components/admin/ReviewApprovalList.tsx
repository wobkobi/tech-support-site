"use client";
// src/components/admin/ReviewApprovalList.tsx
/**
 * @file ReviewApprovalList.tsx
 * @description Interactive client component for approving, revoking, and deleting reviews.
 */

import { useState } from "react";
import { SOFT_CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import type React from "react";

/**
 * A single review entry from the database.
 */
export interface ReviewRow {
  /** Review database ID */
  id: string;
  /** Review text content */
  text: string;
  /** Reviewer first name */
  firstName: string | null;
  /** Reviewer last name */
  lastName: string | null;
  /** Whether the reviewer posted anonymously */
  isAnonymous: boolean;
  /** Whether the review was verified via a booking token */
  verified: boolean;
  /** Whether the review is currently approved */
  approved: boolean;
  /** Creation timestamp */
  createdAt: Date;
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
}

/**
 * Formats a reviewer's display name.
 * @param row - Review row data.
 * @returns Formatted display name string.
 */
function displayName(row: ReviewRow): string {
  if (row.isAnonymous) return "Anonymous";
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ");
  return name || "Unknown";
}

/**
 * Formats a date as a short localised string.
 * @param date - Date to format.
 * @returns Formatted date string.
 */
function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * A single review card with action buttons.
 * @param props - Component props.
 * @param props.row - Review data.
 * @param props.token - Admin token.
 * @param props.onApprove - Callback when approved.
 * @param props.onRevoke - Callback when revoked.
 * @param props.onDelete - Callback when deleted.
 * @returns Review card element.
 */
function ReviewCard({
  row,
  token,
  onApprove,
  onRevoke,
  onDelete,
}: {
  row: ReviewRow;
  token: string;
  onApprove?: () => void;
  onRevoke?: () => void;
  onDelete: () => void;
}): React.ReactElement {
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
      const res = await fetch(
        `/api/admin/reviews/${row.id}?token=${encodeURIComponent(token)}`,
        { method: "DELETE" },
      );
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
        <span className="text-seasalt-300 ml-auto shrink-0 text-xs">{formatDate(row.createdAt)}</span>
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

/**
 * Form for manually adding a past client review.
 * @param props - Component props.
 * @param props.token - Admin token.
 * @param props.onAdded - Callback with the new review row.
 * @returns Add review form element.
 */
function AddReviewForm({
  token,
  onAdded,
}: {
  token: string;
  onAdded: (row: ReviewRow) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Submits the new review to the admin API.
   * @param e - Form submit event.
   * @returns Promise resolving when the submit completes.
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, text, firstName, lastName, isAnonymous }),
      });
      const data = (await res.json()) as { ok?: boolean; review?: ReviewRow; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      onAdded(data.review!);
      setText("");
      setFirstName("");
      setLastName("");
      setIsAnonymous(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn(SOFT_CARD)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "text-russian-violet w-full text-left text-sm font-semibold hover:underline",
        )}
      >
        {open ? "▲ Cancel" : "+ Add past client review"}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className={cn("mt-4 flex flex-col gap-3")}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Review text (10–600 characters)"
            rows={4}
            required
            className={cn(
              "border-seasalt-400/60 bg-seasalt-800 text-rich-black w-full resize-none rounded-lg border p-3 text-sm focus:outline-none",
            )}
          />

          {!isAnonymous && (
            <div className={cn("flex gap-3")}>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-800 text-rich-black flex-1 rounded-lg border p-3 text-sm focus:outline-none",
                )}
              />
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name (optional)"
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-800 text-rich-black flex-1 rounded-lg border p-3 text-sm focus:outline-none",
                )}
              />
            </div>
          )}

          <label className={cn("flex items-center gap-2 text-sm")}>
            <input
              type="checkbox"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
              className={cn("rounded")}
            />
            <span>Post as Anonymous</span>
          </label>

          {error && <p className={cn("text-coquelicot-400 text-xs")}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "bg-moonstone-600 hover:bg-moonstone-700 self-start rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {loading ? "Adding…" : "Add review"}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Form for sending a review request link to a past client.
 * @param props - Component props.
 * @param props.token - Admin token.
 * @returns Send review link form element.
 */
function SendReviewLinkForm({ token }: { token: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/admin/send-review-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, email }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setSuccess(true);
      setName("");
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn(SOFT_CARD)}>
      <button
        onClick={() => { setOpen((v) => !v); setSuccess(false); setError(null); }}
        className={cn("text-russian-violet w-full text-left text-sm font-semibold hover:underline")}
      >
        {open ? "▲ Cancel" : "+ Send review link to past client"}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className={cn("mt-4 flex flex-col gap-3")}>
          <div className={cn("flex gap-3")}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              required
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 text-rich-black flex-1 rounded-lg border p-3 text-sm focus:outline-none",
              )}
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              required
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 text-rich-black flex-1 rounded-lg border p-3 text-sm focus:outline-none",
              )}
            />
          </div>

          {error && <p className={cn("text-coquelicot-400 text-xs")}>{error}</p>}
          {success && <p className={cn("text-moonstone-600 text-xs")}>Review link sent successfully.</p>}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "bg-moonstone-600 hover:bg-moonstone-700 self-start rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {loading ? "Sending…" : "Send link"}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Renders the full admin review list with pending and approved sections.
 * Uses optimistic UI — cards are moved/removed immediately on action.
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
   * @returns Void.
   */
  function handleApprove(id: string): void {
    const row = pending.find((r) => r.id === id);
    if (!row) return;
    setPending((prev) => prev.filter((r) => r.id !== id));
    setApproved((prev) => [{ ...row, approved: true }, ...prev]);
  }

  /**
   * Moves a review from approved back to pending.
   * @param id - Review ID to revoke.
   * @returns Void.
   */
  function handleRevoke(id: string): void {
    const row = approved.find((r) => r.id === id);
    if (!row) return;
    setApproved((prev) => prev.filter((r) => r.id !== id));
    setPending((prev) => [{ ...row, approved: false }, ...prev]);
  }

  /**
   * Removes a review from whichever list contains it.
   * @param id - Review ID to delete.
   * @returns Void.
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
      <AddReviewForm
        token={token}
        onAdded={(row) => setApproved((prev) => [row, ...prev])}
      />

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
