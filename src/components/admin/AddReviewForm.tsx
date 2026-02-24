"use client";
// src/components/admin/AddReviewForm.tsx
/**
 * @file AddReviewForm.tsx
 * @description Form for manually adding a past client review.
 */

import { useState } from "react";
import { SOFT_CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import type { ReviewRow } from "./review-types";
import type React from "react";

/**
 * Props for AddReviewForm component.
 */
interface AddReviewFormProps {
  /** Admin token for API calls */
  token: string;
  /** Callback with the new review row when added */
  onAdded: (row: ReviewRow) => void;
}

/**
 * Form for manually adding a past client review.
 * @param props - Component props.
 * @param props.token - Admin token for API calls.
 * @param props.onAdded - Callback with the new review row when added.
 * @returns Add review form element.
 */
export function AddReviewForm({ token, onAdded }: AddReviewFormProps): React.ReactElement {
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
  async function handleSubmit(e: React.SubmitEvent): Promise<void> {
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
        className={cn("text-russian-violet w-full text-left text-sm font-semibold hover:underline")}
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
