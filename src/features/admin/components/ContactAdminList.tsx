"use client";
// src/features/admin/components/ContactAdminList.tsx
/**
 * @file ContactAdminList.tsx
 * @description Admin component listing contacts saved from booking submissions,
 * with inline editing and Google Places autocomplete for the address field.
 * Contacts are split into two sections: unsynced (needs attention) and synced
 * (already linked to Google Contacts, shown in a collapsible drawer).
 */

import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { validateEmail } from "@/features/booking/lib/booking";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { validatePhone } from "@/shared/lib/normalise-phone";
import type React from "react";
import { useEffect, useState } from "react";

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

interface EditValues {
  name: string;
  email: string;
  phone: string;
  address: string;
}

interface EditFormState {
  values: EditValues;
  saving: boolean;
  error: string | null;
  setField: <K extends keyof EditValues>(field: K, value: EditValues[K]) => void;
  save: () => void;
  cancel: () => void;
}

interface ContactCardProps {
  c: ContactRow;
  /** Non-null only when this card is the one being edited. */
  edit: EditFormState | null;
  isSyncing: boolean;
  isConfirmingSync: boolean;
  isReviewsExpanded: boolean;
  onStartEdit: () => void;
  onRequestSync: () => void;
  onConfirmSync: () => void;
  onCancelSync: () => void;
  onToggleReviews: () => void;
}

interface FieldRenderProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
}

interface ContactEditField {
  key: keyof EditValues;
  label: string;
  render: (p: FieldRenderProps) => React.ReactNode;
}

/**
 * Plain text input used by the Name field.
 * @param props - Field render props.
 * @param props.id - DOM id for label association.
 * @param props.value - Current value.
 * @param props.onChange - Change handler.
 * @returns Input element.
 */
function renderNameField({ id, value, onChange }: FieldRenderProps): React.ReactElement {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
      )}
    />
  );
}

/**
 * Email input wrapper for the field array.
 * @param props - Field render props.
 * @param props.id - DOM id for label association.
 * @param props.value - Current value.
 * @param props.onChange - Change handler.
 * @returns Email input element.
 */
function renderEmailField({ id, value, onChange }: FieldRenderProps): React.ReactElement {
  return <EmailInput id={id} value={value} onChange={onChange} />;
}

/**
 * Phone input wrapper for the field array.
 * @param props - Field render props.
 * @param props.id - DOM id for label association.
 * @param props.value - Current value.
 * @param props.onChange - Change handler.
 * @returns Phone input element.
 */
function renderPhoneField({ id, value, onChange }: FieldRenderProps): React.ReactElement {
  return <PhoneInput id={id} value={value} onChange={onChange} />;
}

/**
 * Address autocomplete wrapper for the field array.
 * @param props - Field render props.
 * @param props.id - DOM id for label association.
 * @param props.value - Current value.
 * @param props.onChange - Change handler.
 * @returns Address input element.
 */
function renderAddressField({ id, value, onChange }: FieldRenderProps): React.ReactElement {
  return (
    <AddressAutocomplete
      id={id}
      value={value}
      onChange={onChange}
      placeholder="Start typing address..."
    />
  );
}

const CONTACT_EDIT_FIELDS: ReadonlyArray<ContactEditField> = [
  { key: "name", label: "Name", render: renderNameField },
  { key: "email", label: "Email", render: renderEmailField },
  { key: "phone", label: "Phone", render: renderPhoneField },
  { key: "address", label: "Address", render: renderAddressField },
];

/**
 * Renders a single contact row, either in view or edit mode.
 * @param props - Contact card props.
 * @param props.c - Contact row data.
 * @param props.edit - Edit form state when this card is being edited; null otherwise.
 * @param props.isSyncing - True while this contact is mid-sync to Google.
 * @param props.isConfirmingSync - True when the sync confirmation panel is open.
 * @param props.isReviewsExpanded - True when the linked-reviews panel is open.
 * @param props.onStartEdit - Opens the edit form for this contact.
 * @param props.onRequestSync - Opens the sync-to-Google confirmation.
 * @param props.onConfirmSync - Confirms and runs the sync.
 * @param props.onCancelSync - Cancels the pending sync confirmation.
 * @param props.onToggleReviews - Toggles the linked-reviews panel.
 * @returns Contact card element.
 */
function ContactCard({
  c,
  edit,
  isSyncing,
  isConfirmingSync,
  isReviewsExpanded,
  onStartEdit,
  onRequestSync,
  onConfirmSync,
  onCancelSync,
  onToggleReviews,
}: ContactCardProps): React.ReactElement {
  if (edit) {
    return (
      <div className={cn("flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4")}>
        <div className={cn("flex flex-wrap items-center justify-between gap-2")}>
          <span className={cn("text-xs font-semibold tracking-wide text-russian-violet uppercase")}>
            Editing
          </span>
          <span className={cn("text-xs text-slate-400")}>{formatDateShort(c.createdAt)}</span>
        </div>
        {CONTACT_EDIT_FIELDS.map((f) => {
          const inputId = `edit-${f.key}-${c.id}`;
          return (
            <div key={f.key} className={cn("flex flex-col gap-1")}>
              <label className={cn("text-xs font-semibold text-russian-violet")} htmlFor={inputId}>
                {f.label}
              </label>
              {f.render({
                id: inputId,
                value: edit.values[f.key],
                onChange: edit.setField.bind(null, f.key),
              })}
            </div>
          );
        })}
        {edit.error && (
          <p className={cn("text-xs font-medium text-coquelicot-600")}>{edit.error}</p>
        )}
        <div className={cn("flex gap-2")}>
          <button
            onClick={edit.save}
            disabled={edit.saving}
            className={cn(
              "rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-russian-violet/90 disabled:bg-russian-violet/40",
            )}
          >
            {edit.saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={edit.cancel}
            disabled={edit.saving}
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
        <span className={cn("min-w-0 truncate font-semibold text-russian-violet")}>{c.name}</span>
        <div className={cn("flex items-center gap-2")}>
          <span className={cn("text-xs text-slate-400")}>{formatDateShort(c.createdAt)}</span>
          {!c.googleContactId &&
            (isSyncing ? (
              <span className={cn("text-xs text-slate-400")}>Syncing…</span>
            ) : isConfirmingSync ? (
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
                    onClick={onConfirmSync}
                    className={cn(
                      "rounded bg-russian-violet px-2 py-0.5 text-xs font-semibold text-white transition-colors hover:bg-russian-violet/90",
                    )}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={onCancelSync}
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
                onClick={onRequestSync}
                className={cn(
                  "rounded px-1.5 py-0.5 text-xs font-medium text-russian-violet/70 transition-colors hover:text-russian-violet",
                )}
              >
                Sync to Google
              </button>
            ))}
          {c.googleContactId && (
            <span className={cn("rounded px-1.5 py-0.5 text-xs text-slate-400")}>Synced</span>
          )}
          <button
            onClick={onStartEdit}
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium text-russian-violet/70 transition-colors hover:text-russian-violet",
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
            "text-sm break-all text-moonstone-600 transition-colors hover:text-moonstone-700",
          )}
        >
          {c.email}
        </a>
      ) : (
        <span className={cn("text-sm text-slate-400 italic")}>No email</span>
      )}
      {c.phone && (
        <a
          href={`tel:${c.phone}`}
          className={cn("text-sm text-slate-500 transition-colors hover:text-slate-700")}
        >
          {c.phone}
        </a>
      )}
      {c.address && <p className={cn("text-sm wrap-break-word text-slate-500")}>{c.address}</p>}
      {c.reviews.length > 0 && (
        <div className={cn("mt-1")}>
          <button
            onClick={onToggleReviews}
            className={cn(
              "text-xs font-medium text-russian-violet/60 transition-colors hover:text-russian-violet",
            )}
          >
            {isReviewsExpanded
              ? "Hide reviews"
              : `${c.reviews.length} linked review${c.reviews.length === 1 ? "" : "s"}`}
          </button>
          {isReviewsExpanded && (
            <div className={cn("mt-2 flex flex-col gap-1.5")}>
              {c.reviews.map((rv) => (
                <div
                  key={rv.id}
                  className={cn("rounded-lg border border-slate-200 bg-slate-50 px-3 py-2")}
                >
                  <div className={cn("flex items-center justify-between gap-2")}>
                    <span className={cn("text-xs font-medium text-russian-violet/70")}>
                      {formatReviewerName(rv)}
                    </span>
                    {rv.customerRef && (
                      <a
                        href={`/review?token=${rv.customerRef}`}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          "shrink-0 text-xs font-medium text-moonstone-600 transition-colors hover:text-moonstone-700",
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
 * @returns Contact list element.
 */
export function ContactAdminList({
  contacts: initialContacts,
}: {
  contacts: ContactRow[];
}): React.ReactElement {
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContacts(initialContacts);
  }, [initialContacts]);
  // Edit, sync, and UI state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({
    name: "",
    email: "",
    phone: "",
    address: "",
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
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

  // Filter and bucket contacts
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
    setEditValues({
      name: c.name,
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
    });
    setEditError(null);
  }

  /**
   * Updates one field of the edit form.
   * @param field - Field key.
   * @param value - New value.
   */
  function setEditField<K extends keyof EditValues>(field: K, value: EditValues[K]): void {
    setEditValues((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Closes the inline edit form without saving.
   */
  function cancelEdit(): void {
    setEditingId(null);
    setEditError(null);
  }

  /**
   * Downloads the full contacts CSV via the admin API and triggers a browser save dialog.
   * Uses fetch + blob so the admin secret can be sent as a header rather than in the URL.
   */
  async function exportContacts(): Promise<void> {
    try {
      const res = await fetch("/api/admin/contacts/export", {
        headers: {},
      });
      if (!res.ok) {
        console.error("[ContactAdminList] Export failed:", res.status);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "contacts.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[ContactAdminList] Export error:", err);
    }
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
        headers: {},
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
    if (!editValues.name.trim()) {
      setEditError("Name is required.");
      return;
    }
    if (validateEmail(editValues.email) !== "ok") {
      setEditError("Please enter a valid email address.");
      return;
    }
    if (validatePhone(editValues.phone).result === "invalid") {
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
        },
        body: JSON.stringify(editValues),
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
   * Builds the per-card props (everything except `c` itself).
   * @param c - Contact row this card is for.
   * @returns Card props excluding `c`.
   */
  function buildCardProps(c: ContactRow): Omit<ContactCardProps, "c"> {
    return {
      edit:
        editingId === c.id
          ? {
              values: editValues,
              saving,
              error: editError,
              setField: setEditField,
              save: handleSaveEdit.bind(null, c.id),
              cancel: cancelEdit,
            }
          : null,
      isSyncing: syncingId === c.id,
      isConfirmingSync: confirmSyncId === c.id,
      isReviewsExpanded: expandedReviewsId === c.id,
      onStartEdit: startEdit.bind(null, c),
      onRequestSync: setConfirmSyncId.bind(null, c.id),
      onConfirmSync: handleConfirmSyncToGoogle.bind(null, c.id),
      onCancelSync: handleCancelSyncToGoogle,
      onToggleReviews: toggleReviews.bind(null, c.id),
    };
  }

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
            "min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
          )}
        />
        <button
          type="button"
          onClick={() => void exportContacts()}
          className={cn(
            "shrink-0 text-xs font-medium text-moonstone-600 underline underline-offset-2 hover:text-moonstone-700",
          )}
        >
          Export CSV
        </button>
      </div>

      {/* New contacts - added in the last 7 days */}
      {newContacts.length > 0 && (
        <div className={cn("flex flex-col gap-3")}>
          <h3
            className={cn(
              "flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-700 uppercase",
            )}
          >
            New
            <span
              className={cn(
                "rounded-full bg-moonstone-600/15 px-2 py-0.5 text-[10px] font-semibold text-moonstone-600",
              )}
            >
              {newContacts.length}
            </span>
          </h3>
          {newContacts.map((c) => (
            <ContactCard key={c.id} c={c} {...buildCardProps(c)} />
          ))}
        </div>
      )}

      {/* Unsynced contacts - shown prominently */}
      {unsynced.length > 0 ? (
        <div className={cn("flex flex-col gap-3")}>
          <h3 className={cn("text-xs font-semibold tracking-wide text-russian-violet uppercase")}>
            Needs syncing ({unsynced.length})
          </h3>
          {unsynced.map((c) => (
            <ContactCard key={c.id} c={c} {...buildCardProps(c)} />
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
            <span className={cn("text-xs font-semibold tracking-wide text-slate-500 uppercase")}>
              Synced contacts ({synced.length})
            </span>
            <span className={cn("text-xs text-slate-400")}>{syncedOpen ? "▲" : "▼"}</span>
          </button>
          {syncedOpen && (
            <div className={cn("flex flex-col gap-3")}>
              {synced.map((c) => (
                <ContactCard key={c.id} c={c} {...buildCardProps(c)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
