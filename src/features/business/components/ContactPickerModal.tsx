"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import type { GoogleContact } from "@/features/business/types/business";

interface ContactPickerModalProps {
  token: string;
  onSelect: (contact: GoogleContact) => void;
  onClose: () => void;
}

/**
 * Ranks a contact against a single search token. Lower scores rank first.
 * Returns Infinity when no field matches (caller filters those out).
 * @param c - Contact to rank.
 * @param token - Lowercased search token.
 * @returns Numeric score (lower = better match) or Infinity.
 */
function scoreContactToken(c: GoogleContact, token: string): number {
  const fields: { value: string; weight: number }[] = [
    { value: c.name?.toLowerCase() ?? "", weight: 0 }, // name matches rank highest
    { value: c.email?.toLowerCase() ?? "", weight: 100 },
    { value: c.company?.toLowerCase() ?? "", weight: 200 },
    { value: c.phone?.toLowerCase() ?? "", weight: 300 },
  ];
  let best = Infinity;
  for (const { value, weight } of fields) {
    if (!value) continue;
    if (value === token)
      best = Math.min(best, weight); // exact = best in field
    else if (value.startsWith(token))
      best = Math.min(best, weight + 1); // prefix
    else if (value.includes(token)) best = Math.min(best, weight + 2); // substring
  }
  return best;
}

/**
 * Modal dialog for searching and selecting a Google contact.
 * @param props - Component props
 * @param props.token - Admin auth token for the contacts API
 * @param props.onSelect - Callback fired when a contact is chosen
 * @param props.onClose - Callback fired when the modal is dismissed
 * @returns Contact picker modal element
 */
export function ContactPickerModal({
  token,
  onSelect,
  onClose,
}: ContactPickerModalProps): React.ReactElement {
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawHighlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    fetch("/api/business/contacts", { headers: { "X-Admin-Secret": token } })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setContacts(d.contacts);
        else setError("Could not load contacts.");
      })
      .catch(() => setError("Could not load contacts."))
      .finally(() => setLoading(false));
  }, [token]);

  // Token-split + scored filter: every space-separated token must match SOME
  // field (name/email/company/phone). Results sort by best total score so
  // exact-name + prefix matches surface first.
  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return [...contacts].sort((a, b) =>
        (a.name || a.email || "").localeCompare(b.name || b.email || ""),
      );
    }
    const scored: { contact: GoogleContact; score: number }[] = [];
    for (const c of contacts) {
      let total = 0;
      let allMatch = true;
      for (const t of tokens) {
        const s = scoreContactToken(c, t);
        if (s === Infinity) {
          allMatch = false;
          break;
        }
        total += s;
      }
      if (allMatch) scored.push({ contact: c, score: total });
    }
    return scored.sort((a, b) => a.score - b.score).map((s) => s.contact);
  }, [contacts, query]);

  // Clamp highlight to valid range without setState-in-effect.
  const highlight = Math.min(rawHighlight, Math.max(0, filtered.length - 1));

  /**
   * Keyboard nav: arrows move highlight, Enter selects, Escape closes.
   * @param e - Keyboard event from the search input.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(Math.min(highlight + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(Math.max(highlight - 1, 0));
    } else if (e.key === "Enter" && filtered[highlight]) {
      e.preventDefault();
      onSelect(filtered[highlight]);
      onClose();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  // Reset highlight when the query changes so the top result is pre-selected.
  // Deferred via queueMicrotask to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    queueMicrotask(() => setHighlight(0));
  }, [query]);

  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4")}
      onClick={onClose}
    >
      <div
        className={cn(
          // Fixed height bracket so the modal doesn't jump/shrink as the
          // search filters the list. List scrolls inside the parent height.
          "flex h-[min(70vh,560px)] w-full max-w-md flex-col rounded-xl bg-white shadow-xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn("flex items-center justify-between border-b px-4 py-3")}>
          <h2 className={cn("text-russian-violet text-base font-semibold")}>Pick a contact</h2>
          <button
            onClick={onClose}
            className={cn("text-rich-black/50 hover:text-rich-black text-xl leading-none")}
          >
            &times;
          </button>
        </div>

        <div className={cn("border-b px-4 py-2")}>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search name, email, company, or phone..."
            className={cn(
              "focus:ring-russian-violet/30 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
            )}
          />
        </div>

        <div ref={listRef} className={cn("flex-1 overflow-y-auto")}>
          {loading && (
            <p className={cn("text-rich-black/50 px-4 py-6 text-center text-sm")}>Loading...</p>
          )}
          {error && <p className={cn("px-4 py-6 text-center text-sm text-red-600")}>{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className={cn("text-rich-black/50 px-4 py-6 text-center text-sm")}>
              No contacts found.
            </p>
          )}
          {filtered.map((c, i) => {
            const isActive = i === highlight;
            return (
              <button
                key={c.id}
                onClick={() => {
                  onSelect(c);
                  onClose();
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "w-full border-b px-4 py-3 text-left transition-colors last:border-b-0",
                  isActive ? "bg-russian-violet/10" : "hover:bg-gray-50",
                )}
              >
                <p className={cn("text-rich-black text-sm font-medium")}>{c.name || c.email}</p>
                {c.email && c.name && <p className={cn("text-rich-black/50 text-xs")}>{c.email}</p>}
                {c.company && <p className={cn("text-rich-black/40 text-xs")}>{c.company}</p>}
              </button>
            );
          })}
        </div>

        {!loading && !error && contacts.length > 0 && (
          <div
            className={cn(
              "flex items-center justify-between gap-3 border-t px-4 py-2 text-xs text-slate-400",
            )}
          >
            <span>
              {filtered.length} of {contacts.length}
            </span>
            <span className={cn("hidden sm:inline")}>
              ↑↓ to navigate &middot; Enter to pick &middot; Esc to close
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
