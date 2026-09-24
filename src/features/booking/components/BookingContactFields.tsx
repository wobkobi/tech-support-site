"use client";
// "Your details" inputs for the booking form: name, email (with the typo
// prompt), phone and meeting type.

import { BOOKING_FIELD_LIMITS } from "@/features/booking/lib/booking";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import { isPlausibleName, normaliseName } from "@/shared/lib/normalise-name";
import type React from "react";

export interface BookingNameFieldProps {
  /** Name as typed. */
  value: string;
  /** Called with the new text on every edit. */
  onChange: (value: string) => void;
  /** Called on blur with the tidied name when tidying changed it. */
  onNormalise: (value: string) => void;
  /** Inline field error, if any. */
  error?: string;
  /** Raises an inline field error (the not-a-full-name nudge on blur). */
  onError: (message: string) => void;
}

/**
 * Customer name input, tidied and sanity-checked on blur.
 * @param props - Component props.
 * @param props.value - Name as typed.
 * @param props.onChange - Called with the new text on every edit.
 * @param props.onNormalise - Called on blur with the tidied name.
 * @param props.error - Inline field error, if any.
 * @param props.onError - Raises an inline field error.
 * @returns The name field.
 */
export function BookingNameField({
  value: name,
  onChange,
  onNormalise,
  error,
  onError,
}: BookingNameFieldProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="booking-name" className="text-base font-semibold text-rich-black">
        Name <span className="text-error">*</span>
      </label>
      <input
        id="booking-name"
        type="text"
        autoComplete="name"
        required
        aria-required
        maxLength={BOOKING_FIELD_LIMITS.name}
        value={name}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          // Tidy casing/spacing in place (like phone formats on blur), then
          // flag obvious non-names so the customer sees it before submit.
          const tidied = normaliseName(name);
          if (tidied !== name) onNormalise(tidied);
          if (tidied && !isPlausibleName(tidied)) {
            onError("Please enter your full name.");
          }
        }}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? "booking-name-error" : undefined}
        className={cn(
          "rounded-md border border-seasalt-200/80 bg-seasalt px-4 py-3 text-base text-rich-black",
          "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
          error && "border-coquelicot-500/60",
        )}
      />
      {error && (
        <p id="booking-name-error" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export interface BookingEmailFieldProps {
  /** Email as typed. */
  value: string;
  /** Called with the new text on every edit. */
  onChange: (value: string) => void;
  /** Called on blur (the returning-customer lookup). */
  onBlur: () => void;
  /** Inline field error, if any. */
  error?: string;
  /** "Pre-filled from your previous booking" line, or null. */
  contactHint: string | null;
  /** Likely correction raised at submit, or null. */
  suggestion: string | null;
  /** Focus target for the "did you mean?" prompt. */
  promptRef: React.Ref<HTMLDivElement>;
  /** Accepts the suggested correction. */
  onAcceptSuggestion: () => void;
  /** Keeps the email as typed. */
  onDismissSuggestion: () => void;
}

/**
 * Customer email input with the contact-lookup hint and the submit-time
 * "did you mean?" typo prompt.
 * @param props - Component props.
 * @param props.value - Email as typed.
 * @param props.onChange - Called with the new text on every edit.
 * @param props.onBlur - Called on blur.
 * @param props.error - Inline field error, if any.
 * @param props.contactHint - Pre-fill hint line, or null.
 * @param props.suggestion - Likely correction raised at submit, or null.
 * @param props.promptRef - Focus target for the "did you mean?" prompt.
 * @param props.onAcceptSuggestion - Accepts the suggested correction.
 * @param props.onDismissSuggestion - Keeps the email as typed.
 * @returns The email field.
 */
export function BookingEmailField({
  value: email,
  onChange,
  onBlur,
  error,
  contactHint,
  suggestion: emailSuggestion,
  promptRef,
  onAcceptSuggestion,
  onDismissSuggestion,
}: BookingEmailFieldProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="booking-email" className="text-base font-semibold text-rich-black">
        Email <span className="text-error">*</span>
      </label>
      <EmailInput
        id="booking-email"
        value={email}
        onChange={onChange}
        onBlur={onBlur}
        error={error}
        errorId="booking-email-error"
        required
        maxLength={BOOKING_FIELD_LIMITS.email}
        errorMessages={{ invalid: "Please enter a valid email address." }}
        className={cn(
          "border border-seasalt-200/80 bg-seasalt px-4 py-3 text-base text-rich-black",
          "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30",
        )}
      />
      {contactHint && <p className="text-sm text-rich-black/70">{contactHint}</p>}
      {emailSuggestion && (
        <div
          ref={promptRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="booking-email-suggestion"
          className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-base"
        >
          <span id="booking-email-suggestion" className="text-rich-black">
            Did you mean <strong>{emailSuggestion}</strong>?
          </span>
          <div className="flex flex-wrap gap-x-4">
            <button
              type="button"
              onClick={onAcceptSuggestion}
              className="min-h-11 font-semibold text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
            >
              Yes, use it
            </button>
            <button
              type="button"
              onClick={onDismissSuggestion}
              className="min-h-11 text-rich-black/80 underline underline-offset-2 hover:text-rich-black"
            >
              No, my email is correct
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface BookingPhoneFieldProps {
  /** Phone as typed. */
  value: string;
  /** Called with the new value on every edit. */
  onChange: (value: string) => void;
  /** True for in-person visits, where a phone number is required. */
  required: boolean;
  /** Inline field error, if any. */
  error?: string;
}

/**
 * Customer phone input; required (with an arrival note) for in-person visits.
 * @param props - Component props.
 * @param props.value - Phone as typed.
 * @param props.onChange - Called with the new value on every edit.
 * @param props.required - True for in-person visits.
 * @param props.error - Inline field error, if any.
 * @returns The phone field.
 */
export function BookingPhoneField({
  value: phone,
  onChange,
  required,
  error,
}: BookingPhoneFieldProps): React.ReactElement {
  return (
    <div id="booking-phone-wrap" className="flex flex-col gap-1.5">
      <label htmlFor="booking-phone" className="text-base font-semibold text-rich-black">
        Phone{" "}
        {required ? (
          <span className="text-error">*</span>
        ) : (
          <span className="text-base text-rich-black/70">(optional)</span>
        )}
      </label>
      <PhoneInput
        id="booking-phone"
        value={phone}
        onChange={onChange}
        required={required}
        error={error}
        errorId="booking-phone-error"
        maxLength={BOOKING_FIELD_LIMITS.phone}
        errorMessages={{ invalid: "Please enter a valid phone number." }}
        className={cn(
          "border border-seasalt-200/80 bg-seasalt px-4 py-3 text-base text-rich-black",
          "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30",
          "sm:max-w-sm",
        )}
      />
      {required && (
        <p className="text-sm text-rich-black/70">
          Needed so I can contact you on arrival (running late, gate codes, etc.).
        </p>
      )}
    </div>
  );
}

export interface BookingMeetingTypeFieldProps {
  /** Chosen meeting type, or "" when not chosen. */
  value: "in-person" | "remote" | "";
  /** Called when the customer picks a meeting type. */
  onChange: (value: "in-person" | "remote") => void;
}

/**
 * In-person / remote toggle.
 * @param props - Component props.
 * @param props.value - Chosen meeting type, or "".
 * @param props.onChange - Called when the customer picks a meeting type.
 * @returns The meeting type fieldset.
 */
export function BookingMeetingTypeField({
  value: meetingType,
  onChange,
}: BookingMeetingTypeFieldProps): React.ReactElement {
  return (
    <fieldset id="booking-meeting-type" className="min-w-0">
      <legend className="mb-2 text-base font-semibold text-rich-black">
        Meeting type <span className="text-error">*</span>
      </legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
        {(
          [
            { value: "in-person", label: "In-person" },
            { value: "remote", label: "Remote" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={meetingType === opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "min-h-11 rounded-lg border px-5 py-2.5 text-base font-medium whitespace-nowrap transition-colors",
              meetingType === opt.value
                ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                : "border-seasalt-200/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
