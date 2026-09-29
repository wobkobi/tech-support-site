"use client";

import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
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
      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
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
}: ContactCardProps): React.ReactElement {
  if (edit) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-wide text-russian-violet uppercase">
            Editing
          </span>
          <span className="text-xs text-slate-400">{formatDateShort(c.createdAt)}</span>
        </div>
        {CONTACT_EDIT_FIELDS.map((f) => {
          const inputId = `edit-${f.key}-${c.id}`;
          return (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-russian-violet" htmlFor={inputId}>
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
        {edit.error && <p className="text-sm font-medium text-coquelicot-400">{edit.error}</p>}
        <div className="flex gap-2">
          <button
            onClick={edit.save}
            disabled={edit.saving}
            className="rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-russian-violet/90 disabled:bg-russian-violet/40"
          >
            {edit.saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={edit.cancel}
            disabled={edit.saving}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Link
          href={`/admin/contacts/${c.id}`}
          className="min-w-0 truncate font-semibold text-russian-violet hover:underline"
        >
          {c.name}
        </Link>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs whitespace-nowrap text-slate-400">
            {formatDateShort(c.createdAt)}
          </span>
          {!c.googleContactId &&
            (isSyncing ? (
              <span className="text-xs text-slate-400">Syncing…</span>
            ) : isConfirmingSync ? (
              <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                <p className="font-medium text-slate-600">Sync to Google?</p>
                <div className="space-y-0.5 break-all text-slate-500">
                  <p>{c.name}</p>
                  {c.email && <p>{c.email}</p>}
                  {c.phone && <p>{formatNZPhone(c.phone)}</p>}
                  {c.address && <p>{c.address}</p>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={onConfirmSync}
                    className="rounded bg-russian-violet px-2 py-0.5 text-xs font-semibold text-white transition-colors hover:bg-russian-violet/90"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={onCancelSync}
                    className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={onRequestSync}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-russian-violet/70 transition-colors hover:text-russian-violet"
              >
                Sync to Google
              </button>
            ))}
          {c.googleContactId && (
            <span className="rounded px-1.5 py-0.5 text-xs text-slate-400">Synced</span>
          )}
          {mergeRole === "target" ? (
            <button
              onClick={onMergeHere}
              className="rounded bg-russian-violet px-1.5 py-0.5 text-xs font-semibold text-white transition-colors hover:bg-russian-violet/90"
            >
              Keep this one
            </button>
          ) : mergeRole === "source" ? (
            <button
              onClick={onCancelMerge}
              className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-200"
            >
              Merging - cancel
            </button>
          ) : (
            <>
              <button
                onClick={onStartEdit}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-russian-violet/70 transition-colors hover:text-russian-violet"
              >
                Edit
              </button>
              <button
                onClick={onStartMerge}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-400 transition-colors hover:text-russian-violet"
              >
                Merge
              </button>
              <button
                onClick={onRequestDelete}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-400 transition-colors hover:text-coquelicot-400"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {isConfirmingDelete && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-coquelicot-800 bg-coquelicot-50 px-3 py-2 text-xs">
          <span className="font-medium text-coquelicot-300">Delete {c.name}?</span>
          <span className="text-slate-500">Linked reviews are kept.</span>
          {c.googleContactId && (
            <label className="flex items-center gap-1.5 text-slate-600">
              <input
                type="checkbox"
                checked={deleteGoogle}
                onChange={(e) => onDeleteGoogleChange(e.target.checked)}
                disabled={isDeleting}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              Google contact too
            </label>
          )}
          <button
            onClick={onConfirmDelete}
            disabled={isDeleting}
            className="ml-auto rounded bg-coquelicot-400 px-2 py-0.5 font-semibold text-white transition-colors hover:bg-coquelicot-300 disabled:opacity-50"
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
          <button
            onClick={onCancelDelete}
            disabled={isDeleting}
            className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
      {c.email ? (
        <a
          href={`mailto:${c.email}`}
          className="text-sm break-all text-moonstone-700 transition-colors hover:text-moonstone-800"
        >
          {c.email}
        </a>
      ) : (
        <span className="text-sm text-slate-400 italic">No email</span>
      )}
      {c.altEmails.length > 0 && (
        <p className="text-xs break-all text-slate-400">also: {c.altEmails.join(", ")}</p>
      )}
      {c.phone && (
        <a
          href={`tel:${c.phone}`}
          className="text-sm text-slate-500 transition-colors hover:text-slate-700"
        >
          {formatNZPhone(c.phone)}
        </a>
      )}
      {c.altPhones.length > 0 && (
        <p className="text-xs text-slate-400">
          also: {c.altPhones.map((p) => formatNZPhone(p)).join(", ")}
        </p>
      )}
      {c.address && <p className="text-sm wrap-break-word text-slate-500">{c.address}</p>}
      {c.reviews.length > 0 && (
        <div className="mt-1">
          <button
            onClick={onToggleReviews}
            className="text-xs font-medium text-russian-violet/60 transition-colors hover:text-russian-violet"
          >
            {isReviewsExpanded
              ? "Hide reviews"
              : `${c.reviews.length} linked review${c.reviews.length === 1 ? "" : "s"}`}
          </button>
          {isReviewsExpanded && (
            <div className="mt-2 flex flex-col gap-1.5">
              {c.reviews.map((rv) => (
                <div
                  key={rv.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-russian-violet/70">
                      {formatReviewerName(rv)}
                    </span>
                    {rv.customerRef && (
                      <a
                        href={`/review?token=${rv.customerRef}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs font-medium text-moonstone-700 transition-colors hover:text-moonstone-800"
                      >
                        Review link ↗
                      </a>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
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
