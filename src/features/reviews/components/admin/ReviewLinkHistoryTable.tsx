"use client";
// src/features/reviews/components/admin/ReviewLinkHistoryTable.tsx
// Review link history: cards up to xl and a table from xl, with inline editing of a
// contact's email/phone, Send again for anyone with an email on file, and revoke for links
// not yet used. Rows that resolve to no contact at all (Legacy) are read-only.

import {
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ListToolbar } from "@/features/admin/components/ui/ListToolbar";
import { useToast } from "@/features/admin/components/ui/Toast";
import { cn } from "@/shared/lib/cn";
import { formatNZPhone, toE164NZ } from "@/shared/lib/normalise-phone";
import type React from "react";
import { useState } from "react";
import {
  ContactEditForm,
  ContactText,
  dateLabel,
  EditContactButton,
  HistoryRowActions,
  isReviewDerived,
  ReviewedPill,
  SourceBadge,
} from "./ReviewLinkHistoryParts";
import { useSendReviewAsk } from "./use-send-review-ask";

/** Table cell, a little tighter than the kit default so three columns fit the 2/3 column. */
const CELL_CLS = cn(TD_CLS, "px-3");

/**
 * Which channel the review link went out on. The first four are tracked sends
 * with a real send date; the last two are reconstructed from the review itself,
 * so their date is when the review landed, not when the ask went out.
 * - `Linked` - a review attached to a contact with no send on record.
 * - `Legacy` - a review nobody in the contact book answers for.
 */
export type LinkSource = "Auto" | "Manual email" | "Manual SMS" | "Invoice" | "Linked" | "Legacy";

/**
 * A single row in the review link history table.
 */
export interface LinkHistoryEntry {
  /** Contact id, for every row that resolves to one; null for booking sends and Legacy rows. */
  id: string | null;
  /** Review token used as the customerRef on the Review record; null when the row has no link. */
  customerRef: string | null;
  /** Review document id - set on rows reconstructed from a review (Linked / Legacy). */
  reviewId: string | null;
  name: string;
  /** Email address, or null when none is on file */
  email: string | null;
  /** Phone number (normalised), or null if not stored */
  phone: string | null;
  /** Send date for tracked sends; the review date on Linked and Legacy rows. */
  sentAt: string;
  reviewed: boolean;
  source: LinkSource;
  reviewUrl: string;
}

interface ReviewLinkHistoryTableProps {
  entries: LinkHistoryEntry[];
}

/**
 * Renders the review link history: cards on phones and narrow desktops, a table from xl.
 * The list sits in the page's two-thirds column, which below xl is too narrow for three
 * columns. Any row that resolves to a contact can have its email/phone edited inline.
 * @param props - Component props.
 * @param props.entries - History rows to display.
 * @returns History table element.
 */
export function ReviewLinkHistoryTable({
  entries: initialEntries,
}: ReviewLinkHistoryTableProps): React.ReactElement {
  const { toast } = useToast();
  const [entries, setEntries] = useState(initialEntries);
  const [query, setQuery] = useState("");
  /**
   * Key used to track which row is being edited. Review-derived rows key on the
   * review first, so two reviews resolving to one contact stay distinct rows.
   */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPhoneInput, setEditPhoneInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRevokeKey, setConfirmRevokeKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  // A resend lands as this person's newest manual email ask.
  const ask = useSendReviewAsk((target) => {
    const at = new Date().toISOString();
    setEntries((prev) =>
      prev.map((e) =>
        e.id !== null && e.email === target.email
          ? { ...e, sentAt: at, source: "Manual email" as const }
          : e,
      ),
    );
  });

  /**
   * Returns the edit key for a given entry.
   * @param entry - The entry.
   * @returns A stable string key, or null if the entry is not editable.
   */
  function entryKey(entry: LinkHistoryEntry): string | null {
    if (entry.reviewId) return `rev:${entry.reviewId}`;
    if (entry.id) return entry.id;
    if (entry.customerRef) return `token:${entry.customerRef}`;
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
  }

  /** Cancels editing without saving. */
  function cancelEdit(): void {
    setEditingKey(null);
  }

  /**
   * Revokes a review link by clearing the send state on the contact row.
   * @param entry - The entry to revoke.
   */
  async function handleRevoke(entry: LinkHistoryEntry): Promise<void> {
    if (!entry.id) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/admin/contacts/${entry.id}/clear-review-link`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setConfirmRevokeKey(null);
      toast("Review link revoked.", { tone: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong.", { tone: "error" });
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
    try {
      // PATCH the Contact row - email/phone live there now that the standalone
      // ReviewRequest model has been retired. Rows with no contact behind them
      // are read-only, so `entry.id` is the gate above.
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
      toast("Contact details updated.", { tone: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong.", { tone: "error" });
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
    return <EmptyState title="No review links sent yet." />;
  }

  /**
   * Starts a fresh email ask to a row's person. A review-derived row has no send on
   * record, so it passes no last-asked date.
   * @param entry - The row to ask again.
   */
  function sendAgain(entry: LinkHistoryEntry): void {
    ask.start(
      {
        name: entry.name,
        email: entry.email,
        phone: entry.phone,
        lastAskedAt: isReviewDerived(entry) ? null : entry.sentAt,
      },
      "email",
    );
  }

  /**
   * Inline editor wired to the shared edit state, for whichever row is open.
   * @param entry - The row being edited.
   * @returns Editor element.
   */
  function editForm(entry: LinkHistoryEntry): React.ReactElement {
    return (
      <ContactEditForm
        email={editEmail}
        onEmailChange={setEditEmail}
        phone={editPhoneInput}
        onPhoneChange={setEditPhoneInput}
        saving={saving}
        onSave={() => void handleSave(entry)}
        onCancel={cancelEdit}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ListToolbar
        className="mb-0"
        search={
          <AdminInput
            type="search"
            placeholder="Search name, email, phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10"
          />
        }
      />
      {visibleEntries.length === 0 ? (
        <EmptyState title="No matching entries." />
      ) : (
        <>
          {/* Phones and narrow desktops: one card per row */}
          <div className="flex max-h-128 flex-col gap-2 overflow-y-auto xl:hidden">
            {visibleEntries.map((entry) => {
              const key = entryKey(entry);
              const isEditing = key !== null && editingKey === key;
              // Only contact-backed rows are editable; booking sends and rows with
              // nobody behind them display read-only, their fields living elsewhere.
              const canEdit = entry.id !== null;

              return (
                <Card key={key ?? entry.reviewUrl} padding="sm">
                  {/* Name row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium text-admin-text">{entry.name}</span>
                        <SourceBadge source={entry.source} />
                      </div>
                      <p className="mt-0.5 text-sm wrap-anywhere text-admin-muted">
                        <ContactText entry={entry} />
                        {" · "}
                        {dateLabel(entry)}
                      </p>
                    </div>
                    {canEdit && !isEditing && <EditContactButton onClick={() => openEdit(entry)} />}
                  </div>

                  {isEditing && (
                    <div className="mt-2 border-t border-admin-border pt-2">{editForm(entry)}</div>
                  )}

                  {/* Actions row */}
                  {!isEditing && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-admin-border pt-2">
                      <ReviewedPill reviewed={entry.reviewed} />
                      <HistoryRowActions
                        entry={entry}
                        onSendAgain={() => sendAgain(entry)}
                        onRevoke={() => setConfirmRevokeKey(key)}
                        pushRevokeRight
                      />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Wide desktop: one table row per entry. Editing swaps the contact and
              action cells for the editor, so the name stays in view. */}
          <div className="hidden max-h-128 overflow-y-auto rounded-lg border border-admin-border xl:block">
            <table className={cn(TABLE_CLS, "table-fixed")}>
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[31%]" />
                <col />
              </colgroup>
              <thead className={cn(THEAD_CLS, "sticky top-0 z-10")}>
                <tr>
                  <th className={cn(TH_CLS, "px-3")}>Name</th>
                  <th className={cn(TH_CLS, "px-3")}>Contact</th>
                  <th className={cn(TH_CLS, "px-3")}>Actions</th>
                </tr>
              </thead>
              <tbody className={TBODY_CLS}>
                {visibleEntries.map((entry) => {
                  const key = entryKey(entry);
                  const isEditing = key !== null && editingKey === key;
                  const canEdit = entry.id !== null;

                  return (
                    <tr key={key ?? entry.reviewUrl} className={cn(ROW_CLS, "align-top")}>
                      <td className={CELL_CLS}>
                        <p className="font-medium wrap-break-word text-admin-text">{entry.name}</p>
                        <div className="mt-1">
                          <SourceBadge source={entry.source} />
                        </div>
                      </td>
                      {isEditing ? (
                        <td className={CELL_CLS} colSpan={2}>
                          {editForm(entry)}
                        </td>
                      ) : (
                        <>
                          <td className={CELL_CLS}>
                            <div className="flex items-start gap-1">
                              <div className="min-w-0 text-sm">
                                <p className="wrap-anywhere text-admin-text">
                                  <ContactText entry={entry} />
                                </p>
                                <p className="mt-0.5 text-admin-muted">{dateLabel(entry)}</p>
                              </div>
                              {canEdit && <EditContactButton onClick={() => openEdit(entry)} />}
                            </div>
                          </td>
                          <td className={CELL_CLS}>
                            <ReviewedPill reviewed={entry.reviewed} />
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <HistoryRowActions
                                entry={entry}
                                onSendAgain={() => sendAgain(entry)}
                                onRevoke={() => setConfirmRevokeKey(key)}
                              />
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* One dialog for the list rather than a confirm pair per row: the entry
          is looked up from the pending key, so only one can be in flight. */}
      <ConfirmDialog
        open={confirmRevokeKey !== null}
        title="Revoke this review link?"
        body="The link stops working and the send is cleared from this history, so you can send them a fresh one."
        confirmLabel="Revoke"
        tone="danger"
        busy={revoking}
        onConfirm={() => {
          const entry = entries.find((e) => entryKey(e) === confirmRevokeKey);
          if (entry) void handleRevoke(entry);
        }}
        onCancel={() => setConfirmRevokeKey(null)}
      />
      {ask.dialog}
    </div>
  );
}
