"use client";
// src/shared/components/EmailInput.tsx
/**
 * @description Shared email input with consistent validation and inline error
 * display, keeping validation and typo-suggestion behaviour identical across
 * every email field even when wording differs. Input is lowercased as it is
 * typed - addresses are case-insensitive everywhere the site sends or matches
 * them, and {@link normaliseEmail} is what the server stores.
 */

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
  /**
   * Externally-controlled error. When the prop is supplied (including null),
   * it overrides the component's own blur error. Pass `undefined` (the default)
   * to let the component manage its blur error internally.
   */
  error?: string | null;
  /** Wording overrides for blur errors. */
  errorMessages?: { invalid?: string; tooLong?: string };
  /** Extra Tailwind classes appended to the default input styles. */
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
 * @param props.className - Extra Tailwind classes appended to the default input styles.
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
   * Maps a validateEmail verdict to the message for this field, or null when
   * the address is fine. Blank is never an error here - a missing required
   * field is the submit path's call, not this input's.
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
   * Validates on blur, marks the field touched so later keystrokes validate
   * live, then forwards the event to the caller's onBlur if provided. Also
   * computes a "did you mean…?" suggestion when the address is well-formed.
   * @param e - Blur event.
   */
  function handleBlur(e: React.FocusEvent<HTMLInputElement>): void {
    setTouched(true);
    setInternalError(errorFor(value));
    setSuggestion(validateEmail(value) === "ok" ? suggestEmailCorrection(value) : null);
    onBlur?.(e);
  }

  /**
   * Lowercases the keystroke, re-checks it once the field has been blurred at
   * least once, and forwards the normalised value to the caller. Trailing
   * whitespace from a paste goes too - no valid address contains a space.
   * @param next - New input value.
   */
  function handleChange(next: string): void {
    const normalised = normaliseEmail(next);
    setInternalError(touched ? errorFor(normalised) : null);
    if (suggestion) setSuggestion(null);
    onChange(normalised);
  }

  /**
   * Apply the suggested correction. Surfaces the change through onChange so
   * the parent's controlled state updates, then clears the suggestion.
   */
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
        className={cn(DEFAULT_INPUT_CLASSES, activeError && "border-coquelicot-500/60", className)}
      />
      {!hideError && activeError && (
        <p id={describedBy} role="alert" className="mt-1 text-sm text-coquelicot-400">
          {activeError}
        </p>
      )}
      {!activeError && suggestion && (
        <p className="mt-1 text-sm text-rich-black/80" role="status">
          Did you mean{" "}
          <button
            type="button"
            onClick={acceptSuggestion}
            className={cn(
              "font-semibold text-russian-violet underline underline-offset-2",
              "rounded hover:text-russian-violet/80 focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
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
