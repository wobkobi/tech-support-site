"use client";
// src/features/booking/components/admin/BookingInfoCard.tsx
// Editable customer/booking info card on the booking detail page. Only the notes' free
// text is edited; the address is still mirrored into its "Address:" line.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import {
  ADMIN_INPUT_CLS,
  ADMIN_LINK_CLS,
  ADMIN_META_LABEL_CLS,
} from "@/features/admin/components/ui/field-classes";
import { FieldError } from "@/features/admin/components/ui/FieldError";
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
  /** Address with any unit ("12/160 Kepa Rd"); legacy rows carry it only in the notes. */
  address: string | null;
  /** Raw booking notes blob (nullable): free text plus the metadata mirror. */
  notes: string | null;
  /** Customer's visit notes: parking, directions, access (nullable). */
  accessNotes: string | null;
}

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
      <span className={ADMIN_META_LABEL_CLS}>{label}</span>
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
 * @param props.address - Address with any unit (nullable).
 * @param props.notes - Booking notes (nullable).
 * @param props.accessNotes - Visit notes (nullable).
 * @returns The info card element.
 */
export function BookingInfoCard({
  id,
  name,
  email,
  phone,
  address,
  notes,
  accessNotes,
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

  // Legacy rows carry the address only in the notes' "Address:" line.
  const parsed = parseBookingNotes(notes);
  const initialAddress = address?.trim() || parsed.address;
  const [form, setForm] = useState({
    name,
    email,
    phone: phone ?? "",
    address: initialAddress,
    notes: parsed.userNotes,
    accessNotes: accessNotes ?? "",
  });

  /**
   * Updates one field and clears its error.
   * @param key - Field to update.
   * @param value - New value.
   */
  function setField(key: keyof typeof form, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (key in e ? { ...e, [key]: undefined } : e));
  }

  /** Resets the form to the current props and leaves edit mode. */
  function cancel(): void {
    setForm({
      name,
      email,
      phone: phone ?? "",
      address: initialAddress,
      notes: parsed.userNotes,
      accessNotes: accessNotes ?? "",
    });
    setErrors({});
    setEditing(false);
  }

  /**
   * Saves valid edits, keeping the metadata block and "Address:" line in step. `address` is
   * sent only when changed, since the route copies it onto the contact.
   */
  async function save(): Promise<void> {
    const found = checkContactFields(form, { emailRequired: true });
    setErrors(found);
    if (focusFirstInvalid(found, fieldIds)) return;
    setSaving(true);
    const nextAddress = form.address.trim();
    const addressChanged = nextAddress !== initialAddress.trim();
    const rebuilt = replaceUserNotes(notes, form.notes);
    // A cleared address drops the notes line too.
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
        accessNotes: form.accessNotes,
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
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-admin-text">Customer</h2>
          <AdminButton variant="ghost" onClick={() => setEditing(true)} className="-my-2">
            Edit
          </AdminButton>
        </div>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          <Row label="Name">{name}</Row>
          <Row label="Email">
            <a href={`mailto:${email}`} className={ADMIN_LINK_CLS}>
              {email}
            </a>
          </Row>
          <Row label="Phone">
            {phone ? (
              <a href={`tel:${phone}`} className={ADMIN_LINK_CLS}>
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
                className={cn(ADMIN_LINK_CLS, "whitespace-nowrap")}
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
          {accessNotes && (
            <Row label="Visit notes">
              <span className="whitespace-pre-wrap">{accessNotes}</span>
            </Row>
          )}
        </div>
      </div>
    );
  }

  // Six tracks on xl: name, email and phone take two each, then the notes half each.
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <h2 className="col-span-full text-base font-bold text-admin-text">Edit customer</h2>
      <AdminField label="Name" htmlFor={fieldIds.name} className="xl:col-span-2">
        <AdminInput
          id={fieldIds.name}
          className={cn(errors.name && "border-coquelicot-500/60")}
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${fieldIds.name}-error` : undefined}
          autoComplete="off"
          disabled={saving}
        />
        <FieldError id={`${fieldIds.name}-error`} message={errors.name} />
      </AdminField>
      <AdminField label="Email" htmlFor={fieldIds.email} className="xl:col-span-2">
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
      </AdminField>
      <AdminField label="Phone" htmlFor={fieldIds.phone} className="xl:col-span-2">
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
      </AdminField>
      <AdminField label="Address" htmlFor={`edit-address-${id}`} className="col-span-full">
        <AddressAutocomplete
          id={`edit-address-${id}`}
          value={form.address}
          onChange={(v: string) => setField("address", v)}
          placeholder="Leave blank for a remote job"
          inputClassName={ADMIN_INPUT_CLS}
        />
      </AdminField>
      <AdminField label="Notes" htmlFor={`edit-notes-${id}`} className="xl:col-span-3">
        <AdminTextarea
          id={`edit-notes-${id}`}
          className="min-h-25"
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          disabled={saving}
        />
      </AdminField>
      <AdminField label="Visit notes" htmlFor={`edit-access-notes-${id}`} className="xl:col-span-3">
        <AdminTextarea
          id={`edit-access-notes-${id}`}
          className="min-h-20"
          value={form.accessNotes}
          onChange={(e) => setField("accessNotes", e.target.value)}
          placeholder="Parking, directions, gate codes, pets"
          disabled={saving}
        />
      </AdminField>
      <div className="col-span-full flex flex-wrap gap-2">
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
