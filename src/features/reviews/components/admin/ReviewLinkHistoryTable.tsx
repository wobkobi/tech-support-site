"use client";
// src/features/reviews/components/admin/ReviewLinkHistoryTable.tsx
/**
 * @file ReviewLinkHistoryTable.tsx
 * @description Table of review link history with inline editing for ReviewRequest entries.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { CopyLinkButton } from "./CopyLinkButton";
import { toE164NZ, formatNZPhone, isValidPhone } from "@/shared/lib/normalize-phone";

/**
 * A single row in the review link history table.
 */
export interface LinkHistoryEntry {
  /** ReviewRequest id - null for auto-sent booking entries and unlinked legacy entries */
  id: string | null;
  /**
   * Review token used as the customerRef on the Review record.
   * Set for manual and legacy entries; null for auto booking entries.
   */
  customerRef: string | null;
  /**
   * Original Review document id - set for all legacy entries so tokenless reviews
   * can still be edited (a new ReviewRequest is created and the Review is back-linked).
   */
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
  /** Admin token for API calls */
  token: string;
}

/**
 * Renders the review link history table with inline editing for manual and legacy entries.
 * @param props - Component props.
 * @param props.entries - History rows to display.
 * @param props.token - Admin token.
 * @returns History table element.
 */
export function ReviewLinkHistoryTable({
  entries: initialEntries,
  token,
}: ReviewLinkHistoryTableProps): React.ReactElement {
  const [entries, setEntries] = useState(initialEntries);
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
   * Saves the edited details to the API and updates local state.
   * @param entry - The entry being saved.
   */
  async function handleSave(entry: LinkHistoryEntry): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      let savedId = entry.id;
      let savedCustomerRef = entry.customerRef;
      let savedReviewUrl = entry.reviewUrl;

      if (entry.id) {
        // PATCH existing ReviewRequest
        const res = await fetch(`/api/admin/review-requests/${entry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            name: entry.name,
            email: editEmail,
            phone: editPhoneInput,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Request failed");
      } else if (entry.customerRef) {
        // POST to create (or update) a ReviewRequest for a legacy review with existing token
        const res = await fetch(`/api/admin/review-requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            customerRef: entry.customerRef,
            name: entry.name,
            email: editEmail,
            phone: editPhoneInput,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; id?: string; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Request failed");
        savedId = data.id ?? null;
      } else if (entry.reviewId) {
        // POST to create a new ReviewRequest for a tokenless legacy review.
        // The server generates a fresh token and back-links it to the Review record.
        const res = await fetch(`/api/admin/review-requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            reviewId: entry.reviewId,
            name: entry.name,
            email: editEmail,
            phone: editPhoneInput,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          id?: string;
          token?: string;
          reviewUrl?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Request failed");
        savedId = data.id ?? null;
        savedCustomerRef = data.token ?? null;
        savedReviewUrl = data.reviewUrl ?? "";
      }

      setEntries((prev) =>
        prev.map((e) =>
          entryKey(e) === editingKey
            ? {
                ...e,
                id: savedId,
                customerRef: savedCustomerRef,
                reviewUrl: savedReviewUrl,
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

  /**
   * Formats an ISO date string as a short localised string.
   * @param iso - ISO date string.
   * @returns Formatted date string.
   */
  function fmt(iso: string): string {
    return new Date(iso).toLocaleDateString("en-NZ", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  if (entries.length === 0) {
    return <p className={cn("text-seasalt-300 text-sm")}>No review links sent yet.</p>;
  }

  return (
    <div className={cn("overflow-x-auto")}>
      <table className={cn("w-full text-sm")}>
        <thead>
          <tr
            className={cn(
              "text-rich-black/50 border-seasalt-400/30 border-b text-left text-xs uppercase tracking-wide",
            )}
          >
            <th className={cn("pb-2 pr-4 font-semibold")}>Name</th>
            <th className={cn("pb-2 pr-4 font-semibold")}>Email / Phone</th>
            <th className={cn("pb-2 pr-4 font-semibold")}>Sent</th>
            <th className={cn("pb-2 pr-4 font-semibold")}>Via</th>
            <th className={cn("pb-2 pr-4 font-semibold")}>Reviewed?</th>
            <th className={cn("pb-2 font-semibold")}>Link</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const key = entryKey(entry);
            const isEditing = key !== null && editingKey === key;
            const canEdit = key !== null;

            if (isEditing) {
              const phoneValid = isValidPhone(editPhoneInput);

              return (
                <tr key={key} className={cn("border-seasalt-400/20 border-b last:border-0")}>
                  <td colSpan={6} className={cn("py-3")}>
                    <div className={cn("flex flex-col gap-2")}>
                      <div className={cn("flex flex-wrap gap-2")}>
                        <input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          placeholder="Email (optional)"
                          className={cn(
                            "border-seasalt-400/60 bg-seasalt-800 text-rich-black w-40 rounded-lg border px-3 py-1.5 text-sm focus:outline-none",
                          )}
                        />
                        <input
                          type="tel"
                          value={editPhoneInput}
                          onChange={(e) => setEditPhoneInput(e.target.value)}
                          onBlur={(e) => setEditPhoneInput(formatNZPhone(e.target.value))}
                          placeholder="021 123 1234"
                          className={cn(
                            "border-seasalt-400/60 bg-seasalt-800 text-rich-black w-40 rounded-lg border px-3 py-1.5 text-sm focus:outline-none",
                            editPhoneInput && !phoneValid ? "border-coquelicot-500/60" : "",
                          )}
                        />
                      </div>
                      {editPhoneInput && (
                        <p
                          className={cn(
                            "text-xs",
                            phoneValid ? "text-rich-black/40" : "text-coquelicot-400",
                          )}
                        >
                          {phoneValid
                            ? `Stored as: ${toE164NZ(editPhoneInput)}`
                            : "Invalid phone number"}
                        </p>
                      )}
                      {saveError && (
                        <p className={cn("text-coquelicot-400 text-xs")}>{saveError}</p>
                      )}
                      <div className={cn("flex gap-2")}>
                        <button
                          type="button"
                          disabled={saving || (!!editPhoneInput && !phoneValid)}
                          onClick={() => handleSave(entry)}
                          className={cn(
                            "bg-moonstone-600 hover:bg-moonstone-700 rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50",
                          )}
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className={cn(
                            "border-seasalt-400/60 text-rich-black/60 hover:border-russian-violet/40 rounded-lg border px-4 py-1.5 text-xs font-semibold transition-colors",
                          )}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            }

            return (
              <tr
                key={key ?? entry.reviewUrl}
                className={cn("border-seasalt-400/20 border-b last:border-0")}
              >
                <td className={cn("text-rich-black py-2 pr-4 font-medium")}>
                  <div className={cn("flex items-center gap-2")}>
                    {entry.name}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openEdit(entry)}
                        className={cn(
                          "text-rich-black/30 hover:text-russian-violet text-xs transition-colors",
                        )}
                        aria-label="Edit contact details"
                      >
                        ✎
                      </button>
                    )}
                  </div>
                </td>
                <td className={cn("text-rich-black/70 py-2 pr-4")}>
                  {entry.email ? (
                    <span>{entry.email}</span>
                  ) : entry.phone ? (
                    <span>{formatNZPhone(entry.phone)}</span>
                  ) : (
                    <span className={cn("text-rich-black/30 italic")}>
                      {entry.source === "Legacy" ? "no contact info" : "SMS only"}
                    </span>
                  )}
                </td>
                <td className={cn("text-rich-black/70 whitespace-nowrap py-2 pr-4")}>
                  {fmt(entry.sentAt)}
                </td>
                <td className={cn("py-2 pr-4")}>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      entry.source === "Auto"
                        ? "bg-moonstone-600/15 text-moonstone-600"
                        : entry.source === "Manual SMS"
                          ? "bg-coquelicot-500/10 text-coquelicot-500"
                          : entry.source === "Legacy"
                            ? "bg-seasalt-400/20 text-rich-black/40"
                            : "bg-russian-violet/10 text-russian-violet",
                    )}
                  >
                    {entry.source}
                  </span>
                </td>
                <td className={cn("py-2 pr-4")}>
                  {entry.reviewed ? (
                    <span className={cn("text-moonstone-600 text-xs font-semibold")}>Yes</span>
                  ) : (
                    <span className={cn("text-rich-black/40 text-xs")}>Not yet</span>
                  )}
                </td>
                <td className={cn("py-2")}>
                  <CopyLinkButton url={entry.reviewUrl} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
