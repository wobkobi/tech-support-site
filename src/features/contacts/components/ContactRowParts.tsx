"use client";
// src/features/contacts/components/ContactRowParts.tsx
// Pieces of one contact row shared by the phone card (ContactCard) and the desktop table
// (ContactTable): sync status and its confirm panel, the merge-aware row actions, the
// delete confirm panel, and the linked-reviews toggle and list. Every handler comes in as
// a prop; the list owns all state.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import type { ContactRow, MergeRole } from "@/features/contacts/components/ContactCard";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { cn } from "@/shared/lib/cn";
import { formatNZPhone } from "@/shared/lib/normalise-phone";
import type React from "react";

/** Inline link inside a contact row or panel: underlined violet, as on the detail pages. */
export const CONTACT_LINK_CLS =
  "font-semibold text-russian-violet underline underline-offset-2 hover:decoration-2";

/** Compact row-action button: a little shorter and tighter than the kit default. */
const ROW_ACTION_CLS = "h-9 px-2";

/**
 * Tighter still, for the desktop table's actions column: the kit's xs height and padding
 * at text-sm (the xs size itself shrinks the text too), with the xs touch-target floor.
 */
const TABLE_ACTION_CLS = "h-8 px-1.5 pointer-coarse:min-h-11";

/**
 * Sync state for a contact: the "Synced" pill, "Syncing…" while a push runs, or the
 * button that opens the sync confirm.
 * @param props - Component props.
 * @param props.c - Contact row.
 * @param props.isSyncing - True while this contact is mid-sync.
 * @param props.onRequestSync - Opens the sync confirm.
 * @returns The sync status element.
 */
export function ContactSyncStatus({
  c,
  isSyncing,
  onRequestSync,
}: {
  c: ContactRow;
  isSyncing: boolean;
  onRequestSync: () => void;
}): React.ReactElement {
  if (c.googleContactId) return <StatusPill tone="success">Synced</StatusPill>;
  if (isSyncing) return <span className="text-sm text-admin-muted">Syncing…</span>;
  return (
    // Wraps onto two lines in the table's narrow Sync column.
    <AdminButton
      variant="ghost"
      onClick={onRequestSync}
      className={cn(ROW_ACTION_CLS, "h-auto min-h-9 py-1 whitespace-normal")}
    >
      Sync to Google
    </AdminButton>
  );
}

/**
 * Confirm panel for pushing one contact to Google, listing what will be sent.
 * @param props - Component props.
 * @param props.c - Contact row.
 * @param props.onConfirm - Runs the sync.
 * @param props.onCancel - Closes the panel.
 * @returns The confirm panel element.
 */
export function ContactSyncConfirm({
  c,
  onConfirm,
  onCancel,
}: {
  c: ContactRow;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-admin-border bg-admin-bg p-3 text-sm">
      <p className="font-bold text-admin-text">Sync to Google?</p>
      <div className="space-y-0.5 break-all text-admin-muted">
        <p>{c.name}</p>
        {c.email && <p>{c.email}</p>}
        {c.phone && <p>{formatNZPhone(c.phone)}</p>}
        {c.address && <p>{c.address}</p>}
      </div>
      <div className="flex gap-2">
        <AdminButton variant="outline" onClick={onConfirm} className={ROW_ACTION_CLS}>
          Confirm
        </AdminButton>
        <AdminButton variant="secondary" onClick={onCancel} className={ROW_ACTION_CLS}>
          Cancel
        </AdminButton>
      </div>
    </div>
  );
}

/**
 * Row actions, which depend on the contact's part in a merge: "Keep this one" on every
 * other contact while a merge is picking its survivor, "Merging - cancel" on the contact
 * being merged away, otherwise Edit, Merge and Delete.
 * @param props - Component props.
 * @param props.compact - Use the table's tighter buttons so the actions column stays narrow.
 * @param props.mergeRole - This contact's role in an in-progress merge.
 * @param props.onStartEdit - Opens the edit form.
 * @param props.onStartMerge - Picks this contact as the one to merge away.
 * @param props.onRequestDelete - Opens the delete confirm.
 * @param props.onMergeHere - Picks this contact as the survivor.
 * @param props.onCancelMerge - Cancels the merge.
 * @returns The actions fragment.
 */
export function ContactRowActions({
  compact = false,
  mergeRole,
  onStartEdit,
  onStartMerge,
  onRequestDelete,
  onMergeHere,
  onCancelMerge,
}: {
  compact?: boolean;
  mergeRole: MergeRole;
  onStartEdit: () => void;
  onStartMerge: () => void;
  onRequestDelete: () => void;
  onMergeHere: () => void;
  onCancelMerge: () => void;
}): React.ReactElement {
  const btnCls = compact ? TABLE_ACTION_CLS : ROW_ACTION_CLS;
  if (mergeRole === "target") {
    return (
      <AdminButton variant="outline" onClick={onMergeHere} className={btnCls}>
        Keep this one
      </AdminButton>
    );
  }
  if (mergeRole === "source") {
    return (
      <AdminButton
        variant="secondary"
        onClick={onCancelMerge}
        className={cn(
          btnCls,
          "border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-500 hover:bg-amber-200",
        )}
      >
        Merging - cancel
      </AdminButton>
    );
  }
  return (
    <>
      <AdminButton variant="ghost" onClick={onStartEdit} className={btnCls}>
        Edit
      </AdminButton>
      <AdminButton variant="ghost" onClick={onStartMerge} className={btnCls}>
        Merge
      </AdminButton>
      <AdminButton
        variant="ghost"
        onClick={onRequestDelete}
        className={cn(btnCls, "text-coquelicot-700 hover:bg-coquelicot-50")}
      >
        Delete
      </AdminButton>
    </>
  );
}

/**
 * Delete confirm panel, with the choice to remove the linked Google contact too.
 * @param props - Component props.
 * @param props.c - Contact row.
 * @param props.deleteGoogle - Whether the Google contact goes too.
 * @param props.onDeleteGoogleChange - Toggles that choice.
 * @param props.isDeleting - True while the delete runs.
 * @param props.onConfirm - Runs the delete.
 * @param props.onCancel - Closes the panel.
 * @returns The confirm panel element.
 */
export function ContactDeleteConfirm({
  c,
  deleteGoogle,
  onDeleteGoogleChange,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  c: ContactRow;
  deleteGoogle: boolean;
  onDeleteGoogleChange: (value: boolean) => void;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-coquelicot-600 bg-coquelicot-50 px-3 py-2 text-sm">
      <span className="font-bold text-coquelicot-700">Delete {c.name}?</span>
      <span className="text-admin-muted">Linked reviews are kept.</span>
      {c.googleContactId && (
        <AdminCheckbox
          checked={deleteGoogle}
          onChange={onDeleteGoogleChange}
          disabled={isDeleting}
          label="Google contact too"
        />
      )}
      <div className="ml-auto flex gap-2">
        <AdminButton
          variant="danger"
          onClick={onConfirm}
          disabled={isDeleting}
          className={ROW_ACTION_CLS}
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </AdminButton>
        <AdminButton
          variant="secondary"
          onClick={onCancel}
          disabled={isDeleting}
          className={ROW_ACTION_CLS}
        >
          Cancel
        </AdminButton>
      </div>
    </div>
  );
}

/**
 * Toggle that shows or hides a contact's linked reviews.
 * @param props - Component props.
 * @param props.count - Number of linked reviews.
 * @param props.expanded - Whether the list is open.
 * @param props.onToggle - Opens or closes the list.
 * @returns The toggle button.
 */
export function ContactReviewsToggle({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="text-sm font-semibold text-russian-violet hover:underline"
    >
      {expanded ? "Hide reviews" : `${count} linked review${count === 1 ? "" : "s"}`}
    </button>
  );
}

/**
 * A contact's linked reviews: reviewer, a link to the review page when the review has a
 * token, and the text cut to 80 characters.
 * @param props - Component props.
 * @param props.reviews - Linked reviews.
 * @returns The review list element.
 */
export function ContactReviewsList({
  reviews,
}: {
  reviews: ContactRow["reviews"];
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      {reviews.map((rv) => (
        <div
          key={rv.id}
          className="rounded-lg border border-admin-border bg-admin-surface px-3 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-admin-text">{formatReviewerName(rv)}</span>
            {rv.customerRef && (
              <a
                href={`/review?token=${rv.customerRef}`}
                target="_blank"
                rel="noreferrer"
                className={cn("shrink-0 text-sm", CONTACT_LINK_CLS)}
              >
                Review link ↗
              </a>
            )}
          </div>
          <p className="mt-0.5 text-sm leading-relaxed text-admin-muted">
            {rv.text.length > 80 ? `${rv.text.slice(0, 80)}…` : rv.text}
          </p>
        </div>
      ))}
    </div>
  );
}
