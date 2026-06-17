"use client";
// src/features/reviews/components/admin/ReviewLinkHistoryTable.tsx
/**
 * @file ReviewLinkHistoryTable.tsx
 * @description Table of review link history with inline editing for ReviewRequest entries.
 */

import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { formatNZPhone, isValidPhone, toE164NZ } from "@/shared/lib/normalise-phone";
import type React from "react";
import { useState } from "react";
import { FaCheck } from "react-icons/fa6";
import { CopyLinkButton } from "./CopyLinkButton";

/**
 * A single row in the review link history table.
 */
export interface LinkHistoryEntry {
  /** Contact id for manual sends; null for auto-sent booking entries and legacy entries. */
  id: string | null;
  /**
   * Review token used as the customerRef on the Review record.
   * Set for manual and legacy entries; null for auto booking entries.
   */
  customerRef: string | null;
  /** Original Review document id - set for legacy entries (read-only in the new model). */
  reviewId: string | null;
  name: string;
  /** Email address, or null for SMS-only or legacy entries */
  email: string | null;
  /** Phone number (normalized), or null if not stored */
  phone: string | null;
  sentAt: string;
  reviewed: boolean;
  source: "Auto" | "Manual email" | "Manual SMS" | "Legacy";
  reviewUrl: string;
}

interface ReviewLinkHistoryTableProps {
  entries: LinkHistoryEntry[];
}

/**
 * Renders the review link history table with inline editing for manual and legacy entries.
 * @param props - Component props.
 * @param props.entries - History rows to display.
 * @returns History table element.
 */
export function ReviewLinkHistoryTable({
  entries: initialEntries,
}: ReviewLinkHistoryTableProps): React.ReactElement {
  const [entries, setEntries] = useState(initialEntries);
  const [query, setQuery] = useState("");
  /**
   * Key used to track which row is being edited.
   * For manual entries: the ReviewRequest id.
   * For legacy entries with token: "legacy:<customerRef>".
   * For tokenless legacy entries: "rev:<reviewId>".
   */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPhoneInput, setEditPhoneInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmRevokeKey, setConfirmRevokeKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  /**
   * Returns the edit key for a given entry.
   * @param entry - The entry.
   * @returns A stable string key, or null if the entry is not editable.
   */
  function entryKey(entry: LinkHistoryEntry): string | null {
    if (entry.id) return entry.id;
    if (entry.customerRef) return `legacy:${entry.customerRef}`;
    if (entry.reviewId) return `rev:${entry.reviewId}`;
    return null;
  }

  /**
   * Opens the inline edit form for a row.
   * @param entry - The entry to edit.
   */
  function openEdit(entry: LinkHistoryEntry): void {
    const key = entryKey(entry);
    if (!key) return;
    setEditingKey(key);
    setEditEmail(entry.email ?? "");
    setEditPhoneInput(entry.phone ? formatNZPhone(entry.phone) : "");
    setSaveError(null);
  }

  /** Cancels editing without saving. */
  function cancelEdit(): void {
    setEditingKey(null);
    setSaveError(null);
  }

  /**
   * Revokes a review link by clearing the send state on the contact row.
   * @param entry - The entry to revoke.
   */
  async function handleRevoke(entry: LinkHistoryEntry): Promise<void> {
    if (!entry.id) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const res = await fetch(`/api/admin/contacts/${entry.id}/clear-review-link`, {
        method: "POST",
        headers: {},
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setConfirmRevokeKey(null);
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRevoking(false);
    }
  }

  /**
   * Saves the edited details to the API and updates local state.
   * @param entry - The entry being saved.
   */
  async function handleSave(entry: LinkHistoryEntry): Promise<void> {
    if (!entry.id) return;
    setSaving(true);
    setSaveError(null);
    try {
      // PATCH the Contact row - email/phone live there now that the
      // standalone ReviewRequest model has been retired. Legacy entries
      // (customerRef / reviewId only) are read-only.
      const res = await fetch(`/api/admin/contacts/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: editEmail,
          phone: editPhoneInput,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");

      setEntries((prev) =>
        prev.map((e) =>
          entryKey(e) === editingKey
            ? {
                ...e,
                email: editEmail.trim().toLowerCase() || null,
                phone: toE164NZ(editPhoneInput) || null,
              }
            : e,
        ),
      );
      setEditingKey(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const visibleEntries = query.trim()
    ? entries.filter((e) => {
        const q = query.toLowerCase();
        return (
          e.name.toLowerCase().includes(q) ||
          e.email?.toLowerCase().includes(q) ||
          e.phone?.includes(q) ||
          e.source.toLowerCase().includes(q)
        );
      })
    : entries;

  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">No review links sent yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        placeholder="Search name, email, phone…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
      />
      {visibleEntries.length === 0 ? (
        <p className="text-sm text-slate-400">No matching entries.</p>
      ) : (
        <div className="flex max-h-128 flex-col gap-2 overflow-y-auto">
          {visibleEntries.map((entry) => {
            const key = entryKey(entry);
            const isEditing = key !== null && editingKey === key;
            // Only contact-backed rows are editable; legacy and auto-booking
            // rows display read-only since their fields live elsewhere.
            const canEdit = entry.id !== null;

            const sourceBadge = (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  entry.source === "Auto"
                    ? "bg-moonstone-600/15 text-moonstone-600"
                    : entry.source === "Manual SMS"
                      ? "bg-coquelicot-500/10 text-coquelicot-500"
                      : entry.source === "Legacy"
                        ? "bg-slate-100 text-slate-400"
                        : "bg-russian-violet/10 text-russian-violet",
                )}
              >
                {entry.source}
              </span>
            );

            const contact = entry.email
              ? entry.email
              : entry.phone
                ? formatNZPhone(entry.phone)
                : null;

            return (
              <div
                key={key ?? entry.reviewUrl}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                {/* Name row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-slate-800">
                        {entry.name}
                      </span>
                      {sourceBadge}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {contact ?? (
                        <span className="text-slate-400 italic">
                          {entry.source === "Legacy" ? "no contact info" : "SMS only"}
                        </span>
                      )}
                      {" · "}
                      {formatDateShort(entry.sentAt)}
                    </p>
                  </div>
                  {canEdit && !isEditing && (
                    <button
                      type="button"
                      onClick={() => openEdit(entry)}
                      className="shrink-0 text-slate-400 transition-colors hover:text-russian-violet"
                      aria-label="Edit contact details"
                    >
                      ✎
                    </button>
                  )}
                </div>

                {/* Edit form */}
                {isEditing &&
                  (() => {
                    const phoneValid = isValidPhone(toE164NZ(editPhoneInput));
                    return (
                      <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-2">
                        <input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          placeholder="Email (optional)"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
                        />
                        <input
                          type="tel"
                          value={editPhoneInput}
                          onChange={(e) => setEditPhoneInput(e.target.value)}
                          onBlur={(e) => setEditPhoneInput(formatNZPhone(e.target.value))}
                          placeholder="021 123 1234"
                          className={cn(
                            "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
                            editPhoneInput && !phoneValid ? "border-coquelicot-500/60" : "",
                          )}
                        />
                        {editPhoneInput && (
                          <p
                            className={cn(
                              "text-xs",
                              phoneValid ? "text-slate-400" : "text-coquelicot-400",
                            )}
                          >
                            {phoneValid
                              ? `Stored as: ${toE164NZ(editPhoneInput)}`
                              : "Invalid phone number"}
                          </p>
                        )}
                        {saveError && <p className="text-xs text-coquelicot-400">{saveError}</p>}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={saving || (!!editPhoneInput && !phoneValid)}
                            onClick={() => handleSave(entry)}
                            className="rounded-lg bg-moonstone-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-moonstone-700 disabled:opacity-50"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="text-xs text-slate-500 transition-colors hover:text-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                {/* Actions row */}
                {!isEditing && (
                  <div className="mt-2 flex items-center gap-3 border-t border-slate-100 pt-2">
                    {entry.reviewed ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-moonstone-600">
                        Reviewed
                        <FaCheck className="h-3 w-3" aria-hidden />
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Not reviewed</span>
                    )}
                    <CopyLinkButton url={entry.reviewUrl} />
                    {entry.id &&
                      !entry.reviewed &&
                      (confirmRevokeKey === key ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={revoking}
                            onClick={() => handleRevoke(entry)}
                            className="text-xs font-semibold text-coquelicot-500 transition-colors hover:text-coquelicot-600 disabled:opacity-50"
                          >
                            {revoking ? "Revoking…" : "Confirm revoke"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmRevokeKey(null);
                              setRevokeError(null);
                            }}
                            className="text-xs text-slate-400 transition-colors hover:text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeKey(key)}
                          className="ml-auto text-xs text-slate-400 transition-colors hover:text-coquelicot-500"
                        >
                          Revoke
                        </button>
                      ))}
                    {revokeError && <p className="text-xs text-coquelicot-400">{revokeError}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
