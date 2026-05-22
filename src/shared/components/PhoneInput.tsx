"use client";
// src/shared/components/PhoneInput.tsx
/**
 * @file PhoneInput.tsx
 * @description Shared NZ phone input. On blur, formats the value with
 * formatNZPhone and runs validatePhone so every form on the site behaves
 * identically. Per-form wording can be customised via errorMessages.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZPhone, validatePhone } from "@/shared/lib/normalise-phone";

interface PhoneInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  autoComplete?: string;
  /**
   * Externally-controlled error. When supplied (including null), overrides the
   * internal blur error. Pass `undefined` (the default) to let the component
   * own its blur error.
   */
  error?: string | null;
  /** Wording override for blur errors. */
  errorMessages?: { invalid?: string };
  /** Extra Tailwind classes appended to the default input styles. */
  className?: string;
  /** Skip rendering the inline error <p>. */
  hideError?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  disabled?: boolean;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** ARIA describedby id forwarded to the input when an error is shown. */
  errorId?: string;
}

const DEFAULT_INVALID = "Enter a valid phone number.";

const DEFAULT_INPUT_CLASSES = cn(
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800",
  "focus:border-russian-violet focus:outline-none focus:ring-2 focus:ring-russian-violet/30",
);

/**
 * Controlled NZ phone input with blur formatting + shared validation.
 * @param props - Component props.
 * @param props.id - DOM id, also used as the default ARIA describedby id.
 * @param props.value - Current input value.
 * @param props.onChange - Called with the new value on every keystroke and on blur-format.
 * @param props.required - HTML required + aria-required when true.
 * @param props.maxLength - HTML maxLength attribute; defaults to 32.
 * @param props.placeholder - HTML placeholder; defaults to "021 123 4567".
 * @param props.autoComplete - autocomplete token; defaults to "tel".
 * @param props.error - Externally-controlled error; overrides the internal blur error when supplied.
 * @param props.errorMessages - Per-form wording override for the invalid-phone message.
 * @param props.className - Extra Tailwind classes appended to the default input styles.
 * @param props.hideError - Skip rendering the inline error paragraph.
 * @param props.inputRef - Ref forwarded to the underlying input element.
 * @param props.disabled - HTML disabled attribute.
 * @param props.onBlur - Called after the internal blur handler runs.
 * @param props.errorId - Override for the aria-describedby id when an error is shown.
 * @returns Phone input element.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  required,
  maxLength = 32,
  placeholder = "021 123 4567",
  autoComplete = "tel",
  error,
  errorMessages,
  className,
  hideError,
  inputRef,
  disabled,
  onBlur,
  errorId,
}: PhoneInputProps): React.ReactElement {
  const [internalError, setInternalError] = useState<string | null>(null);
  const activeError = error !== undefined ? error : internalError;
  const describedBy = activeError ? (errorId ?? `${id}-error`) : undefined;

  /**
   * On blur: format the value via formatNZPhone (so the user sees the NZ
   * spacing) then run validatePhone and stash the result in internal state.
   * @param e - Blur event.
   */
  function handleBlur(e: React.FocusEvent<HTMLInputElement>): void {
    const raw = e.target.value;
    if (raw.trim()) {
      const formatted = formatNZPhone(raw);
      if (formatted !== raw) onChange(formatted);
    }
    const check = validatePhone(raw);
    if (check.result === "invalid") {
      setInternalError(errorMessages?.invalid ?? DEFAULT_INVALID);
    } else {
      setInternalError(null);
    }
    onBlur?.(e);
  }

  /**
   * Clears internal error when the user edits, then forwards the new value.
   * @param next - New input value.
   */
  function handleChange(next: string): void {
    if (internalError) setInternalError(null);
    onChange(next);
  }

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="tel"
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
    </>
  );
}
