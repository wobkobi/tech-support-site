"use client";
// src/shared/components/EmailInput.tsx
/**
 * @file EmailInput.tsx
 * @description Shared email input with consistent blur-validation and inline
 * error display, keeping validation and typo-suggestion behaviour identical
 * across every email field even when wording differs.
 */

import { validateEmail } from "@/features/booking/lib/booking";
import { cn } from "@/shared/lib/cn";
import { suggestEmailCorrection } from "@/shared/lib/email-typo-suggestion";
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
  "focus:border-russian-violet focus:outline-none focus:ring-2 focus:ring-russian-violet/30",
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
  const activeError = error !== undefined ? error : internalError;
  const describedBy = activeError ? (errorId ?? `${id}-error`) : undefined;

  /**
   * Runs validateEmail on blur and stashes the result in internal state, then
   * forwards the event to the caller's onBlur if provided. Also computes a
   * "did you mean…?" suggestion when the address is otherwise well-formed.
   * @param e - Blur event.
   */
  function handleBlur(e: React.FocusEvent<HTMLInputElement>): void {
    const result = validateEmail(value);
    if (result === "invalid") {
      setInternalError(errorMessages?.invalid ?? DEFAULT_INVALID);
    } else if (result === "too-long") {
      setInternalError(errorMessages?.tooLong ?? DEFAULT_TOO_LONG);
    } else {
      setInternalError(null);
    }
    setSuggestion(result === "ok" ? suggestEmailCorrection(value) : null);
    onBlur?.(e);
  }

  /**
   * Clears the internal error + any typo suggestion when the user edits the
   * field, then forwards the new value to the caller.
   * @param next - New input value.
   */
  function handleChange(next: string): void {
    if (internalError) setInternalError(null);
    if (suggestion) setSuggestion(null);
    onChange(next);
  }

  /**
   * Apply the suggested correction. Surfaces the change through onChange so
   * the parent's controlled state updates, then clears the suggestion.
   */
  function acceptSuggestion(): void {
    if (!suggestion) return;
    onChange(suggestion);
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
        <p id={describedBy} className={cn("text-coquelicot-600 mt-1 text-xs")}>
          {activeError}
        </p>
      )}
      {!activeError && suggestion && (
        <p className={cn("text-rich-black/80 mt-1 text-sm")}>
          Did you mean{" "}
          <button
            type="button"
            onClick={acceptSuggestion}
            className={cn(
              "text-russian-violet font-semibold underline underline-offset-2",
              "hover:text-russian-violet/80 focus:ring-russian-violet/30 rounded focus:outline-none focus:ring-2",
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
