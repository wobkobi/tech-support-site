"use client";
// src/features/contacts/components/ContactTable.tsx
// Desktop (lg and up) table for one section of the admin contacts list. Each row takes the
// same props as a ContactCard. Editing swaps the row for the ContactCard editor across the
// full width; the sync confirm, delete confirm and linked reviews open in an expanding
// row under it. Merge buttons stay in the actions cell, which is pinned to the right edge
// so the row actions stay in view when a narrow screen scrolls the table sideways.

import {
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import {
  ContactCard,
  type ContactCardProps,
  type ContactRow,
} from "@/features/contacts/components/ContactCard";
import {
  CONTACT_LINK_CLS,
  ContactDeleteConfirm,
  ContactReviewsList,
  ContactReviewsToggle,
  ContactRowActions,
  ContactSyncConfirm,
  ContactSyncStatus,
} from "@/features/contacts/components/ContactRowParts";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { formatNZPhone } from "@/shared/lib/normalise-phone";
import Link from "next/link";
import type React from "react";

/** Column count, for the full-width editor and expanding rows. */
const COLUMNS = 7;

/** Cell padding for the table: the kit cell, a touch tighter so seven columns fit. */
const CELL_CLS = cn(TD_CLS, "px-3 align-top");

/** Header cell to match {@link CELL_CLS}. */
const HEAD_CLS = cn(TH_CLS, "px-3");

/** The narrow Sync and Reviewed cells: tighter padding so the pill and toggle fit 6rem. */
const NARROW_CELL_CLS = cn(TD_CLS, "px-2 align-top");

/**
 * Pinned actions column. Collapsed table borders don't travel with a sticky cell, so the
 * left rule is an inset shadow. The background is opaque so scrolled cells pass under it.
 */
const PINNED_CLS = "sticky right-0 shadow-[inset_1px_0_0_var(--color-admin-border)]";

/**
 * Content of a full-width row (editor or expanding panel). The table can be wider than its
 * scroll box, so the content sticks to the left edge and is sized to the visible width
 * (100cqw of the wrapper, less the cell's 0.75rem padding each side), keeping its buttons
 * on screen.
 */
const FULL_ROW_CONTENT_CLS = "sticky left-3 w-[calc(100cqw-1.5rem)]";

/**
 * One table row plus, when a panel is open, its expanding row.
 * @param props - Component props.
 * @param props.c - Contact row.
 * @param props.cardProps - The ContactCard props for this contact (state and handlers).
 * @returns The row fragment.
 */
function ContactTableRow({
  c,
  cardProps,
}: {
  c: ContactRow;
  cardProps: Omit<ContactCardProps, "c">;
}): React.ReactElement {
  const p = cardProps;

  // Editing: the row opens into the card's editor, as the phone card does.
  if (p.edit) {
    return (
      <tr>
        <td colSpan={COLUMNS} className="bg-admin-bg p-3">
          <div className={FULL_ROW_CONTENT_CLS}>
            <ContactCard c={c} {...p} fieldIdPrefix="edit-row" />
          </div>
        </td>
      </tr>
    );
  }

  const showSyncConfirm = !c.googleContactId && p.isConfirmingSync;
  const showReviews = p.isReviewsExpanded && c.reviews.length > 0;
  const expanded = showSyncConfirm || p.isConfirmingDelete || showReviews;

  return (
    <>
      <tr className={cn("group", ROW_CLS, expanded && "bg-admin-bg")}>
        <td className={CELL_CLS}>
          <Link
            href={`/admin/contacts/${c.id}`}
            className="font-semibold wrap-break-word text-russian-violet hover:underline"
          >
            {c.name}
          </Link>
          {c.company && <p className="text-sm text-admin-muted">{c.company}</p>}
          <p className="text-sm whitespace-nowrap text-admin-muted">
            {formatDateShort(c.createdAt)}
          </p>
        </td>
        <td className={CELL_CLS}>
          {c.email ? (
            <a href={`mailto:${c.email}`} className={cn("text-sm break-all", CONTACT_LINK_CLS)}>
              {c.email}
            </a>
          ) : (
            <span className="text-sm text-admin-muted italic">No email</span>
          )}
          {c.altEmails.length > 0 && (
            <p className="text-sm break-all text-admin-muted">also: {c.altEmails.join(", ")}</p>
          )}
        </td>
        <td className={CELL_CLS}>
          {c.phone && (
            <a
              href={`tel:${c.phone}`}
              className="text-sm whitespace-nowrap text-admin-text-secondary hover:text-admin-text"
            >
              {formatNZPhone(c.phone)}
            </a>
          )}
          {c.altPhones.length > 0 && (
            <p className="text-sm text-admin-muted">
              also: {c.altPhones.map((ph) => formatNZPhone(ph)).join(", ")}
            </p>
          )}
        </td>
        <td className={cn(CELL_CLS, "text-sm wrap-break-word text-admin-text-secondary")}>
          {c.address}
        </td>
        <td className={NARROW_CELL_CLS}>
          <ContactSyncStatus c={c} isSyncing={p.isSyncing} onRequestSync={p.onRequestSync} />
        </td>
        <td className={NARROW_CELL_CLS}>
          {c.reviews.length > 0 && (
            <ContactReviewsToggle
              count={c.reviews.length}
              expanded={p.isReviewsExpanded}
              onToggle={p.onToggleReviews}
            />
          )}
        </td>
        <td
          className={cn(
            CELL_CLS,
            PINNED_CLS,
            "px-2",
            expanded ? "bg-admin-bg" : "bg-admin-surface group-hover:bg-admin-bg",
          )}
        >
          <div className="flex flex-wrap justify-end gap-0.5">
            <ContactRowActions
              compact
              mergeRole={p.mergeRole}
              onStartEdit={p.onStartEdit}
              onStartMerge={p.onStartMerge}
              onRequestDelete={p.onRequestDelete}
              onMergeHere={p.onMergeHere}
              onCancelMerge={p.onCancelMerge}
            />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-admin-bg">
          <td colSpan={COLUMNS} className="px-3 pt-0 pb-3">
            <div className={cn(FULL_ROW_CONTENT_CLS, "flex flex-col gap-2")}>
              {showSyncConfirm && (
                <ContactSyncConfirm c={c} onConfirm={p.onConfirmSync} onCancel={p.onCancelSync} />
              )}
              {p.isConfirmingDelete && (
                <ContactDeleteConfirm
                  c={c}
                  deleteGoogle={p.deleteGoogle}
                  onDeleteGoogleChange={p.onDeleteGoogleChange}
                  isDeleting={p.isDeleting}
                  onConfirm={p.onConfirmDelete}
                  onCancel={p.onCancelDelete}
                />
              )}
              {showReviews && <ContactReviewsList reviews={c.reviews} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Desktop table for a list of contacts.
 * @param props - Component props.
 * @param props.contacts - Contacts to show, already filtered, sorted and paged.
 * @param props.cardProps - Builds the ContactCard props for one contact.
 * @returns The table element.
 */
export function ContactTable({
  contacts,
  cardProps,
}: {
  contacts: ContactRow[];
  cardProps: (c: ContactRow) => Omit<ContactCardProps, "c">;
}): React.ReactElement {
  return (
    // @container: the full-width rows size themselves to this box with cqw units.
    <div className="@container hidden overflow-x-auto rounded-lg border border-admin-border lg:block">
      {/* Fixed layout, so every section's table lines its columns up with the others.
          Every column but Address is fixed, so Address takes all the spare width. */}
      <table className={cn(TABLE_CLS, "min-w-232 table-fixed")}>
        <colgroup>
          <col className="w-36" />
          <col className="w-44" />
          <col className="w-34" />
          <col />
          <col className="w-24" />
          <col className="w-24" />
          <col className="w-44" />
        </colgroup>
        <thead className={THEAD_CLS}>
          <tr>
            <th className={HEAD_CLS}>Name</th>
            <th className={HEAD_CLS}>Email</th>
            <th className={HEAD_CLS}>Phone</th>
            <th className={HEAD_CLS}>Address</th>
            <th className={cn(HEAD_CLS, "px-2")}>Sync</th>
            <th className={cn(HEAD_CLS, "px-2")}>Reviewed</th>
            <th className={cn(HEAD_CLS, PINNED_CLS, "bg-admin-bg px-2 text-right")}>Actions</th>
          </tr>
        </thead>
        <tbody className={TBODY_CLS}>
          {contacts.map((c) => (
            <ContactTableRow key={c.id} c={c} cardProps={cardProps(c)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
