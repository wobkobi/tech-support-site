// src/features/reviews/components/ReviewForm.tsx
/**
 * @description Review form that supports verified reviews via booking tokens.
 */

"use client";

import { Button } from "@/shared/components/Button";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import { formatNZPhone, normalisePhone, validatePhone } from "@/shared/lib/normalise-phone";
import type React from "react";
import { useId, useState } from "react";

type NameDisplay = "name" | "anonymous";

interface ReviewFormProtectedProps {
  bookingId?: string;
  contactId?: string;
  token?: string;
  prefillName?: string;
  /** Pre-filled email from the booking or contact record */
  prefillEmail?: string;
  /** Pre-filled phone from the contact record */
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
 * Protected review form with optional booking or contact verification.
 * @param props - Component props.
 * @param props.bookingId - Booking ID for verified reviews tied to an appointment.
 * @param props.contactId - Contact ID for verified reviews from manual admin sends.
 * @param props.token - Customer's review token (NOT the admin secret) used to verify the submission.
 * @param props.prefillName - Pre-fill customer name.
 * @param props.prefillEmail - Pre-fill email from booking/contact.
 * @param props.prefillPhone - Pre-fill phone from contact.
 * @param props.existingReview - Existing review data for editing.
 * @returns Review form element.
 */
export default function ReviewFormProtected({
  bookingId,
  contactId,
  token,
  prefillName,
  prefillEmail,
  prefillPhone,
  existingReview,
}: ReviewFormProtectedProps): React.ReactElement {
  // Stable literal ids for fields the error summary links to, so the "#id"
  // anchors are URL-safe fragments (useId tokens are not). Unlinked fields
  // keep generated ids.
  const firstId = "review-first-name";
  const lastId = useId();
  const textId = "review-text";
  const emailId = useId();
  const phoneId = "review-phone";
  const counterId = `${textId}-counter`;

  const isEditing = !!existingReview;
  const isVerified = !!((bookingId || contactId) && token);

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
  /** True when the submission auto-approved, so the copy can say it's already live. */
  const [liveNow, setLiveNow] = useState(false);

  const textMax = 1000;
  const textMin = 10;
  const textCount = text.length;
  const remaining = textMax - textCount;
  const isAnonymous = nameDisplay === "anonymous";

  const phoneInvalid = validatePhone(phoneInput).result === "invalid";

  const NAME_OPTIONS: { value: NameDisplay; label: string }[] = [
    { value: "name", label: "Name" },
    { value: "anonymous", label: "Anonymous" },
  ];

  /**
   * Submit handler. Collects all validation failures into one pass.
   * @param e - Form event
   */
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
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

      // Review fields common to both branches; create (POST) adds the booking/
      // contact identifiers, edit (PATCH) adds the customer ref instead.
      const payload = {
        text: t,
        firstName: isAnonymous ? null : f,
        lastName: isAnonymous ? null : l || null,
        isAnonymous,
        contactEmail: contactEmail.trim() || null,
        contactPhone: normalisePhone(phoneInput) || null,
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
            contactId: isVerified ? contactId : undefined,
            reviewToken: isVerified ? token : undefined,
          }),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Request failed with ${res.status}`);
      }

      // Persistent success view instead of a flash + auto-redirect: a 2-second
      // banner is easy to miss, and being bounced home mid-read gives no chance
      // to see what actually happened.
      const data = (await res.json().catch(() => null)) as { status?: string } | null;
      setLiveNow(data?.status === "approved");
      setSent(true);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const errorEntries = Object.entries(errors);
  const hasFieldErrors = errorEntries.length > 0;

  // Success replaces the form outright - leaving the filled-in fields on screen
  // invites a second submission of the same review.
  if (sent) {
    return (
      <div role="status" className="space-y-4 text-center">
        <p className="text-2xl font-extrabold text-russian-violet sm:text-3xl">
          {isEditing ? "Review updated!" : "Thanks for your review!"}
        </p>
        <p className="text-base text-rich-black/80 sm:text-lg">
          {liveNow
            ? "It's on the site now - thank you, it genuinely helps."
            : isEditing
              ? "It'll reappear on the site soon."
              : "It'll appear on the site soon. Thank you - it genuinely helps."}
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Button href="/" variant="secondary">
            Back to home
          </Button>
          {liveNow && (
            <Button href="/reviews" variant="ghost">
              See all reviews
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={loading} className="space-y-4">
      {/* Verified badge */}
      {isVerified && (
        <div className="flex items-center gap-2 rounded-lg border border-moonstone-500/50 bg-moonstone-600/10 p-3 text-base text-moonstone-600">
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-semibold">Verified Review</span>
          <span className="text-moonstone-600/80">• Your review will be marked as verified</span>
        </div>
      )}

      {/* Status */}
      {hasFieldErrors && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-coquelicot-500/50 bg-coquelicot-500/10 p-3 text-base text-rich-black"
        >
          <p className="font-semibold">Please fix the following:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
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
                    <a href={`#${anchor}`} className="underline">
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
      {/* Success is handled by the view above; only errors surface here. */}
      {!hasFieldErrors && submitError && (
        <div
          role="alert"
          className="rounded-lg border border-coquelicot-500/50 bg-coquelicot-500/10 p-3 text-base text-coquelicot-500"
        >
          {submitError}
        </div>
      )}

      {/* Identity */}
      <div className="space-y-4 rounded-xl border border-seasalt-400/80 bg-seasalt-900/60 p-4">
        {/* Name display options */}
        <div>
          <p className="mb-2 text-base font-semibold text-rich-black">How do you want to appear?</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
            {NAME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={nameDisplay === opt.value}
                disabled={loading}
                onClick={() => setNameDisplay(opt.value)}
                className={cn(
                  "rounded-lg border px-4 py-1.5 text-base font-medium whitespace-nowrap transition-colors",
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
        <p className="text-base text-rich-black/60">
          {"Appears as: "}
          <span className="font-semibold text-russian-violet">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={firstId}
                className="mb-1 block text-base font-semibold text-rich-black"
              >
                First name <span className="text-coquelicot-500">*</span>
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
                <p id={`${firstId}-error`} className="mt-1 text-base text-coquelicot-500">
                  {errors.firstName}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor={lastId}
                className="mb-1 block text-base font-semibold text-rich-black"
              >
                Last name <span className="font-normal text-rich-black/50">(optional)</span>
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
      <div className="space-y-3 rounded-xl border border-seasalt-400/80 bg-seasalt-900/60 p-4">
        <div>
          <p className="text-base font-semibold text-rich-black">
            Stay in touch <span className="font-normal text-rich-black/40">(optional)</span>
          </p>
          <p className="mt-0.5 text-base text-rich-black/50">
            Leave your number or email if you'd like me to be able to reach you - totally up to you.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={phoneId} className="mb-1 block text-base font-semibold text-rich-black">
              Phone
            </label>
            <PhoneInput
              id={phoneId}
              value={phoneInput}
              onChange={setPhoneInput}
              disabled={loading}
              errorMessages={{ invalid: "Doesn't look right - check the number." }}
              className={cn(
                "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
                "border px-3 py-2 focus:ring-2",
              )}
            />
          </div>

          <div>
            <label htmlFor={emailId} className="mb-1 block text-base font-semibold text-rich-black">
              Email
            </label>
            <EmailInput
              id={emailId}
              value={contactEmail}
              onChange={setContactEmail}
              placeholder="you@example.com"
              disabled={loading}
              className={cn(
                "border-seasalt-400/60 bg-seasalt text-rich-black focus:ring-moonstone-500/50",
                "border px-3 py-2 focus:ring-2",
              )}
            />
          </div>
        </div>
      </div>

      {/* Review */}
      <div className="rounded-xl border border-seasalt-400/80 bg-seasalt-900/60 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={textId} className="block text-base font-semibold text-rich-black">
            Review <span className="text-coquelicot-500">*</span>
          </label>
          <span
            id={counterId}
            className={cn(
              "tabular-nums transition-all duration-200",
              textCount > textMax
                ? "text-sm font-bold text-coquelicot-500"
                : remaining <= 50
                  ? "text-sm font-semibold text-coquelicot-500"
                  : remaining <= 150
                    ? "text-sm font-medium text-coquelicot-500/80"
                    : textCount > 0 && textCount < textMin
                      ? "text-sm text-coquelicot-500/80"
                      : "text-sm text-rich-black/70",
            )}
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
            "mt-1 min-h-35 w-full rounded-md border px-3 py-2 outline-none focus:ring-2",
            errors.text && "border-coquelicot-500/60",
          )}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={textMax}
          required
          disabled={loading}
          aria-invalid={!!errors.text || undefined}
          aria-describedby={cn(counterId, errors.text && `${textId}-error`)}
        />
        {errors.text && (
          <p id={`${textId}-error`} className="mt-1 text-base text-coquelicot-500">
            {errors.text}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between">
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            aria-busy={loading}
            disabled={loading}
          >
            {loading ? "Sending..." : isEditing ? "Update review" : "Send review"}
          </Button>
        </div>
      </div>
    </form>
  );
}
