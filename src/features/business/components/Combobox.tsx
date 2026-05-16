"use client";
// src/features/business/components/Combobox.tsx
/**
 * @file Combobox.tsx
 * @description Open-vocabulary text input with a suggestions panel. Type to
 * filter the suggestions; press Enter, click a suggestion, or just keep typing
 * a brand-new value. The dropdown opens on focus and closes on blur, Escape,
 * or outside-click. Used by the Calculator's task picker for both Device and
 * Action so the operator isn't restricted to a fixed enum.
 */

import { useEffect, useId, useRef, useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";

interface Props {
  /** Current value (controlled). */
  value: string;
  /** Called whenever the value changes (typing or selecting a suggestion). */
  onChange: (value: string) => void;
  /** Existing values shown as suggestions; case-insensitive filter as the user types. */
  suggestions: string[];
  /** Placeholder text. */
  placeholder?: string;
  /** Optional aria label for screen readers. */
  ariaLabel?: string;
  /** Extra className applied to the wrapper. */
  className?: string;
  /** Extra className applied directly to the <input> for sizing/typography overrides. */
  inputClassName?: string;
}

/**
 * Open-vocabulary combobox. Always accepts the typed value as the answer; the
 * suggestions panel only assists, never restricts. Suggestions filter by
 * substring (case-insensitive) and a "Use «typed»" row appears at the top
 * when the typed value isn't already in the list, making the
 * keep-as-typed action explicit.
 * @param props - Component props.
 * @param props.value - Current text value (controlled).
 * @param props.onChange - Called whenever the typed value changes.
 * @param props.suggestions - Existing values shown in the dropdown panel.
 * @param props.placeholder - Placeholder text for the input.
 * @param props.ariaLabel - Accessible label for screen readers.
 * @param props.className - Extra class on the wrapper.
 * @param props.inputClassName - Extra class on the inner input.
 * @returns Combobox element.
 */
export function Combobox({
  value,
  onChange,
  suggestions,
  placeholder,
  ariaLabel,
  className,
  inputClassName,
}: Props): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [rawHighlight, setHighlight] = useState(0);

  // Filter suggestions case-insensitively against the typed value.
  const trimmed = value.trim();
  const filtered = (() => {
    if (!trimmed) return suggestions;
    const q = trimmed.toLowerCase();
    return suggestions.filter((s) => s.toLowerCase().includes(q));
  })();

  // Show a "use as typed" row when the typed value is non-empty and not an exact match.
  const exactMatch = filtered.some((s) => s.toLowerCase() === trimmed.toLowerCase());
  const showCreateRow = trimmed.length > 0 && !exactMatch;

  // Combined option list (create-row first if shown, then suggestions).
  const options: { value: string; label: string; isCreate: boolean }[] = [
    ...(showCreateRow ? [{ value: trimmed, label: `Use "${trimmed}"`, isCreate: true }] : []),
    ...filtered.map((s) => ({ value: s, label: s, isCreate: false })),
  ];

  // Clamp the raw highlight so option-list changes never strand the user on
  // an out-of-bounds row, without needing a setState-in-effect.
  const highlight = Math.min(rawHighlight, Math.max(0, options.length - 1));

  // Close on outside click.
  useEffect(() => {
    /**
     * Closes the panel when a click lands outside the wrapper.
     * @param e - Pointer event.
     */
    function handler(e: MouseEvent): void {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /**
   * Selects an option by value, closes the panel, and refocuses the input.
   * @param next - The chosen value.
   */
  function select(next: string): void {
    onChange(next);
    setOpen(false);
  }

  /**
   * Handles arrow-key navigation, Enter to select, Escape to close.
   * @param e - Keyboard event.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(0, options.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (open && options[highlight]) {
        e.preventDefault();
        select(options[highlight].value);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
          inputClassName,
        )}
      />
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg",
          )}
        >
          {options.map((opt, i) => (
            <li
              key={`${opt.isCreate ? "__create__" : "s"}:${opt.value}`}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                // mouseDown so the click registers before the input loses focus.
                e.preventDefault();
                select(opt.value);
              }}
              className={cn(
                "cursor-pointer px-3 py-2",
                i === highlight ? "bg-slate-100" : "bg-white",
                opt.isCreate ? "text-russian-violet font-semibold" : "text-slate-700",
              )}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
