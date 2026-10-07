"use client";
// src/features/contacts/components/ContactNameInput.tsx
// A customer name box that suggests saved contacts as you type, through the same
// filterContacts search the calculator's Client card uses. Free text still works, so a
// walk-in or someone not in contacts can be typed as-is.

import type { GoogleContact } from "@/features/business/types/business";
import { filterContacts } from "@/features/contacts/lib/contact-search";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

const MAX_SUGGESTIONS = 6;

/**
 * Loads the operator's Google contacts once for {@link ContactNameInput}. A failed
 * fetch leaves the list empty, so the box falls back to plain typing.
 * @returns The contacts, empty until loaded.
 */
export function useGoogleContacts(): GoogleContact[] {
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/business/contacts")
      .then((r) => r.json())
      .then((d: { ok?: boolean; contacts?: GoogleContact[] }) => {
        if (!cancelled && d.ok && d.contacts) setContacts(d.contacts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return contacts;
}

interface Props {
  id: string;
  value: string;
  onChange: (name: string) => void;
  /** Saved contacts to suggest from. */
  contacts: GoogleContact[];
  /**
   * Handles a picked suggestion in place of `onChange`, so a form can set the name and
   * other fields (e.g. email) in one update. Without it, the pick sets the name.
   */
  onPick?: (contact: GoogleContact) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Marks the input invalid, for field-error wiring. */
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Name input with a contact suggestion list under it. Arrow keys move through the
 * list, Enter picks the highlighted one (or keeps the typed name when none is), Escape
 * closes.
 * @param props - Component props.
 * @param props.id - Input id, for its label.
 * @param props.value - Current name.
 * @param props.onChange - Receives every keystroke, and the picked contact's name when there is no `onPick`.
 * @param props.contacts - Saved contacts to suggest from.
 * @param props.onPick - Handles a picked contact instead of `onChange`.
 * @param props.placeholder - Input placeholder.
 * @param props.disabled - Disables the input.
 * @param props.required - Marks the input required.
 * @param props.className - Classes for the input.
 * @param props.invalid - Marks the input invalid.
 * @param props.describedBy - Id of the element describing the input's error.
 * @returns The input with its suggestion list.
 */
export function ContactNameInput({
  id,
  value,
  onChange,
  contacts,
  onPick,
  placeholder,
  disabled = false,
  required = false,
  className,
  invalid,
  describedBy,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  // -1 = nothing highlighted, so Enter keeps the typed name until the operator arrows
  // into the list.
  const [highlight, setHighlight] = useState(-1);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    },
    [],
  );

  const suggestions = useMemo(() => {
    if (!open || !value.trim()) return [];
    const found = filterContacts(contacts, value).slice(0, MAX_SUGGESTIONS);
    // Once the name matches a contact exactly, the list has nothing left to offer.
    return found.length === 1 && found[0]?.name === value ? [] : found;
  }, [open, value, contacts]);

  /**
   * Fills the name from a suggestion. Cancels the pending blur-close so the pick
   * lands before the list hides.
   * @param c - The chosen contact.
   */
  function pick(c: GoogleContact): void {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    if (onPick) onPick(c);
    else onChange(c.name || c.email);
    setOpen(false);
  }

  /**
   * Keyboard navigation while the list is open.
   * @param e - Keyboard event.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter") {
      const target = suggestions[highlight];
      if (target) {
        e.preventDefault();
        pick(target);
      }
    } else if (e.key === "Escape") {
      setHighlight(-1);
      setOpen(false);
    }
  }

  const listId = `${id}-contacts`;
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={suggestions.length > 0 ? listId : undefined}
        aria-activedescendant={suggestions[highlight] ? `${listId}-${highlight}` : undefined}
        aria-autocomplete="list"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(-1);
          setOpen(true);
        }}
        onFocus={() => {
          setHighlight(-1);
          setOpen(true);
        }}
        // Close-on-blur deferred so a tap on a suggestion still lands.
        onBlur={() => {
          blurTimerRef.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
        className={className}
      />
      {suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-lg border border-admin-border-strong bg-admin-surface shadow-lg"
        >
          {suggestions.map((c, i) => (
            <li
              key={c.id || `${c.name}-${c.email}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              // onMouseDown beats the input's onBlur, so the pick lands first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "cursor-pointer border-b border-admin-border px-3 py-2 text-sm text-admin-text last:border-b-0",
                i === highlight && "bg-admin-bg",
              )}
            >
              <span className="font-medium">{c.name || c.email}</span>
              {(c.company || (c.name && c.email)) && (
                <span className="ml-2 text-admin-text-secondary">{c.company || c.email}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
