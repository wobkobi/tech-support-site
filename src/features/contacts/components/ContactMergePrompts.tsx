"use client";
// src/features/contacts/components/ContactMergePrompts.tsx
// The two prompts of a contact merge in the admin list: the amber banner shown while the
// operator picks the contact to keep, and the confirm dialog once they have. The list owns
// the merge state and passes it in.

import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import type { ContactRow } from "@/features/contacts/components/ContactCard";
import type React from "react";

/**
 * Banner shown while a merge waits for its survivor to be picked.
 * @param props - Component props.
 * @param props.source - The contact being merged away, if found.
 * @param props.onCancel - Cancels the merge.
 * @returns The banner element.
 */
export function ContactMergeBanner({
  source,
  onCancel,
}: {
  source: ContactRow | undefined;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span>
        Merging <strong>{source?.name ?? "contact"}</strong> - pick the contact to keep by clicking
        &ldquo;Keep this one&rdquo;. Its reviews move over and this duplicate is removed.
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="ml-auto font-semibold text-amber-900 underline underline-offset-2 hover:decoration-2"
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * Confirm for a merge, since it can't be undone. Open once both contacts are picked.
 * @param props - Component props.
 * @param props.source - The contact being merged away.
 * @param props.target - The contact being kept.
 * @param props.busy - True while the merge runs.
 * @param props.onConfirm - Runs the merge.
 * @param props.onCancel - Closes the dialog and keeps the merge picking.
 * @returns The dialog element.
 */
export function ContactMergeDialog({
  source,
  target,
  busy,
  onConfirm,
  onCancel,
}: {
  source: ContactRow | undefined;
  target: ContactRow | undefined;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <ConfirmDialog
      open={source !== undefined && target !== undefined}
      title={`Merge into ${target?.name ?? "this contact"}?`}
      body={
        <p>
          <strong>{target?.name}</strong> keeps its details and fills any blanks from{" "}
          <strong>{source?.name}</strong>. Reviews, emails and phone numbers move across, then{" "}
          <strong>{source?.name}</strong> is deleted
          {source?.googleContactId && source.googleContactId !== target?.googleContactId
            ? " here and from Google Contacts"
            : ""}
          . This can&apos;t be undone.
        </p>
      }
      confirmLabel="Merge"
      tone="danger"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
