"use client";

import { useState, useEffect, useRef } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import type { GoogleContact } from "@/features/business/types/business";

interface ContactPickerModalProps {
  token: string;
  onSelect: (contact: GoogleContact) => void;
  onClose: () => void;
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
  const inputRef = useRef<HTMLInputElement>(null);

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

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.email.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4")}
      onClick={onClose}
    >
      <div
        className={cn("flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl")}
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
            placeholder="Search by name or email..."
            className={cn(
              "focus:ring-russian-violet/30 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
            )}
          />
        </div>

        <div className={cn("flex-1 overflow-y-auto")}>
          {loading && (
            <p className={cn("text-rich-black/50 px-4 py-6 text-center text-sm")}>Loading...</p>
          )}
          {error && <p className={cn("px-4 py-6 text-center text-sm text-red-600")}>{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className={cn("text-rich-black/50 px-4 py-6 text-center text-sm")}>
              No contacts found.
            </p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c);
                onClose();
              }}
              className={cn(
                "w-full border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-gray-50",
              )}
            >
              <p className={cn("text-rich-black text-sm font-medium")}>{c.name || c.email}</p>
              {c.email && c.name && <p className={cn("text-rich-black/50 text-xs")}>{c.email}</p>}
              {c.company && <p className={cn("text-rich-black/40 text-xs")}>{c.company}</p>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
