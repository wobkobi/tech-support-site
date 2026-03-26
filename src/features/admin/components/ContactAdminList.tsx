"use client";
// src/features/admin/components/ContactAdminList.tsx
/**
 * @file ContactAdminList.tsx
 * @description Admin component listing contacts saved from booking submissions,
 * with inline editing and Google Places autocomplete for the address field.
 */

import type React from "react";
import { useState } from "react";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { formatReviewerName } from "@/features/reviews/lib/formatting";

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  createdAt: string;
  /** Google People API resource name if synced, or null */
  googleContactId: string | null;
  /** Reviews linked to this contact */
  reviews: Array<{ id: string; text: string; firstName: string | null; lastName: string | null }>;
}

/**
 * Formats an ISO date string as a short NZ local date.
 * @param iso - ISO 8601 date string.
 * @returns Formatted date string.
 */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Editable list of contacts captured from booking submissions.
 * Each row supports inline editing with Google Places autocomplete for the address field.
 * Shows linked reviews and a "Sync to Google" button for contacts not yet synced.
 * @param props - Component props.
 * @param props.contacts - Contact rows to display.
 * @param props.token - Admin token for authenticated PATCH calls.
 * @returns Contact list element.
 */
export function ContactAdminList({
  contacts: initialContacts,
  token,
}: {
  contacts: ContactRow[];
  token: string;
}): React.ReactElement {
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [expandedReviewsId, setExpandedReviewsId] = useState<string | null>(null);

  /**
   * Opens the inline edit form for a contact row.
   * @param c - The contact row to edit.
   */
  function startEdit(c: ContactRow): void {
    setEditingId(c.id);
    setEditName(c.name);
    setEditPhone(c.phone ?? "");
    setEditAddress(c.address ?? "");
  }

  /**
   * Closes the inline edit form without saving.
   */
  function cancelEdit(): void {
    setEditingId(null);
  }

  /**
   * Syncs a contact to Google Contacts via the admin API.
   * On success, updates the local state to reflect synced status.
   * @param id - Contact ID to sync.
   */
  async function syncToGoogle(id: string): Promise<void> {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/admin/contacts/${id}/sync-google`, {
        method: "POST",
        headers: { "X-Admin-Secret": token },
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setContacts((prev) =>
          prev.map((c) => (c.id === id ? { ...c, googleContactId: "synced" } : c)),
        );
      } else {
        console.error("[ContactAdminList] Sync failed:", data.error);
      }
    } catch (err) {
      console.error("[ContactAdminList] Sync network error:", err);
    } finally {
      setSyncingId(null);
    }
  }

  /**
   * Saves the edited contact by calling PATCH and updating local state.
   * @param id - The contact ID being saved.
   */
  async function saveEdit(id: string): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/contacts/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Secret": token,
        },
        body: JSON.stringify({
          name: editName,
          phone: editPhone,
          address: editAddress,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        contact?: {
          id: string;
          name: string;
          email: string;
          phone: string | null;
          address: string | null;
        };
        error?: string;
      };
      if (data.ok && data.contact) {
        setContacts((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  name: data.contact!.name,
                  phone: data.contact!.phone,
                  address: data.contact!.address,
                }
              : c,
          ),
        );
        setEditingId(null);
      } else {
        console.error("[ContactAdminList] Save failed:", data.error);
      }
    } catch (err) {
      console.error("[ContactAdminList] Network error:", err);
    } finally {
      setSaving(false);
    }
  }

  if (contacts.length === 0) {
    return (
      <p className="text-rich-black/40 text-sm">
        No contacts yet. They will appear here after customers book.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {contacts.map((c) =>
        editingId === c.id ? (
          <div
            key={c.id}
            className="border-seasalt-400/30 flex flex-col gap-3 rounded-xl border bg-white/50 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-russian-violet text-xs font-semibold uppercase tracking-wide">
                Editing
              </span>
              <span className="text-rich-black/40 text-xs">{formatDate(c.createdAt)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-russian-violet text-xs font-semibold"
                htmlFor={`edit-name-${c.id}`}
              >
                Name
              </label>
              <input
                id={`edit-name-${c.id}`}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="border-seasalt-400/80 bg-seasalt text-rich-black focus:border-russian-violet focus:ring-russian-violet/30 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-russian-violet text-xs font-semibold"
                htmlFor={`edit-phone-${c.id}`}
              >
                Phone
              </label>
              <input
                id={`edit-phone-${c.id}`}
                type="text"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="border-seasalt-400/80 bg-seasalt text-rich-black focus:border-russian-violet focus:ring-russian-violet/30 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-russian-violet text-xs font-semibold"
                htmlFor={`edit-address-${c.id}`}
              >
                Address
              </label>
              <AddressAutocomplete
                id={`edit-address-${c.id}`}
                value={editAddress}
                onChange={setEditAddress}
                placeholder="Start typing address..."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void saveEdit(c.id)}
                disabled={saving}
                className="bg-russian-violet hover:bg-russian-violet/90 disabled:bg-russian-violet/40 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="bg-seasalt-400/40 text-rich-black/70 hover:bg-seasalt-400/60 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            key={c.id}
            className="border-seasalt-400/30 flex flex-col gap-1 rounded-xl border bg-white/50 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-russian-violet font-semibold">{c.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-rich-black/40 text-xs">{formatDate(c.createdAt)}</span>
                {!c.googleContactId ? (
                  <button
                    onClick={() => void syncToGoogle(c.id)}
                    disabled={syncingId === c.id}
                    className="text-russian-violet/70 hover:text-russian-violet rounded px-1.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-40"
                  >
                    {syncingId === c.id ? "Syncing…" : "Sync to Google"}
                  </button>
                ) : (
                  <span className="text-rich-black/30 rounded px-1.5 py-0.5 text-xs">Synced</span>
                )}
                <button
                  onClick={() => startEdit(c)}
                  className="text-russian-violet/70 hover:text-russian-violet rounded px-1.5 py-0.5 text-xs font-medium transition-colors"
                >
                  Edit
                </button>
              </div>
            </div>
            <a
              href={`mailto:${c.email}`}
              className="text-moonstone-600 hover:text-moonstone-700 text-sm transition-colors"
            >
              {c.email}
            </a>
            {c.phone && (
              <a
                href={`tel:${c.phone}`}
                className="text-rich-black/60 hover:text-rich-black text-sm transition-colors"
              >
                {c.phone}
              </a>
            )}
            {c.address && <p className="text-rich-black/50 text-sm">{c.address}</p>}
            {c.reviews.length > 0 && (
              <div className="mt-1">
                <button
                  onClick={() => setExpandedReviewsId((prev) => (prev === c.id ? null : c.id))}
                  className="text-russian-violet/60 hover:text-russian-violet text-xs font-medium transition-colors"
                >
                  {expandedReviewsId === c.id
                    ? "Hide reviews"
                    : `${c.reviews.length} linked review${c.reviews.length === 1 ? "" : "s"}`}
                </button>
                {expandedReviewsId === c.id && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {c.reviews.map((rv) => (
                      <div
                        key={rv.id}
                        className="border-seasalt-400/20 bg-seasalt-900/20 rounded-lg border px-3 py-2"
                      >
                        <span className="text-russian-violet/70 text-xs font-medium">
                          {formatReviewerName(rv)}
                        </span>
                        <p className="text-rich-black/50 mt-0.5 text-xs leading-relaxed">
                          {rv.text.length > 80 ? `${rv.text.slice(0, 80)}…` : rv.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}
