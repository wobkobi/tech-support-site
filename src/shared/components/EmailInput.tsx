"use client";
// src/shared/components/EmailInput.tsx
// Shared email input with identical validation and typo suggestions everywhere. Lowercases as
// typed, since addresses are case-insensitive across the site.

import { validateEmail } from "@/features/booking/lib/booking";
import { cn } from "@/shared/lib/cn";
import { suggestEmailCorrection } from "@/shared/lib/email-typo-suggestion";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import type React from "react";
import { useState } from "react";

interface EmailInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  autoComplete?: string;
  /** Externally-controlled error; when supplied (even null) it overrides the blur error. */
  error?: string | null;
  /** Wording overrides for blur errors. */
  errorMessages?: { invalid?: string; tooLong?: string };
  /** Input classes that REPLACE the defaults, so a caller's outline focus style survives; the error border still applies. */
  className?: string;
  /** Skip rendering the inline error <p>. */
  hideError?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  disabled?: boolean;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** ARIA describedby id forwarded to the input when an error is shown. */
  errorId?: string;
  /** Override the default input type (e.g. "search" for filtering inputs). */
  type?: string;
}

const DEFAULT_INVALID = "Enter a valid email address.";
const DEFAULT_TOO_LONG = "Email is too long.";

const DEFAULT_INPUT_CLASSES = cn(
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800",
  "focus:border-russian-violet focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
);

/**
 * Controlled email input with shared blur validation.
 * @param props - Component props.
 * @param props.id - DOM id, also used as the default ARIA describedby id.
 * @param props.value - Current input value.
 * @param props.onChange - Called with the new value on every keystroke.
 * @param props.required - HTML required + aria-required when true.
 * @param props.maxLength - HTML maxLength attribute.
 * @param props.placeholder - HTML placeholder attribute.
 * @param props.autoComplete - autocomplete token; defaults to "email".
 * @param props.error - Externally-controlled error; overrides the internal blur error when supplied.
 * @param props.errorMessages - Per-form wording overrides for blur errors.
 * @param props.className - Input classes that replace the default styles.
 * @param props.hideError - Skip rendering the inline error paragraph.
 * @param props.inputRef - Ref forwarded to the underlying input element.
 * @param props.disabled - HTML disabled attribute.
 * @param props.onBlur - Called after the internal blur handler runs.
 * @param props.errorId - Override for the aria-describedby id when an error is shown.
 * @param props.type - Override the input type (e.g. "search" for filtering inputs).
 * @returns Email input element.
 */
export function EmailInput({
  id,
  value,
  onChange,
  required,
  maxLength,
  placeholder,
  autoComplete = "email",
  error,
  errorMessages,
  className,
  hideError,
  inputRef,
  disabled,
  onBlur,
  errorId,
  type = "email",
}: EmailInputProps): React.ReactElement {
  const [internalError, setInternalError] = useState<string | null>(null);
  // Stored separately from the validation error: a typo suggestion is non-
  // blocking and disappears the moment the user edits the field again.
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // Set on first blur. Until then, typing stays silent - flagging "j" as an
  // invalid address the instant someone starts typing is just noise. After it,
  // the error tracks every keystroke so a correction clears it immediately.
  const [touched, setTouched] = useState(false);
  const activeError = error !== undefined ? error : internalError;
  const describedBy = activeError ? (errorId ?? `${id}-error`) : undefined;

  /**
   * Maps a validateEmail verdict to this field's message. Blank is never an error here; the
   * submit path handles required.
   * @param candidate - Address to check.
   * @returns Error message, or null.
   */
  function errorFor(candidate: string): string | null {
    const result = validateEmail(candidate);
    if (result === "invalid") return errorMessages?.invalid ?? DEFAULT_INVALID;
    if (result === "too-long") return errorMessages?.tooLong ?? DEFAULT_TOO_LONG;
    return null;
  }

  /**
   * Validates on blur, marks the field touched for live checks, suggests "did you mean...?"
   * and forwards to the caller's onBlur.
   * @param e - Blur event.
   */
  function handleBlur(e: React.FocusEvent<HTMLInputElement>): void {
    setTouched(true);
    setInternalError(errorFor(value));
    setSuggestion(validateEmail(value) === "ok" ? suggestEmailCorrection(value) : null);
    onBlur?.(e);
  }

  /**
   * Lowercases and trims the value (no valid address has a space), re-checks once touched,
   * and forwards it.
   * @param next - New input value.
   */
  function handleChange(next: string): void {
    const normalised = normaliseEmail(next);
    setInternalError(touched ? errorFor(normalised) : null);
    if (suggestion) setSuggestion(null);
    onChange(normalised);
  }

  /** Applies the suggested correction through onChange, then clears the suggestion. */
  function acceptSuggestion(): void {
    if (!suggestion) return;
    onChange(normaliseEmail(suggestion));
    setSuggestion(null);
    setInternalError(null);
  }

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type={type}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        required={required}
        aria-required={required || undefined}
        aria-invalid={activeError ? true : undefined}
        aria-describedby={describedBy}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className={cn(
          className ?? DEFAULT_INPUT_CLASSES,
          activeError && "border-coquelicot-500/60",
        )}
      />
      {!hideError && activeError && (
        <p id={describedBy} role="alert" className="mt-1 text-sm text-error">
          {activeError}
        </p>
      )}
      {!activeError && suggestion && (
        <p className="mt-1 text-sm text-seasalt-700" role="status">
          Did you mean{" "}
          <button
            type="button"
            onClick={acceptSuggestion}
            className={cn(
              "font-semibold text-russian-violet underline underline-offset-2",
              "rounded hover:text-russian-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet",
            )}
          >
            {suggestion}
          </button>
          ?
        </p>
      )}
    </>
  );
}
