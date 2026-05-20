// src/features/reviews/components/ReviewForm.tsx
/**
 * @file ReviewForm.tsx
 * @description Review form that supports verified reviews via booking tokens.
 */

"use client";

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/components/Button";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { formatNZPhone, normalisePhone, isValidPhone } from "@/shared/lib/normalise-phone";

type NameDisplay = "name" | "anonymous";

interface ReviewFormProtectedProps {
  bookingId?: string;
  reviewRequestId?: string;
  token?: string;
  prefillName?: string;
  /** Pre-filled email from the booking or review request record */
  prefillEmail?: string;
  /** Pre-filled phone from the review request record */
  prefillPhone?: string;
  existingReview?: {
    id: string;
    text: string;
    firstName: string | null;
    lastName: string | null;
    isAnonymous: boolean;
  };
}

/**
 * Protected review form with optional booking or review-request verification
 * @param props - Component props
 * @param props.bookingId - Booking ID for verified reviews from real bookings
 * @param props.reviewRequestId - ReviewRequest ID for verified reviews from manual requests
 * @param props.token - Review token for verification
 * @param props.prefillName - Pre-fill customer name
 * @param props.prefillEmail - Pre-fill email from booking/review request
 * @param props.prefillPhone - Pre-fill phone from review request
 * @param props.existingReview - Existing review data for editing
 * @returns Review form element
 */
export default function ReviewFormProtected({
  bookingId,
  reviewRequestId,
  token,
  prefillName,
  prefillEmail,
  prefillPhone,
  existingReview,
}: ReviewFormProtectedProps): React.ReactElement {
  const router = useRouter();
  const firstId = useId();
  const lastId = useId();
  const textId = useId();
  const emailId = useId();
  const phoneId = useId();

  const isEditing = !!existingReview;
  const isVerified = !!((bookingId || reviewRequestId) && token);

  /**
   * Initial name-display mode: keep existing anonymity if editing, otherwise show the name.
   * @returns "anonymous" or "name".
   */
  function initialNameDisplay(): NameDisplay {
    if (existingReview) {
      if (existingReview.isAnonymous) return "anonymous";
    }
    return "name";
  }

  const nameParts = prefillName?.split(" ") || [];
  const defaultFirst = existingReview?.firstName ?? nameParts[0] ?? "";
  const defaultLast = existingReview?.lastName ?? nameParts.slice(1).join(" ") ?? "";

  const [nameDisplay, setNameDisplay] = useState<NameDisplay>(initialNameDisplay);
  const [firstName, setFirstName] = useState(defaultFirst);
  const [lastName, setLastName] = useState(defaultLast);
  const [text, setText] = useState(existingReview?.text ?? "");
  // Contact details - pre-filled from booking/review request if available
  const [contactEmail, setContactEmail] = useState(prefillEmail ?? "");
  // Store raw phone digits internally; display formatted
  const [phoneInput, setPhoneInput] = useState(
    prefillPhone ? formatNZPhone(normalisePhone(prefillPhone)) : "",
  );
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const textMax = 1000;
  const textMin = 10;
  const textCount = text.length;
  const remaining = textMax - textCount;
  const isAnonymous = nameDisplay === "anonymous";

  const phoneNormalized = normalisePhone(phoneInput);
  const phoneInvalid = !!phoneInput.trim() && !isValidPhone(phoneNormalized);

  const NAME_OPTIONS: { value: NameDisplay; label: string }[] = [
    { value: "name", label: "Name" },
    { value: "anonymous", label: "Anonymous" },
  ];

  /**
   * Submit handler. Collects all validation failures into one pass.
   * @param e - Form event
   */
  async function handleSubmit(e: React.SubmitEvent): Promise<void> {
    e.preventDefault();
    setSubmitError(null);
    setSent(false);

    const t = text.trim();
    const f = firstName.trim();
    const l = lastName.trim();

    const fieldErrors: Record<string, string> = {};
    if (!t) {
      fieldErrors.text = "Please write a short review.";
    } else if (t.length < textMin) {
      fieldErrors.text = `Review must be at least ${textMin} characters.`;
    } else if (t.length > textMax) {
      fieldErrors.text = `Review must be ${textMax} characters or less.`;
    }
    if (!isAnonymous && !f) {
      fieldErrors.firstName = "First name is required unless posting anonymously.";
    }
    if (phoneInvalid) {
      fieldErrors.phone = "Please enter a valid phone number or leave it blank.";
    }

    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setLoading(true);
    try {
      let res: Response;

      const payload = {
        text: t,
        firstName: isAnonymous ? null : f,
        lastName: isAnonymous ? null : l || null,
        isAnonymous,
        contactEmail: contactEmail.trim() || null,
        contactPhone: phoneNormalized || null,
      };

      if (isEditing) {
        res = await fetch(`/api/reviews/${existingReview.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, customerRef: token }),
        });
      } else {
        res = await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            bookingId: isVerified ? bookingId : undefined,
            reviewRequestId: isVerified ? reviewRequestId : undefined,
            reviewToken: isVerified ? token : undefined,
          }),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Request failed with ${res.status}`);
      }

      setSent(true);

      setTimeout(() => {
        router.push("/");
      }, 2000);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const errorEntries = Object.entries(errors);
  const hasFieldErrors = errorEntries.length > 0;

  return (
    <form onSubmit={handleSubmit} aria-busy={loading} className={cn("space-y-4")}>
      {/* Verified badge */}
      {isVerified && (
        <div
          className={cn(
            "border-moonstone-500/50 bg-moonstone-600/10 text-moonstone-600 flex items-center gap-2 rounded-lg border p-3 text-base",
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
      {hasFieldErrors && (
        <div
          role="alert"
          aria-live="assertive"
          className={cn(
            "border-coquelicot-500/50 bg-coquelicot-500/10 text-rich-black rounded-lg border p-3 text-base",
          )}
        >
          <p className={cn("font-semibold")}>Please fix the following:</p>
          <ul className={cn("mt-1 list-disc space-y-0.5 pl-5")}>
            {errorEntries.map(([key, msg]) => {
              const anchor =
                key === "text"
                  ? textId
                  : key === "firstName"
                    ? firstId
                    : key === "phone"
                      ? phoneId
                      : undefined;
              return (
                <li key={key}>
                  {anchor ? (
                    <a href={`#${anchor}`} className={cn("underline")}>
                      {msg}
                    </a>
                  ) : (
                    msg
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!hasFieldErrors && (submitError || sent) && (
        <div
          role={submitError ? "alert" : "status"}
          className={cn(
            "rounded-lg border p-3 text-base",
            submitError
              ? "border-coquelicot-500/50 bg-coquelicot-500/10 text-coquelicot-500"
              : "border-moonstone-500/50 bg-moonstone-600/10 text-moonstone-600",
          )}
        >
          {submitError ??
            (isEditing
              ? "Review updated! It will reappear on the site after approval. Redirecting..."
              : "Thanks for your review! It will appear on the site after approval. Redirecting...")}
        </div>
      )}

      {/* Identity */}
      <div
        className={cn("border-seasalt-400/80 bg-seasalt-900/60 space-y-4 rounded-xl border p-4")}
      >
        {/* Name display options */}
        <div>
          <p className={cn("text-rich-black mb-2 text-base font-semibold")}>
            How do you want to appear?
          </p>
          <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
            {NAME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={loading}
                onClick={() => setNameDisplay(opt.value)}
                className={cn(
                  "whitespace-nowrap rounded-lg border px-4 py-1.5 text-base font-medium transition-colors",
                  nameDisplay === opt.value
                    ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                    : "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live name preview */}
        <p className={cn("text-rich-black/60 text-base")}>
          {"Appears as: "}
          <span className={cn("text-russian-violet font-semibold")}>
            {nameDisplay === "anonymous"
              ? "Anonymous"
              : (() => {
                  const f = firstName.trim();
                  const l = lastName.trim();
                  if (!f) return "(enter first name)";
                  return l ? `${f} ${l}` : f;
                })()}
          </span>
        </p>

        {/* Name inputs - hidden when anonymous */}
        {!isAnonymous && (
          <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2")}>
            <div>
              <label
                htmlFor={firstId}
                className={cn("text-rich-black mb-1 block text-base font-semibold")}
              >
                First name <span className={cn("text-coquelicot-500")}>*</span>
              </label>
              <input
                id={firstId}
                type="text"
                autoComplete="given-name"
                className={cn(
                  "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
                  "w-full rounded-md border px-3 py-2 outline-none focus:ring-2",
                  errors.firstName && "border-coquelicot-500/60",
                )}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={60}
                required
                disabled={loading}
                aria-invalid={!!errors.firstName || undefined}
                aria-describedby={errors.firstName ? `${firstId}-error` : undefined}
              />
              {errors.firstName && (
                <p id={`${firstId}-error`} className={cn("text-coquelicot-500 mt-1 text-base")}>
                  {errors.firstName}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor={lastId}
                className={cn("text-rich-black mb-1 block text-base font-semibold")}
              >
                Last name <span className={cn("text-rich-black/50 font-normal")}>(optional)</span>
              </label>
              <input
                id={lastId}
                type="text"
                autoComplete="family-name"
                className={cn(
                  "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
                  "w-full rounded-md border px-3 py-2 outline-none focus:ring-2",
                )}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={60}
                disabled={loading}
              />
            </div>
          </div>
        )}
      </div>

      {/* Optional contact details */}
      <div
        className={cn("border-seasalt-400/80 bg-seasalt-900/60 space-y-3 rounded-xl border p-4")}
      >
        <div>
          <p className={cn("text-rich-black text-base font-semibold")}>
            Stay in touch <span className={cn("text-rich-black/40 font-normal")}>(optional)</span>
          </p>
          <p className={cn("text-rich-black/50 mt-0.5 text-base")}>
            Leave your number or email if you&apos;d like me to be able to reach you - totally up to
            you.
          </p>
        </div>

        <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2")}>
          <div>
            <label
              htmlFor={phoneId}
              className={cn("text-rich-black mb-1 block text-base font-semibold")}
            >
              Phone
            </label>
            <input
              id={phoneId}
              type="tel"
              autoComplete="tel"
              placeholder="021 123 1234"
              className={cn(
                "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
                "w-full rounded-md border px-3 py-2 outline-none focus:ring-2",
                phoneInvalid ? "border-coquelicot-500/60" : "",
              )}
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              onBlur={(e) => setPhoneInput(formatNZPhone(e.target.value))}
              disabled={loading}
              aria-invalid={phoneInvalid || undefined}
              aria-describedby={phoneInvalid ? `${phoneId}-error` : undefined}
            />
            {phoneInvalid && (
              <p id={`${phoneId}-error`} className={cn("text-coquelicot-400 mt-1 text-base")}>
                Doesn&apos;t look right - check the number.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={emailId}
              className={cn("text-rich-black mb-1 block text-base font-semibold")}
            >
              Email
            </label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className={cn(
                "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
                "w-full rounded-md border px-3 py-2 outline-none focus:ring-2",
              )}
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>
      </div>

      {/* Review */}
      <div className={cn("border-seasalt-400/80 bg-seasalt-900/60 rounded-xl border p-4")}>
        <div className={cn("flex items-baseline justify-between gap-3")}>
          <label htmlFor={textId} className={cn("text-rich-black block text-base font-semibold")}>
            Review <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <span
            className={cn(
              "tabular-nums transition-all duration-200",
              textCount > textMax
                ? "text-coquelicot-500 text-sm font-bold"
                : remaining <= 50
                  ? "text-coquelicot-500 text-sm font-semibold"
                  : remaining <= 150
                    ? "text-coquelicot-500/80 text-sm font-medium"
                    : textCount > 0 && textCount < textMin
                      ? "text-coquelicot-500/80 text-sm"
                      : "text-rich-black/70 text-sm",
            )}
            aria-live="polite"
          >
            {textCount}/{textMax}
            {textCount > 0 && textCount < textMin && ` (min ${textMin})`}
          </span>
        </div>

        <textarea
          id={textId}
          autoComplete="off"
          placeholder={`Share your experience (at least ${textMin} characters)...`}
          className={cn(
            "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
            "min-h-35 mt-1 w-full rounded-md border px-3 py-2 outline-none focus:ring-2",
            errors.text && "border-coquelicot-500/60",
          )}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={textMax}
          required
          disabled={loading}
          aria-invalid={!!errors.text || undefined}
          aria-describedby={errors.text ? `${textId}-error` : undefined}
        />
        {errors.text && (
          <p id={`${textId}-error`} className={cn("text-coquelicot-500 mt-1 text-base")}>
            {errors.text}
          </p>
        )}

        <div className={cn("mt-3 flex items-center justify-between")}>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            aria-busy={loading}
            disabled={loading || textCount < textMin || textCount > textMax || phoneInvalid}
          >
            {loading ? "Sending..." : isEditing ? "Update review" : "Send review"}
          </Button>
        </div>
      </div>
    </form>
  );
}
