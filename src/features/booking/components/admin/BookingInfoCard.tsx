"use client";
// src/features/booking/components/admin/BookingInfoCard.tsx
/**
 * @description Editable customer/booking info card on the booking detail page:
 * name, email, phone, address, and notes. View mode shows the values; Edit mode
 * swaps in inputs (address uses the Places autocomplete) and saves via the sparse
 * admin bookings PATCH, then refreshes the page. Only the free text is shown and
 * edited - the notes blob's metadata block is machine-written mirror, surfaced on
 * this page as chips - but the address is still written back into its "Address:"
 * line, the convention the PATCH route and contact backfill both read.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import { parseBookingNotes, replaceUserNotes } from "@/features/booking/lib/booking";
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

const INPUT_CLS = cn(
  "w-full rounded-lg border border-admin-border-strong bg-admin-surface px-3 py-2 text-sm text-admin-text",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet",
);
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
    setEditing(false);
  }

  /**
   * Saves the edits. Puts the edited free text back in front of the untouched
   * metadata block, merges the address into its "Address:" line, and sends
   * `address` so the linked contact syncs too; refreshes on success.
   */
  async function save(): Promise<void> {
    setSaving(true);
    const rebuilt = replaceUserNotes(notes, form.notes);
    // Keep the notes "Address:" line in step with the edited address (same as the
    // route's contact sync); when there's no Address line the replace is a no-op.
    const mergedNotes = form.address
      ? rebuilt.replace(/^(Address:\s*).*$/im, `$1${form.address.trim()}`)
      : rebuilt;
    const result = await patchBooking(
      id,
      {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        notes: mergedNotes,
        address: form.address || undefined,
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
        {initialAddress && <Row label="Address">{initialAddress}</Row>}
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
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLS}>Name</span>
        <input
          className={INPUT_CLS}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          disabled={saving}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLS}>Email</span>
        <input
          type="email"
          className={INPUT_CLS}
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          disabled={saving}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLS}>Phone</span>
        <input
          type="tel"
          className={INPUT_CLS}
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          placeholder="Phone number"
          disabled={saving}
        />
      </label>
      {initialAddress !== "" && (
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Address</span>
          <AddressAutocomplete
            id={`edit-address-${id}`}
            value={form.address}
            onChange={(v: string) => setForm((f) => ({ ...f, address: v }))}
            placeholder="Full address for travel time calculations"
          />
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLS}>Notes</span>
        <textarea
          className={cn(INPUT_CLS, "min-h-25 resize-y")}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          disabled={saving}
        />
      </label>
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
