"use client";
// src/features/booking/components/admin/BookingInfoCard.tsx
// Editable customer/booking info card on the booking detail page:
// name, email, phone, address, and notes. View mode shows the values, with a Maps link
// on the address; Edit mode swaps in the shared email and phone inputs and the Places
// autocomplete, checks them before saving via the sparse admin bookings PATCH, then
// refreshes the page. Only the free text is shown and edited - the notes blob's
// metadata block is machine-written mirror, surfaced on this page as chips - but the
// address is still written back into its "Address:" line, the convention the PATCH
// route and contact backfill both read.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { FieldError } from "@/features/admin/components/ui/FieldError";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import {
  type ContactFieldErrors,
  checkContactFields,
  focusFirstInvalid,
} from "@/features/admin/lib/contact-fields";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import { mapsSearchUrl, parseBookingNotes, replaceUserNotes } from "@/features/booking/lib/booking";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** Props for {@link BookingInfoCard}. */
interface BookingInfoCardProps {
  /** Booking id. */
  id: string;
  /** Customer name. */
  name: string;
  /** Customer email. */
  email: string;
  /** Customer phone (nullable). */
  phone: string | null;
  /** Address column; legacy rows carry it only in the notes "Address:" line. */
  address: string | null;
  /** Raw booking notes blob (nullable): free text plus the metadata mirror. */
  notes: string | null;
}

const LABEL_CLS = "text-xs font-semibold text-admin-muted uppercase";

/**
 * A read-only label/value row.
 * @param props - Component props.
 * @param props.label - Field label.
 * @param props.children - Field value.
 * @returns The row element.
 */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={LABEL_CLS}>{label}</span>
      <span className="text-sm wrap-break-word text-admin-text">{children}</span>
    </div>
  );
}

/**
 * Editable booking info card.
 * @param props - Component props.
 * @param props.id - Booking id.
 * @param props.name - Customer name.
 * @param props.email - Customer email.
 * @param props.phone - Customer phone (nullable).
 * @param props.address - Address column (nullable).
 * @param props.notes - Booking notes (nullable).
 * @returns The info card element.
 */
export function BookingInfoCard({
  id,
  name,
  email,
  phone,
  address,
  notes,
}: BookingInfoCardProps): React.ReactElement {
  const router = useRouter();
  const { patchBooking } = useBookingActions();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const fieldIds = {
    name: `edit-name-${id}`,
    email: `edit-email-${id}`,
    phone: `edit-phone-${id}`,
  };

  // Prefer the column; legacy rows predate it and carry the address only in the
  // notes text, which parseBookingNotes reads back off the "Address:" line.
  const parsed = parseBookingNotes(notes);
  const initialAddress = address?.trim() || parsed.address;
  const [form, setForm] = useState({
    name,
    email,
    phone: phone ?? "",
    address: initialAddress,
    notes: parsed.userNotes,
  });

  /**
   * Updates one field and clears its error, so a fix is acknowledged as it's typed.
   * @param key - Field to update.
   * @param value - New value.
   */
  function setField(key: keyof typeof form, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (key in e ? { ...e, [key]: undefined } : e));
  }

  /**
   * Resets the form to the current props and leaves edit mode.
   */
  function cancel(): void {
    setForm({
      name,
      email,
      phone: phone ?? "",
      address: initialAddress,
      notes: parsed.userNotes,
    });
    setErrors({});
    setEditing(false);
  }

  /**
   * Saves the edits once the fields check out. Puts the edited free text back in
   * front of the untouched metadata block and keeps its "Address:" line in step.
   * `address` is sent only when it changed, since the route copies it onto the
   * linked contact; refreshes on success.
   */
  async function save(): Promise<void> {
    const found = checkContactFields(form, { emailRequired: true });
    setErrors(found);
    if (focusFirstInvalid(found, fieldIds)) return;
    setSaving(true);
    const nextAddress = form.address.trim();
    const addressChanged = nextAddress !== initialAddress.trim();
    const rebuilt = replaceUserNotes(notes, form.notes);
    // A cleared address drops the notes line too, or the card would read it back
    // as the address.
    const mergedNotes = addressChanged
      ? rebuilt.replace(/^(Address:\s*).*$/im, nextAddress ? `$1${nextAddress}` : "")
      : rebuilt;
    const result = await patchBooking(
      id,
      {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        notes: mergedNotes,
        address: addressChanged ? nextAddress : undefined,
      },
      "Booking updated.",
    );
    setSaving(false);
    if (result.ok) {
      setEditing(false);
      router.refresh();
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-admin-text">Customer</h2>
          <AdminButton variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </AdminButton>
        </div>
        <Row label="Name">{name}</Row>
        <Row label="Email">
          <a href={`mailto:${email}`} className="text-blue-500 hover:text-blue-700">
            {email}
          </a>
        </Row>
        <Row label="Phone">
          {phone ? (
            <a href={`tel:${phone}`} className="text-blue-500 hover:text-blue-700">
              {phone}
            </a>
          ) : (
            <span className="text-admin-faint">Not provided</span>
          )}
        </Row>
        {initialAddress && (
          <Row label="Address">
            {initialAddress}{" "}
            <a
              href={mapsSearchUrl(initialAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap text-blue-500 hover:text-blue-700"
            >
              Maps ↗
            </a>
          </Row>
        )}
        <Row label="Notes">
          {parsed.userNotes ? (
            <span className="whitespace-pre-wrap">{parsed.userNotes}</span>
          ) : (
            <span className="text-admin-faint">None</span>
          )}
        </Row>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-bold text-admin-text">Edit customer</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldIds.name} className={LABEL_CLS}>
          Name
        </label>
        <input
          id={fieldIds.name}
          className={cn(ADMIN_INPUT_CLS, errors.name && "border-coquelicot-500/60")}
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${fieldIds.name}-error` : undefined}
          autoComplete="off"
          disabled={saving}
        />
        <FieldError id={`${fieldIds.name}-error`} message={errors.name} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldIds.email} className={LABEL_CLS}>
          Email
        </label>
        <EmailInput
          id={fieldIds.email}
          value={form.email}
          onChange={(v) => setField("email", v)}
          error={errors.email}
          maxLength={320}
          autoComplete="off"
          className={ADMIN_INPUT_CLS}
          disabled={saving}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldIds.phone} className={LABEL_CLS}>
          Phone
        </label>
        <PhoneInput
          id={fieldIds.phone}
          value={form.phone}
          onChange={(v) => setField("phone", v)}
          error={errors.phone}
          placeholder="Phone number"
          autoComplete="off"
          className={ADMIN_INPUT_CLS}
          disabled={saving}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`edit-address-${id}`} className={LABEL_CLS}>
          Address
        </label>
        <AddressAutocomplete
          id={`edit-address-${id}`}
          value={form.address}
          onChange={(v: string) => setField("address", v)}
          placeholder="Leave blank for a remote job"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`edit-notes-${id}`} className={LABEL_CLS}>
          Notes
        </label>
        <textarea
          id={`edit-notes-${id}`}
          className={cn(ADMIN_INPUT_CLS, "min-h-25 resize-y")}
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          disabled={saving}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <AdminButton onClick={() => void save()} busy={saving}>
          Save changes
        </AdminButton>
        <AdminButton variant="secondary" onClick={cancel} disabled={saving}>
          Cancel
        </AdminButton>
      </div>
    </div>
  );
}
