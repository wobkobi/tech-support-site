"use client";
// src/features/admin/components/ContactAdminList.tsx
/**
 * @file ContactAdminList.tsx
 * @description Admin component listing contacts saved from booking submissions,
 * with inline editing and Google Places autocomplete for the address field.
 * Contacts are split into two sections: unsynced (needs attention) and synced
 * (already linked to Google Contacts, shown in a collapsible drawer).
 */

import type React from "react";
import { useState, useEffect } from "react";
import { cn } from "@/shared/lib/cn";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { normalizePhone, isValidPhone } from "@/shared/lib/normalize-phone";

export interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  createdAt: string;
  /** Google People API resource name if synced, or null */
  googleContactId: string | null;
  /** Reviews linked to this contact */
  reviews: Array<{
    id: string;
    text: string;
    firstName: string | null;
    lastName: string | null;
    /** Review token used to construct the /review?token= link, or null for old records. */
    customerRef: string | null;
  }>;
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

interface ContactCardProps {
  c: ContactRow;
  editingId: string | null;
  editName: string;
  editEmail: string;
  editPhone: string;
  editAddress: string;
  saving: boolean;
  editError: string | null;
  phoneBlurError: string | null;
  syncingId: string | null;
  confirmSyncId: string | null;
  expandedReviewsId: string | null;
  onStartEdit: (c: ContactRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  onRequestSyncToGoogle: (id: string) => void;
  onConfirmSyncToGoogle: (id: string) => void;
  onCancelSyncToGoogle: () => void;
  onToggleReviews: (id: string) => void;
  onEditName: (v: string) => void;
  onEditEmail: (v: string) => void;
  onEditPhone: (v: string) => void;
  onEditAddress: (v: string) => void;
  onPhoneBlur: () => void;
}

/**
 * Renders a single contact row, either in view or edit mode.
 * @param props - Contact card props.
 * @param props.c - The contact row data.
 * @param props.editingId - ID of the contact currently being edited, or null.
 * @param props.editName - Current value of the name edit field.
 * @param props.editEmail - Current value of the email edit field.
 * @param props.editPhone - Current value of the phone edit field.
 * @param props.editAddress - Current value of the address edit field.
 * @param props.saving - Whether a save is in progress.
 * @param props.editError - Validation or API error message for the current edit, or null.
 * @param props.phoneBlurError - Inline phone validation error shown on blur, or null.
 * @param props.syncingId - ID of the contact currently being synced, or null.
 * @param props.confirmSyncId - ID of the contact awaiting sync confirmation, or null.
 * @param props.expandedReviewsId - ID of the contact whose reviews are expanded, or null.
 * @param props.onStartEdit - Opens the edit form for the given contact.
 * @param props.onCancelEdit - Closes the edit form without saving.
 * @param props.onSaveEdit - Saves the edited contact with the given ID.
 * @param props.onRequestSyncToGoogle - Opens the sync confirmation for the given contact.
 * @param props.onConfirmSyncToGoogle - Confirms and executes the sync for the given contact.
 * @param props.onCancelSyncToGoogle - Cancels the pending sync confirmation.
 * @param props.onToggleReviews - Toggles the reviews panel for the given contact ID.
 * @param props.onEditName - Updates the name edit field value.
 * @param props.onEditEmail - Updates the email edit field value.
 * @param props.onEditPhone - Updates the phone edit field value.
 * @param props.onEditAddress - Updates the address edit field value.
 * @param props.onPhoneBlur - Validates the phone field when the input loses focus.
 * @returns Contact card element.
 */
function ContactCard({
  c,
  editingId,
  editName,
  editEmail,
  editPhone,
  editAddress,
  saving,
  editError,
  phoneBlurError,
  syncingId,
  confirmSyncId,
  expandedReviewsId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRequestSyncToGoogle,
  onConfirmSyncToGoogle,
  onCancelSyncToGoogle,
  onToggleReviews,
  onEditName,
  onEditEmail,
  onEditPhone,
  onEditAddress,
  onPhoneBlur,
}: ContactCardProps): React.ReactElement {
  if (editingId === c.id) {
    return (
      <div className={cn("flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4")}>
        <div className={cn("flex flex-wrap items-center justify-between gap-2")}>
          <span className={cn("text-russian-violet text-xs font-semibold uppercase tracking-wide")}>
            Editing
          </span>
          <span className={cn("text-xs text-slate-400")}>{formatDate(c.createdAt)}</span>
        </div>
        <div className={cn("flex flex-col gap-1")}>
          <label
            className={cn("text-russian-violet text-xs font-semibold")}
            htmlFor={`edit-name-${c.id}`}
          >
            Name
          </label>
          <input
            id={`edit-name-${c.id}`}
            type="text"
            value={editName}
            onChange={(e) => onEditName(e.target.value)}
            className={cn(
              "focus:border-russian-violet focus:ring-russian-violet/30 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
            )}
          />
        </div>
        <div className={cn("flex flex-col gap-1")}>
          <label
            className={cn("text-russian-violet text-xs font-semibold")}
            htmlFor={`edit-email-${c.id}`}
          >
            Email
          </label>
          <input
            id={`edit-email-${c.id}`}
            type="email"
            value={editEmail}
            onChange={(e) => onEditEmail(e.target.value)}
            className={cn(
              "focus:border-russian-violet focus:ring-russian-violet/30 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
            )}
          />
        </div>
        <div className={cn("flex flex-col gap-1")}>
          <label
            className={cn("text-russian-violet text-xs font-semibold")}
            htmlFor={`edit-phone-${c.id}`}
          >
            Phone
          </label>
          <input
            id={`edit-phone-${c.id}`}
            type="text"
            value={editPhone}
            onChange={(e) => {
              onEditPhone(e.target.value);
            }}
            onBlur={onPhoneBlur}
            className={cn(
              "focus:border-russian-violet focus:ring-russian-violet/30 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
            )}
          />
          {phoneBlurError && <p className={cn("text-coquelicot-600 text-xs")}>{phoneBlurError}</p>}
        </div>
        <div className={cn("flex flex-col gap-1")}>
          <label
            className={cn("text-russian-violet text-xs font-semibold")}
            htmlFor={`edit-address-${c.id}`}
          >
            Address
          </label>
          <AddressAutocomplete
            id={`edit-address-${c.id}`}
            value={editAddress}
            onChange={onEditAddress}
            placeholder="Start typing address..."
          />
        </div>
        {editError && <p className={cn("text-coquelicot-600 text-xs font-medium")}>{editError}</p>}
        <div className={cn("flex gap-2")}>
          <button
            onClick={() => onSaveEdit(c.id)}
            disabled={saving}
            className={cn(
              "bg-russian-violet hover:bg-russian-violet/90 disabled:bg-russian-violet/40 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors",
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onCancelEdit}
            disabled={saving}
            className={cn(
              "rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40",
            )}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-4",
      )}
    >
      <div className={cn("flex min-w-0 flex-wrap items-center justify-between gap-2")}>
        <span className={cn("text-russian-violet min-w-0 truncate font-semibold")}>{c.name}</span>
        <div className={cn("flex items-center gap-2")}>
          <span className={cn("text-xs text-slate-400")}>{formatDate(c.createdAt)}</span>
          {!c.googleContactId &&
            (syncingId === c.id ? (
              <span className={cn("text-xs text-slate-400")}>Syncing…</span>
            ) : confirmSyncId === c.id ? (
              <div
                className={cn(
                  "flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs",
                )}
              >
                <p className={cn("font-medium text-slate-600")}>Sync to Google?</p>
                <div className={cn("space-y-0.5 text-slate-500")}>
                  <p>{c.name}</p>
                  {c.email && <p>{c.email}</p>}
                  {c.phone && <p>{c.phone}</p>}
                  {c.address && <p>{c.address}</p>}
                </div>
                <div className={cn("flex gap-2")}>
                  <button
                    onClick={() => onConfirmSyncToGoogle(c.id)}
                    className={cn(
                      "bg-russian-violet hover:bg-russian-violet/90 rounded px-2 py-0.5 text-xs font-semibold text-white transition-colors",
                    )}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={onCancelSyncToGoogle}
                    className={cn(
                      "rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200",
                    )}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => onRequestSyncToGoogle(c.id)}
                className={cn(
                  "text-russian-violet/70 hover:text-russian-violet rounded px-1.5 py-0.5 text-xs font-medium transition-colors",
                )}
              >
                Sync to Google
              </button>
            ))}
          {c.googleContactId && (
            <span className={cn("rounded px-1.5 py-0.5 text-xs text-slate-400")}>Synced</span>
          )}
          <button
            onClick={() => onStartEdit(c)}
            className={cn(
              "text-russian-violet/70 hover:text-russian-violet rounded px-1.5 py-0.5 text-xs font-medium transition-colors",
            )}
          >
            Edit
          </button>
        </div>
      </div>
      {c.email ? (
        <a
          href={`mailto:${c.email}`}
          className={cn(
            "text-moonstone-600 hover:text-moonstone-700 break-all text-sm transition-colors",
          )}
        >
          {c.email}
        </a>
      ) : (
        <span className={cn("text-sm italic text-slate-400")}>No email</span>
      )}
      {c.phone && (
        <a
          href={`tel:${c.phone}`}
          className={cn("text-sm text-slate-500 transition-colors hover:text-slate-700")}
        >
          {c.phone}
        </a>
      )}
      {c.address && <p className={cn("wrap-break-word text-sm text-slate-500")}>{c.address}</p>}
      {c.reviews.length > 0 && (
        <div className={cn("mt-1")}>
          <button
            onClick={() => onToggleReviews(c.id)}
            className={cn(
              "text-russian-violet/60 hover:text-russian-violet text-xs font-medium transition-colors",
            )}
          >
            {expandedReviewsId === c.id
              ? "Hide reviews"
              : `${c.reviews.length} linked review${c.reviews.length === 1 ? "" : "s"}`}
          </button>
          {expandedReviewsId === c.id && (
            <div className={cn("mt-2 flex flex-col gap-1.5")}>
              {c.reviews.map((rv) => (
                <div
                  key={rv.id}
                  className={cn("rounded-lg border border-slate-200 bg-slate-50 px-3 py-2")}
                >
                  <div className={cn("flex items-center justify-between gap-2")}>
                    <span className={cn("text-russian-violet/70 text-xs font-medium")}>
                      {formatReviewerName(rv)}
                    </span>
                    {rv.customerRef && (
                      <a
                        href={`/review?token=${rv.customerRef}`}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          "text-moonstone-600 hover:text-moonstone-700 shrink-0 text-xs font-medium transition-colors",
                        )}
                      >
                        Review link ↗
                      </a>
                    )}
                  </div>
                  <p className={cn("mt-0.5 text-xs leading-relaxed text-slate-500")}>
                    {rv.text.length > 80 ? `${rv.text.slice(0, 80)}…` : rv.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PAGE_LOAD_TIME = Date.now();

/**
 * Editable list of contacts captured from booking submissions.
 * Unsynced contacts (no Google Contact link) are shown prominently at the top.
 * Synced contacts are grouped in a collapsible section below.
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
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContacts(initialContacts);
  }, [initialContacts]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [phoneBlurError, setPhoneBlurError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [confirmSyncId, setConfirmSyncId] = useState<string | null>(null);
  const [expandedReviewsId, setExpandedReviewsId] = useState<string | null>(null);
  const [syncedOpen, setSyncedOpen] = useState(true);
  const [query, setQuery] = useState("");

  const NEW_CONTACT_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Sorts contacts alphabetically by name (case-insensitive).
   * @param a - First contact.
   * @param b - Second contact.
   * @returns Negative, zero, or positive sort order.
   */
  function alphSort(a: ContactRow, b: ContactRow): number {
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  }

  /**
   * Returns true if the contact was created within the last 7 days.
   * @param c - Contact row to test.
   * @returns Whether the contact is considered new.
   */
  function isNew(c: ContactRow): boolean {
    return PAGE_LOAD_TIME - new Date(c.createdAt).getTime() < NEW_CONTACT_MS;
  }

  const q = query.toLowerCase().trim();
  const visible = q
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phone?.includes(q) ||
          c.address?.toLowerCase().includes(q),
      )
    : contacts;

  const newContacts = visible.filter(isNew).sort(alphSort);
  const rest = visible.filter((c) => !isNew(c));
  const unsynced = rest.filter((c) => !c.googleContactId).sort(alphSort);
  const synced = rest.filter((c) => !!c.googleContactId).sort(alphSort);

  /**
   * Opens the inline edit form for a contact row.
   * @param c - The contact row to edit.
   */
  function startEdit(c: ContactRow): void {
    setEditingId(c.id);
    setEditName(c.name);
    setEditEmail(c.email ?? "");
    setEditPhone(c.phone ?? "");
    setEditAddress(c.address ?? "");
    setEditError(null);
    setPhoneBlurError(null);
  }

  /**
   * Closes the inline edit form without saving.
   */
  function cancelEdit(): void {
    setEditingId(null);
    setEditError(null);
    setPhoneBlurError(null);
  }

  /**
   * Syncs a contact to Google Contacts via the admin API.
   * On success, updates the local state to reflect synced status.
   * @param id - Contact ID to sync.
   */
  async function syncToGoogle(id: string): Promise<void> {
    setConfirmSyncId(null);
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
    if (!editName.trim()) {
      setEditError("Name is required.");
      return;
    }
    if (!editEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail.trim())) {
      setEditError("Please enter a valid email address.");
      return;
    }
    if (editPhone.trim() && !isValidPhone(normalizePhone(editPhone))) {
      setEditError("Please enter a valid phone number.");
      return;
    }
    setEditError(null);
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
          email: editEmail,
          phone: editPhone,
          address: editAddress,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        contact?: {
          id: string;
          name: string;
          email: string | null;
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
                  email: data.contact!.email,
                  phone: data.contact!.phone,
                  address: data.contact!.address,
                }
              : c,
          ),
        );
        setEditingId(null);
        setEditError(null);
      } else {
        setEditError(data.error ?? "Save failed. Please try again.");
      }
    } catch {
      setEditError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Toggles the expanded reviews panel for a contact.
   * @param id - Contact ID whose reviews panel should be toggled.
   */
  function toggleReviews(id: string): void {
    setExpandedReviewsId((prev) => (prev === id ? null : id));
  }

  /**
   * Wraps saveEdit to return void for use as an event handler.
   * @param id - Contact ID to save.
   */
  function handleSaveEdit(id: string): void {
    void saveEdit(id);
  }

  /**
   * Confirms and executes the sync for the given contact ID.
   * @param id - Contact ID to sync.
   */
  function handleConfirmSyncToGoogle(id: string): void {
    void syncToGoogle(id);
  }

  /**
   * Clears the pending sync confirmation.
   */
  function handleCancelSyncToGoogle(): void {
    setConfirmSyncId(null);
  }

  /**
   * Updates the phone edit field and clears any blur validation error.
   * @param v - New phone value.
   */
  function handleEditPhone(v: string): void {
    setEditPhone(v);
    setPhoneBlurError(null);
  }

  /**
   * Validates the phone field when the input loses focus.
   */
  function handlePhoneBlur(): void {
    if (editPhone.trim() && !isValidPhone(normalizePhone(editPhone))) {
      setPhoneBlurError("Please enter a valid phone number.");
    }
  }

  const sharedCardProps = {
    editingId,
    editName,
    editEmail,
    editPhone,
    editAddress,
    saving,
    editError,
    phoneBlurError,
    syncingId,
    confirmSyncId,
    expandedReviewsId,
    onStartEdit: startEdit,
    onCancelEdit: cancelEdit,
    onSaveEdit: handleSaveEdit,
    onRequestSyncToGoogle: setConfirmSyncId,
    onConfirmSyncToGoogle: handleConfirmSyncToGoogle,
    onCancelSyncToGoogle: handleCancelSyncToGoogle,
    onToggleReviews: toggleReviews,
    onEditName: setEditName,
    onEditEmail: setEditEmail,
    onEditPhone: handleEditPhone,
    onEditAddress: setEditAddress,
    onPhoneBlur: handlePhoneBlur,
  };

  if (contacts.length === 0) {
    return (
      <p className={cn("text-sm text-slate-400")}>
        No contacts yet. They will appear here after customers book.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6")}>
      {/* Search + export row */}
      <div className={cn("flex items-center gap-3")}>
        <input
          type="search"
          placeholder="Search name, email, phone, address…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(
            "focus:ring-russian-violet/30 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
          )}
        />
        <a
          href={`/api/admin/contacts/export?token=${encodeURIComponent(token)}`}
          download="contacts.csv"
          className={cn(
            "text-moonstone-600 hover:text-moonstone-700 shrink-0 text-xs font-medium underline underline-offset-2",
          )}
        >
          Export CSV
        </a>
      </div>

      {/* New contacts - added in the last 7 days */}
      {newContacts.length > 0 && (
        <div className={cn("flex flex-col gap-3")}>
          <h3
            className={cn(
              "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700",
            )}
          >
            New
            <span
              className={cn(
                "bg-moonstone-600/15 text-moonstone-600 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              )}
            >
              {newContacts.length}
            </span>
          </h3>
          {newContacts.map((c) => (
            <ContactCard key={c.id} c={c} {...sharedCardProps} />
          ))}
        </div>
      )}

      {/* Unsynced contacts - shown prominently */}
      {unsynced.length > 0 ? (
        <div className={cn("flex flex-col gap-3")}>
          <h3 className={cn("text-russian-violet text-xs font-semibold uppercase tracking-wide")}>
            Needs syncing ({unsynced.length})
          </h3>
          {unsynced.map((c) => (
            <ContactCard key={c.id} c={c} {...sharedCardProps} />
          ))}
        </div>
      ) : (
        <p className={cn("text-sm text-slate-400")}>All contacts are synced to Google.</p>
      )}

      {/* Synced contacts - collapsible */}
      {synced.length > 0 && (
        <div className={cn("flex flex-col gap-3")}>
          <button
            onClick={() => setSyncedOpen((o) => !o)}
            className={cn("flex items-center gap-2 text-left")}
          >
            <span className={cn("text-xs font-semibold uppercase tracking-wide text-slate-500")}>
              Synced contacts ({synced.length})
            </span>
            <span className={cn("text-xs text-slate-400")}>{syncedOpen ? "▲" : "▼"}</span>
          </button>
          {syncedOpen && (
            <div className={cn("flex flex-col gap-3")}>
              {synced.map((c) => (
                <ContactCard key={c.id} c={c} {...sharedCardProps} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
