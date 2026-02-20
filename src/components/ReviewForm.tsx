// src/components/ReviewForm.tsx
/**
 * @file ReviewForm.tsx
 * @description Review form that supports verified reviews via booking tokens.
 */

"use client";

import type React from "react";
import { cn } from "@/lib/cn";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";

interface ReviewFormProtectedProps {
  bookingId?: string;
  reviewRequestId?: string;
  token?: string;
  prefillName?: string;
}

/**
 * Protected review form with optional booking or review-request verification
 * @param props - Component props
 * @param props.bookingId - Booking ID for verified reviews from real bookings
 * @param props.reviewRequestId - ReviewRequest ID for verified reviews from manual requests
 * @param props.token - Review token for verification
 * @param props.prefillName - Pre-fill customer name
 * @returns Review form element
 */
export default function ReviewFormProtected({
  bookingId,
  reviewRequestId,
  token,
  prefillName,
}: ReviewFormProtectedProps): React.ReactElement {
  const router = useRouter();
  const firstId = useId();
  const lastId = useId();
  const anonId = useId();
  const textId = useId();

  const isVerified = !!((bookingId || reviewRequestId) && token);
  const nameParts = prefillName?.split(" ") || [];
  const defaultFirst = nameParts[0] || "";
  const defaultLast = nameParts.slice(1).join(" ") || "";

  const [firstName, setFirstName] = useState(defaultFirst);
  const [lastName, setLastName] = useState(defaultLast);
  const [text, setText] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const textMax = 600;
  const textMin = 10;
  const textCount = text.length;

  /**
   * Submit handler
   * @param e - Form event
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErrorMsg(null);
    setSent(false);

    const t = text.trim();
    const f = firstName.trim();
    const l = lastName.trim();

    // Validation
    if (!t) {
      setErrorMsg("Please write a short review.");
      return;
    }
    if (t.length < textMin) {
      setErrorMsg(`Review must be at least ${textMin} characters.`);
      return;
    }
    if (t.length > textMax) {
      setErrorMsg(`Review must be ${textMax} characters or less.`);
      return;
    }
    if (!isAnonymous && !f) {
      setErrorMsg("First name is required unless posting anonymously.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: t,
          firstName: isAnonymous ? null : f,
          lastName: isAnonymous ? null : l,
          isAnonymous,
          bookingId: isVerified ? bookingId : undefined,
          reviewRequestId: isVerified ? reviewRequestId : undefined,
          reviewToken: isVerified ? token : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const errorMessage = data?.error || `Request failed with ${res.status}`;
        throw new Error(errorMessage);
      }

      setSent(true);

      // Redirect to thank you page after 2 seconds
      setTimeout(() => {
        router.push("/");
      }, 2000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={loading} className={cn("space-y-4")}>
      {/* Verified badge */}
      {isVerified && (
        <div
          className={cn(
            "border-moonstone-500/50 bg-moonstone-600/10 text-moonstone-600 flex items-center gap-2 rounded-lg border p-3 text-sm",
          )}
        >
          <svg className={cn("h-5 w-5")} fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className={cn("font-semibold")}>Verified Review</span>
          <span className={cn("text-moonstone-600/80")}>
            • Your review will be marked as verified
          </span>
        </div>
      )}

      {/* Status */}
      {(errorMsg || sent) && (
        <div
          role="status"
          className={cn(
            "rounded-lg border p-3 text-sm",
            errorMsg
              ? "border-coquelicot-500/50 bg-coquelicot-500/10 text-coquelicot-500"
              : "border-moonstone-500/50 bg-moonstone-600/10 text-moonstone-600",
          )}
        >
          {errorMsg ??
            "Thanks for your review! It will appear on the site after approval. Redirecting..."}
        </div>
      )}

      {/* Identity */}
      <div
        className={cn("border-seasalt-400/60 bg-seasalt-900/60 space-y-4 rounded-xl border p-4")}
      >
        <div className={cn("flex items-center gap-3")}>
          <input
            id={anonId}
            type="checkbox"
            className={cn("accent-moonstone-600 h-4 w-4")}
            checked={isAnonymous}
            onChange={(e) => setIsAnonymous(e.target.checked)}
            disabled={loading}
          />
          <label htmlFor={anonId} className={cn("text-rich-black text-sm font-semibold")}>
            Post as Anonymous
          </label>
        </div>

        <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2")}>
          <div className={cn(isAnonymous && "opacity-60")}>
            <label
              htmlFor={firstId}
              className={cn("text-rich-black mb-1 block text-sm font-semibold")}
            >
              First name {!isAnonymous && <span className={cn("text-coquelicot-500")}>*</span>}
            </label>
            <input
              id={firstId}
              className={cn(
                "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
                "w-full rounded-md border px-3 py-2 outline-none focus:ring-2",
              )}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={60}
              required={!isAnonymous}
              disabled={loading || isAnonymous}
            />
          </div>
          <div className={cn(isAnonymous && "opacity-60")}>
            <label
              htmlFor={lastId}
              className={cn("text-rich-black mb-1 block text-sm font-semibold")}
            >
              Last name
            </label>
            <input
              id={lastId}
              className={cn(
                "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
                "w-full rounded-md border px-3 py-2 outline-none focus:ring-2",
              )}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={60}
              disabled={loading || isAnonymous}
            />
          </div>
        </div>
      </div>

      {/* Review */}
      <div className={cn("border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-4")}>
        <div className={cn("flex items-baseline justify-between gap-3")}>
          <label htmlFor={textId} className={cn("text-rich-black block text-sm font-semibold")}>
            Review <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <span
            className={cn(
              "text-rich-black/60 text-[11px] tabular-nums",
              textCount > textMax
                ? "text-coquelicot-500"
                : textCount < textMin && textCount > 0
                  ? "text-coquelicot-500/70"
                  : "",
            )}
            aria-live="polite"
          >
            {textCount}/{textMax} {textCount > 0 && textCount < textMin && `(min ${textMin})`}
          </span>
        </div>

        <textarea
          id={textId}
          placeholder={`Share your experience (at least ${textMin} characters)...`}
          className={cn(
            "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
            "min-h-35 mt-1 w-full rounded-md border px-3 py-2 outline-none focus:ring-2",
          )}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={textMax}
          required
          disabled={loading}
        />

        <div className={cn("mt-3 flex items-center justify-between")}>
          <p className={cn("text-rich-black/70 text-[12px]")}>
            Be specific and constructive. No private info.
          </p>
          <button
            type="submit"
            disabled={loading || textCount < textMin}
            className={cn(
              "bg-russian-violet text-seasalt rounded-md px-4 py-2 text-sm font-semibold",
              "hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {loading ? "Sending..." : "Send review"}
          </button>
        </div>
      </div>
    </form>
  );
}
