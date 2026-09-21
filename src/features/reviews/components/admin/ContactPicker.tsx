"use client";
// src/features/reviews/components/admin/ContactPicker.tsx
// Searchable contact picker for linking a review to someone in the contact book.
// Replaces a bare <select> over the whole book: that could not show which contact
// was already linked, could not unlink (re-picking the selected option fires no
// change event), and hid every contact who had reviewed, so a wrong link could
// never be moved to the right person.

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * A slim contact entry for the contact picker.
 */
export interface ContactPickerEntry {
  /** Contact database ID */
  id: string;
  /** Display name */
  name: string;
  /** Email address, or null for phone-only contacts */
  email: string | null;
  /** Number of reviews already linked to this contact */
  reviewCount: number;
}

/**
 * Props for the {@link ContactPicker} component.
 */
interface ContactPickerProps {
  /** The whole contact book to search. */
  contacts: ContactPickerEntry[];
  /** Currently linked contact id, or null when the review is unlinked. */
  value: string | null;
  /** Chosen contact id, or null to unlink. */
  onSelect: (contactId: string | null) => void;
  /** Dismisses the picker without changing anything. */
  onCancel: () => void;
  /** Disables interaction while a save is in flight. */
  busy?: boolean;
}

/** Rows rendered at once. The rest are reachable by narrowing the search. */
const MAX_RESULTS = 40;

/**
 * Searchable single-select contact picker with an explicit unlink row.
 * Opens focused on its search box; Escape or an outside click cancels.
 * @param props - Component props.
 * @param props.contacts - The whole contact book to search.
 * @param props.value - Currently linked contact id, or null.
 * @param props.onSelect - Called with the chosen contact id, or null to unlink.
 * @param props.onCancel - Called when the picker is dismissed unchanged.
 * @param props.busy - Disables interaction while a save is in flight.
 * @returns Contact picker element.
 */
export function ContactPicker({
  contacts,
  value,
  onSelect,
  onCancel,
  busy = false,
}: ContactPickerProps): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [rawHighlight, setHighlight] = useState(0);

  const { options, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = contacts.filter(
      (c) =>
        !q || c.name.toLowerCase().includes(q) || (c.email?.toLowerCase().includes(q) ?? false),
    );
    // The linked contact sorts to the top so its "currently linked" marker is
    // visible without hunting, and unlinking is always the first row.
    const sorted = [...matches].sort((a, b) => {
      if (a.id === value) return -1;
      if (b.id === value) return 1;
      return 0;
    });
    const rows: { id: string | null; label: string; hint: string | null; isCurrent: boolean }[] =
      sorted.slice(0, MAX_RESULTS).map((c) => ({
        id: c.id,
        label: c.name,
        hint:
          c.id === value
            ? "currently linked"
            : c.reviewCount > 0
              ? `${c.reviewCount} review${c.reviewCount === 1 ? "" : "s"} already`
              : c.email,
        isCurrent: c.id === value,
      }));
    return {
      options: value
        ? [{ id: null, label: "Remove link", hint: null, isCurrent: false }, ...rows]
        : rows,
      total: matches.length,
    };
  }, [contacts, query, value]);

  // Clamp rather than reset in an effect, so a shrinking list never strands the
  // highlight out of bounds between renders.
  const highlight = Math.min(rawHighlight, Math.max(0, options.length - 1));

  useEffect(() => {
    /**
     * Cancels the picker when a click lands outside it.
     * @param e - Pointer event.
     */
    function handler(e: MouseEvent): void {
      if (!wrapperRef.current?.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCancel]);

  // Keep the highlighted row in view when arrowing past the visible window.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  /**
   * Handles arrow-key navigation, Enter to choose, Escape to cancel.
   * @param e - Keyboard event.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, options.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[highlight];
      if (opt) onSelect(opt.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        role="combobox"
        // The picker only mounts on an explicit click, so focus is what the operator just asked for.
        autoFocus
        aria-autocomplete="list"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={options.length > 0 ? `${listId}-opt-${highlight}` : undefined}
        aria-label="Search contacts to link"
        placeholder="Search name or email…"
        value={query}
        disabled={busy}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none disabled:opacity-50"
      />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
      >
        {options.length === 0 ? (
          <li className="px-3 py-2 text-xs text-slate-400">No contacts found.</li>
        ) : (
          options.map((opt, i) => (
            <li
              key={opt.id ?? "__unlink__"}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={opt.isCurrent}
              data-highlighted={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                // mouseDown so the choice registers before the input blurs.
                e.preventDefault();
                if (!busy) onSelect(opt.id);
              }}
              className={cn(
                "cursor-pointer px-3 py-2",
                i === highlight ? "bg-slate-100" : "bg-white",
                opt.id === null ? "text-coquelicot-600" : "text-slate-700",
              )}
            >
              <span className={cn("text-sm", opt.isCurrent && "font-semibold")}>{opt.label}</span>
              {opt.hint && <span className="ml-2 text-xs text-slate-400">{opt.hint}</span>}
            </li>
          ))
        )}
        {total > MAX_RESULTS && (
          <li className="px-3 py-2 text-xs text-slate-400">
            {total - MAX_RESULTS} more - keep typing to narrow it down.
          </li>
        )}
      </ul>
    </div>
  );
}
