"use client";
// src/features/reviews/components/admin/ReviewLinkHistoryParts.tsx
// Pieces shared by the review link history's phone cards and desktop table: the source
// badge, the contact and date lines, the inline contact editor and the row actions.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { formatNZPhone, isValidPhone, toE164NZ } from "@/shared/lib/normalise-phone";
import type React from "react";
import { CopyLinkButton } from "./CopyLinkButton";
import type { LinkHistoryEntry, LinkSource } from "./ReviewLinkHistoryTable";

/**
 * Badge colour per source. Tracked sends get a channel colour; the two
 * reconstructed sources stay grey so they read as "no send on record".
 */
const SOURCE_BADGE: Record<LinkSource, string> = {
  Auto: "bg-moonstone-400/15 text-moonstone-700",
  "Manual email": "bg-russian-violet/10 text-russian-violet",
  "Manual SMS": "bg-coquelicot-500/10 text-coquelicot-700",
  Invoice: "bg-mustard-300/25 text-mustard-700",
  Linked: "bg-admin-bg text-admin-text-secondary",
  Legacy: "bg-admin-bg text-admin-muted",
};

/** Hover text spelling out where each kind of row came from. */
const SOURCE_HINT: Record<LinkSource, string> = {
  Auto: "Sent automatically after the booking",
  "Manual email": "Emailed from the send form",
  "Manual SMS": "Sent as a text from the send form",
  Invoice: "Went out on the invoice email as the review line",
  Linked: "Review attached to this contact - no send on record",
  Legacy: "Review with no contact and no send on record",
};

/**
 * Whether a row was rebuilt from a review rather than a tracked send.
 * @param entry - The history row.
 * @returns True for Linked and Legacy rows.
 */
export function isReviewDerived(entry: LinkHistoryEntry): boolean {
  return entry.source === "Linked" || entry.source === "Legacy";
}

/**
 * Pill naming the channel a row came from, with a hover hint.
 * @param props - Component props.
 * @param props.source - The row's source.
 * @returns Badge element.
 */
export function SourceBadge({ source }: { source: LinkSource }): React.ReactElement {
  return (
    <span
      title={SOURCE_HINT[source]}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-sm font-medium whitespace-nowrap",
        SOURCE_BADGE[source],
      )}
    >
      {source}
    </span>
  );
}

/**
 * Reviewed / Not reviewed pill for a row.
 * @param props - Component props.
 * @param props.reviewed - Whether the link has been used.
 * @returns Pill element.
 */
export function ReviewedPill({ reviewed }: { reviewed: boolean }): React.ReactElement {
  return reviewed ? (
    <StatusPill tone="success">Reviewed</StatusPill>
  ) : (
    <StatusPill tone="neutral">Not reviewed</StatusPill>
  );
}

/**
 * The row's email, else its formatted phone, else an italic note saying none is on file.
 * @param props - Component props.
 * @param props.entry - The history row.
 * @returns Contact text element.
 */
export function ContactText({ entry }: { entry: LinkHistoryEntry }): React.ReactElement {
  const contact = entry.email ? entry.email : entry.phone ? formatNZPhone(entry.phone) : null;
  return (
    <>
      {contact ?? (
        <span className="text-admin-muted italic">
          {entry.id ? "no contact details" : "no contact on file"}
        </span>
      )}
    </>
  );
}

/**
 * The row's date. Linked and Legacy rows have no send on record, so their date is when
 * the review landed, and it says so rather than reading as a send date.
 * @param entry - The history row.
 * @returns Date label.
 */
export function dateLabel(entry: LinkHistoryEntry): string {
  return isReviewDerived(entry)
    ? `reviewed ${formatDateShort(entry.sentAt)}`
    : formatDateShort(entry.sentAt);
}

/**
 * Pencil button that opens the inline contact editor.
 * @param props - Component props.
 * @param props.onClick - Opens the editor.
 * @returns Button element.
 */
export function EditContactButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-admin-muted transition-colors hover:bg-admin-bg hover:text-russian-violet"
      aria-label="Edit contact details"
    >
      ✎
    </button>
  );
}

/**
 * Inline email and phone editor for a contact-backed row. The phone is validated as
 * typed and formatted on blur; an invalid phone blocks Save.
 * @param props - Component props.
 * @param props.email - Email being edited.
 * @param props.onEmailChange - Sets the email.
 * @param props.phone - Phone being edited, as typed.
 * @param props.onPhoneChange - Sets the phone.
 * @param props.saving - Whether a save is in flight.
 * @param props.onSave - Saves the edit.
 * @param props.onCancel - Closes the editor unchanged.
 * @returns Editor element.
 */
export function ContactEditForm({
  email,
  onEmailChange,
  phone,
  onPhoneChange,
  saving,
  onSave,
  onCancel,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const phoneValid = isValidPhone(toE164NZ(phone));
  return (
    <div className="flex flex-col gap-2">
      <AdminInput
        type="email"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        placeholder="Email (optional)"
      />
      <AdminInput
        type="tel"
        value={phone}
        onChange={(e) => onPhoneChange(e.target.value)}
        onBlur={(e) => onPhoneChange(formatNZPhone(e.target.value))}
        placeholder="021 123 1234"
        className={phone && !phoneValid ? "border-coquelicot-500/60" : undefined}
      />
      {phone && (
        <p className={cn("text-sm", phoneValid ? "text-admin-muted" : "text-coquelicot-600")}>
          {phoneValid ? `Stored as: ${toE164NZ(phone)}` : "Invalid phone number"}
        </p>
      )}
      <div className="flex gap-2">
        <AdminButton
          variant="outline"
          disabled={saving || (!!phone && !phoneValid)}
          onClick={onSave}
          size="xs"
        >
          {saving ? "Saving…" : "Save"}
        </AdminButton>
        <AdminButton variant="ghost" onClick={onCancel} size="xs">
          Cancel
        </AdminButton>
      </div>
    </div>
  );
}

/**
 * Copy link, Send again (contact-backed rows with an email) and Revoke (contact-backed
 * rows not yet reviewed).
 * @param props - Component props.
 * @param props.entry - The history row.
 * @param props.onSendAgain - Starts a fresh email ask to this person.
 * @param props.onRevoke - Opens the revoke confirm for this row.
 * @param props.pushRevokeRight - Push Revoke to the far end of the row, as the phone card does.
 * @returns The action buttons, as a fragment for the caller's flex row.
 */
export function HistoryRowActions({
  entry,
  onSendAgain,
  onRevoke,
  pushRevokeRight = false,
}: {
  entry: LinkHistoryEntry;
  onSendAgain: () => void;
  onRevoke: () => void;
  pushRevokeRight?: boolean;
}): React.ReactElement {
  return (
    <>
      {entry.reviewUrl !== "" && <CopyLinkButton url={entry.reviewUrl} />}
      {entry.id && entry.email && (
        <AdminButton variant="outline" onClick={onSendAgain} size="xs">
          Send again
        </AdminButton>
      )}
      {entry.id && !entry.reviewed && (
        <AdminButton
          variant="danger"
          onClick={onRevoke}
          size="xs"
          className={pushRevokeRight ? "ml-auto" : undefined}
        >
          Revoke
        </AdminButton>
      )}
    </>
  );
}
