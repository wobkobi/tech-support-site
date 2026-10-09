"use client";
// src/features/contacts/components/ContactCard.tsx
// One contact row in the admin contacts list: view mode, inline edit with multiple
// emails/phones and Places-backed addresses, and its source/target role in a merge.
// Phones show it as the row; the desktop table opens its editor in an expanding row.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import {
  CONTACT_LINK_CLS,
  ContactDeleteConfirm,
  ContactReviewsList,
  ContactReviewsToggle,
  ContactRowActions,
  ContactSyncConfirm,
  ContactSyncStatus,
} from "@/features/contacts/components/ContactRowParts";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { formatNZPhone } from "@/shared/lib/normalise-phone";
import Link from "next/link";
import type React from "react";

export interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  /** Additional emails this person uses; a booking/review under any resolves here. */
  altEmails: string[];
  phone: string | null;
  /** Additional phone numbers (canonical form); matched like the primary. */
  altPhones: string[];
  address: string | null;
  /** Business the person invoices under (from Google), or null. */
  company: string | null;
  createdAt: string;
  /** Google People API resource name if synced, or null */
  googleContactId: string | null;
  /** Retainer tier label when this contact is a retainer client, or null. */
  retainerTier: string | null;
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

export interface EditValues {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface EditFormState {
  values: EditValues;
  saving: boolean;
  error: string | null;
  setField: <K extends keyof EditValues>(field: K, value: EditValues[K]) => void;
  save: () => void;
  cancel: () => void;
}

/**
 * A card's role in an in-progress merge: "idle" (no merge running), "source"
 * (this card is the one being merged away), or "target" (a candidate to merge
 * the source into and keep).
 */
export type MergeRole = "idle" | "source" | "target";

export interface ContactCardProps {
  c: ContactRow;
  /** Non-null only when this card is the one being edited. */
  edit: EditFormState | null;
  isSyncing: boolean;
  isConfirmingSync: boolean;
  isReviewsExpanded: boolean;
  isConfirmingDelete: boolean;
  isDeleting: boolean;
  /** Whether confirming will also delete the linked Google contact. */
  deleteGoogle: boolean;
  onDeleteGoogleChange: (value: boolean) => void;
  mergeRole: MergeRole;
  onStartEdit: () => void;
  onRequestSync: () => void;
  onConfirmSync: () => void;
  onCancelSync: () => void;
  onToggleReviews: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onStartMerge: () => void;
  onMergeHere: () => void;
  onCancelMerge: () => void;
  /**
   * Prefix for the edit inputs' DOM ids. The phone card and the desktop table's
   * expanding row both mount while editing, so the table passes its own prefix to keep
   * every label pointing at its own input. Defaults to "edit".
   */
  fieldIdPrefix?: string;
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
    <AdminInput id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
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
  return <EmailInput id={id} value={value} onChange={onChange} className={ADMIN_INPUT_CLS} />;
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
  return <PhoneInput id={id} value={value} onChange={onChange} className={ADMIN_INPUT_CLS} />;
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
      inputClassName={ADMIN_INPUT_CLS}
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
 * @param props.isConfirmingDelete - True when the delete confirmation panel is open.
 * @param props.isDeleting - True while this contact is mid-delete.
 * @param props.deleteGoogle - Whether the linked Google contact goes too.
 * @param props.onDeleteGoogleChange - Toggles that choice.
 * @param props.mergeRole - This card's role in an in-progress merge (idle/source/target).
 * @param props.onStartEdit - Opens the edit form for this contact.
 * @param props.onRequestSync - Opens the sync-to-Google confirmation.
 * @param props.onConfirmSync - Confirms and runs the sync.
 * @param props.onCancelSync - Cancels the pending sync confirmation.
 * @param props.onToggleReviews - Toggles the linked-reviews panel.
 * @param props.onRequestDelete - Opens the delete confirmation for this contact.
 * @param props.onConfirmDelete - Confirms and runs the soft-delete.
 * @param props.onCancelDelete - Cancels the pending delete confirmation.
 * @param props.onStartMerge - Selects this contact as the one to merge away.
 * @param props.onMergeHere - Merges the selected source contact into this one.
 * @param props.onCancelMerge - Cancels the in-progress merge.
 * @param props.fieldIdPrefix - Prefix for the edit inputs' DOM ids.
 * @returns Contact card element.
 */
export function ContactCard({
  c,
  edit,
  isSyncing,
  isConfirmingSync,
  isReviewsExpanded,
  isConfirmingDelete,
  isDeleting,
  deleteGoogle,
  onDeleteGoogleChange,
  mergeRole,
  onStartEdit,
  onRequestSync,
  onConfirmSync,
  onCancelSync,
  onToggleReviews,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onStartMerge,
  onMergeHere,
  onCancelMerge,
  fieldIdPrefix = "edit",
}: ContactCardProps): React.ReactElement {
  if (edit) {
    return (
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold tracking-wide text-russian-violet uppercase">
            Editing
          </span>
          <span className="text-sm text-admin-muted">{formatDateShort(c.createdAt)}</span>
        </div>
        {CONTACT_EDIT_FIELDS.map((f) => {
          const inputId = `${fieldIdPrefix}-${f.key}-${c.id}`;
          return (
            <AdminField key={f.key} label={f.label} htmlFor={inputId}>
              {f.render({
                id: inputId,
                value: edit.values[f.key],
                onChange: edit.setField.bind(null, f.key),
              })}
            </AdminField>
          );
        })}
        {edit.error && <p className="text-sm font-medium text-coquelicot-700">{edit.error}</p>}
        <div className="flex gap-2">
          <AdminButton onClick={edit.save} disabled={edit.saving}>
            {edit.saving ? "Saving…" : "Save"}
          </AdminButton>
          <AdminButton variant="secondary" onClick={edit.cancel} disabled={edit.saving}>
            Cancel
          </AdminButton>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-1 overflow-hidden">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Link
          href={`/admin/contacts/${c.id}`}
          className="min-w-0 truncate font-semibold text-russian-violet hover:underline"
        >
          {c.name}
          {c.company && (
            <span className="ml-2 text-sm font-normal text-admin-muted">{c.company}</span>
          )}
        </Link>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-sm whitespace-nowrap text-admin-muted">
            {formatDateShort(c.createdAt)}
          </span>
          {!c.googleContactId && isConfirmingSync ? (
            <ContactSyncConfirm c={c} onConfirm={onConfirmSync} onCancel={onCancelSync} />
          ) : (
            <ContactSyncStatus c={c} isSyncing={isSyncing} onRequestSync={onRequestSync} />
          )}
          <ContactRowActions
            mergeRole={mergeRole}
            onStartEdit={onStartEdit}
            onStartMerge={onStartMerge}
            onRequestDelete={onRequestDelete}
            onMergeHere={onMergeHere}
            onCancelMerge={onCancelMerge}
          />
        </div>
      </div>
      {isConfirmingDelete && (
        <div className="mt-2">
          <ContactDeleteConfirm
            c={c}
            deleteGoogle={deleteGoogle}
            onDeleteGoogleChange={onDeleteGoogleChange}
            isDeleting={isDeleting}
            onConfirm={onConfirmDelete}
            onCancel={onCancelDelete}
          />
        </div>
      )}
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
      {c.phone && (
        <a
          href={`tel:${c.phone}`}
          className="text-sm text-admin-text-secondary transition-colors hover:text-admin-text"
        >
          {formatNZPhone(c.phone)}
        </a>
      )}
      {c.altPhones.length > 0 && (
        <p className="text-sm text-admin-muted">
          also: {c.altPhones.map((p) => formatNZPhone(p)).join(", ")}
        </p>
      )}
      {c.address && (
        <p className="text-sm wrap-break-word text-admin-text-secondary">{c.address}</p>
      )}
      {c.reviews.length > 0 && (
        <div className="mt-1">
          <ContactReviewsToggle
            count={c.reviews.length}
            expanded={isReviewsExpanded}
            onToggle={onToggleReviews}
          />
          {isReviewsExpanded && (
            <div className="mt-2">
              <ContactReviewsList reviews={c.reviews} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
