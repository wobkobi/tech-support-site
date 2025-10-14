// src/components/ReviewForm.tsx
"use client";
/**
 * Review form.
 * Cleaner layout, live name preview, character counter, and accessible states.
 * Posts to /api/reviews. Supports anonymous posting that disables name fields.
 */

import { cn } from "@/lib/cn";
import { useId, useState } from "react";

/**
 * Review form that posts to /api/reviews.
 * @param root0 Component props.
 * @param root0.onSubmitDone Callback after successful submit.
 * @returns Review form element.
 */
export default function ReviewForm({
  onSubmitDone,
}: {
  onSubmitDone?: () => void;
}): React.ReactElement {
  const firstId = useId();
  const lastId = useId();
  const anonId = useId();
  const textId = useId();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [text, setText] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const textMax = 600;
  const textCount = text.length;

  /**
   * Submit handler. Sends JSON to /api/reviews.
   * @param e Form submit event to prevent default and post payload.
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErrorMsg(null);
    setSent(false);

    const t = text.trim();
    const f = firstName.trim();
    const l = lastName.trim();
    if (!t) {
      setErrorMsg("Please write a short review.");
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
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Request failed with ${res.status}`);
      }

      setFirstName("");
      setLastName("");
      setText("");
      setIsAnonymous(false);
      setSent(true);
      onSubmitDone?.();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={loading}
      className={cn("mx-auto w-full max-w-[min(100vw-2rem,42rem)] space-y-4")}>
      {/* Status */}
      {(errorMsg || sent) && (
        <div
          role="status"
          className={cn(
            "rounded-lg border p-3 text-sm",
            errorMsg
              ? "border-coquelicot-500/50 bg-coquelicot-500/10 text-coquelicot-500"
              : "border-moonstone-500/50 bg-moonstone-600/10 text-moonstone-600"
          )}>
          {errorMsg ?? "Thanks-your review was sent for moderation."}
        </div>
      )}

      {/* Identity card */}
      <div
        className={cn(
          "border-seasalt-400/60 bg-seasalt-800 space-y-4 rounded-xl border p-4 shadow-sm"
        )}>
        <div className={cn("flex items-center gap-3")}>
          <input
            id={anonId}
            type="checkbox"
            className={cn("accent-moonstone-600 h-4 w-4")}
            checked={isAnonymous}
            onChange={(e) => setIsAnonymous(e.target.checked)}
            disabled={loading}
          />
          <label
            htmlFor={anonId}
            className={cn("text-rich-black text-sm font-semibold")}>
            Post as Anonymous
          </label>
        </div>

        <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2")}>
          <div className={cn(isAnonymous && "opacity-60")}>
            <label
              htmlFor={firstId}
              className={cn(
                "text-rich-black mb-1 block text-sm font-semibold"
              )}>
              First name
            </label>
            <input
              id={firstId}
              name="firstName"
              autoComplete="given-name"
              aria-invalid={
                !isAnonymous && !firstName.trim() ? "true" : "false"
              }
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 text-rich-black focus:ring-moonstone-500/50",
                "w-full rounded-md border px-3 py-2 outline-none focus:ring-2"
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
              className={cn(
                "text-rich-black mb-1 block text-sm font-semibold"
              )}>
              Last name
            </label>
            <input
              id={lastId}
              name="lastName"
              autoComplete="family-name"
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 text-rich-black focus:ring-moonstone-500/50",
                "w-full rounded-md border px-3 py-2 outline-none focus:ring-2"
              )}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={60}
              disabled={loading || isAnonymous}
            />
          </div>
        </div>
      </div>

      {/* Review card */}
      <div
        className={cn(
          "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm"
        )}>
        <div className={cn("flex items-baseline justify-between gap-3")}>
          <label
            htmlFor={textId}
            className={cn("text-rich-black block text-sm font-semibold")}>
            Review
          </label>
          <span
            className={cn(
              "text-rich-black/60 text-[11px] tabular-nums",
              textCount > textMax ? "text-coquelicot-500" : ""
            )}
            aria-live="polite">
            {textCount}/{textMax}
          </span>
        </div>

        <textarea
          id={textId}
          name="text"
          className={cn(
            "border-seasalt-400/60 bg-seasalt-800 text-rich-black focus:ring-moonstone-500/50",
            "mt-1 min-h-[140px] w-full rounded-md border px-3 py-2 outline-none focus:ring-2"
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
            disabled={loading}
            className={cn(
              "bg-russian-violet text-seasalt-800 rounded-md px-4 py-2 text-sm font-semibold",
              "hover:brightness-110 disabled:opacity-60"
            )}>
            {loading ? "Sending..." : "Send review"}
          </button>
        </div>
      </div>
    </form>
  );
}
