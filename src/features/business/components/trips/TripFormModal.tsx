"use client";
// src/features/business/components/trips/TripFormModal.tsx
// Add or edit one trip: who it was to, where (the address is saved with the trip), date,
// round-trip km, purpose and notes. Picking a saved contact fills the address from their
// contact and looks up the km from Google Maps (round trip from the base address); an
// address can also be typed or picked from Places. Saves through the trips API and hands
// the stored row back. The parent mounts it per trip (keyed), so the form starts from that
// trip's values without an effect.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { ADMIN_CONTROL_CLS } from "@/features/admin/components/ui/field-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { FiledYearWarning } from "@/features/business/components/tax/FiledYearWarning";
import type { FiledYearRef } from "@/features/business/lib/tax/snapshot";
import {
  MAX_DESTINATION_LEN,
  MAX_TRIP_KM,
  type TripApiResponse,
  type TripContact,
  type TripDistanceApiResponse,
  type TripRow,
} from "@/features/business/lib/trips";
import type { GoogleContact } from "@/features/business/types/business";
import { ContactNameInput } from "@/features/contacts/components/ContactNameInput";
import { Notice } from "@/shared/components/Notice";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId, useMemo, useRef, useState } from "react";

/** Props for {@link TripFormModal}. */
interface TripFormModalProps {
  /** Trip being edited, or null to add a new one. */
  trip: TripRow | null;
  /** Date a new trip starts on (YYYY-MM-DD). */
  defaultDate: string;
  /** Saved contacts the "Who" box searches. */
  contacts: readonly TripContact[];
  /** Called after a successful save with the stored row. */
  onSaved: (trip: TripRow) => void;
  /** Closes the dialog without saving. */
  onClose: () => void;
  /** Filed years the edit forms warn about, oldest first. */
  filedYears: readonly FiledYearRef[];
}

/** The form's field values, all as typed. */
interface TripForm {
  date: string;
  km: string;
  purpose: string;
  destination: string;
  /** Picked contact, or "" when none is. */
  contactId: string;
  notes: string;
}

/**
 * Starting values: the trip's own, or blanks on the default date for a new trip.
 * @param trip - Trip being edited, or null.
 * @param defaultDate - Date for a new trip.
 * @returns Initial form values.
 */
function initialForm(trip: TripRow | null, defaultDate: string): TripForm {
  return trip
    ? {
        date: trip.date.slice(0, 10),
        km: String(trip.km),
        purpose: trip.purpose,
        destination: trip.destination ?? "",
        contactId: trip.contactId ?? "",
        notes: trip.notes ?? "",
      }
    : { date: defaultDate, km: "", purpose: "", destination: "", contactId: "", notes: "" };
}

/**
 * Trip add/edit dialog.
 * @param props - Component props.
 * @param props.trip - Trip being edited, or null to add one.
 * @param props.defaultDate - Date a new trip starts on.
 * @param props.contacts - Saved contacts the "Who" box searches.
 * @param props.onSaved - Called with the stored row after a save.
 * @param props.onClose - Closes the dialog.
 * @param props.filedYears - Filed years the edit forms warn about.
 * @returns The dialog element.
 */
export function TripFormModal({
  trip,
  defaultDate,
  contacts,
  onSaved,
  onClose,
  filedYears,
}: TripFormModalProps): React.ReactElement {
  const idBase = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const searchable = useMemo<GoogleContact[]>(() => [...contacts], [contacts]);
  const [initial] = useState(() => initialForm(trip, defaultDate));
  const [form, setForm] = useState<TripForm>(initial);
  // The "Who" box text. Only the picked contact's id is saved; a contact deleted since
  // the trip was logged shows blank.
  const [who, setWho] = useState(() => contactById.get(initial.contactId)?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookup, setLookup] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = (Object.keys(initial) as (keyof TripForm)[]).some((k) => form[k] !== initial[k]);

  /**
   * Updates one field.
   * @param field - Field to change.
   * @param value - New value as typed.
   */
  function setField(field: keyof TripForm, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Picks a contact: links it, fills the address from their contact, starts the purpose
   * when it is blank, and looks the km up straight away. A contact with no saved address
   * keeps whatever address is already typed.
   * @param picked - The contact chosen in the "Who" box.
   */
  function pickContact(picked: GoogleContact): void {
    const c = contactById.get(picked.id);
    if (!c) return;
    setWho(c.name);
    setForm((prev) => ({
      ...prev,
      contactId: c.id,
      destination: c.address || prev.destination,
      purpose: prev.purpose.trim() ? prev.purpose : `Job: ${c.name}`,
    }));
    if (!c.address) {
      setLookup({
        ok: false,
        text: `No address saved for ${c.name}. Type where you went.`,
      });
      return;
    }
    void lookUpKm(
      c.address,
      c.addressUnverified ? `${c.name}'s saved address isn't verified, so check it.` : undefined,
    );
  }

  /**
   * Tracks the "Who" box. Typing away from the picked contact's name unlinks it, so a
   * trip is never tied to someone it no longer names.
   * @param text - Box text as typed.
   */
  function changeWho(text: string): void {
    setWho(text);
    const linked = contactById.get(form.contactId);
    if (linked && text !== linked.name) setField("contactId", "");
  }

  /**
   * Fills the km from Google Maps: the round trip from the base address to `to`.
   * @param to - Address to look up; defaults to what is in the address box.
   * @param note - Extra line after the km, such as an unverified-address warning.
   */
  async function lookUpKm(to: string = form.destination, note?: string): Promise<void> {
    const trimmed = to.trim();
    if (!trimmed || lookingUp) return;
    setLookingUp(true);
    setLookup(null);
    try {
      const res = await fetch("/api/business/trips/distance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: trimmed }),
      });
      const d = (await res.json()) as TripDistanceApiResponse;
      if (d.ok && d.km !== undefined) {
        setField("km", String(d.km));
        setLookup({
          ok: note === undefined,
          text: `Google Maps: ${d.km} km there and back.${note ? ` ${note}` : ""}`,
        });
      } else {
        setLookup({ ok: false, text: d.error ?? "Couldn't get the km from Google." });
      }
    } catch {
      setLookup({
        ok: false,
        text: "Couldn't reach Google. Check your connection, or type the km.",
      });
    } finally {
      setLookingUp(false);
    }
  }

  /**
   * Saves the trip: PUT for an edit, POST for a new one. The API re-validates and its
   * message is shown in the dialog on a refusal.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(trip ? `/api/business/trips/${trip.id}` : "/api/business/trips", {
        method: trip ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = (await res.json()) as TripApiResponse;
      if (d.ok && d.trip) {
        onSaved(d.trip);
      } else {
        setError(d.error ?? "Couldn't save the trip.");
      }
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={trip ? "Edit trip" : "Add trip"}
      description="Km is the whole round trip, there and back."
      dirty={dirty && !saving}
      footer={
        <>
          <AdminButton variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </AdminButton>
          <AdminButton onClick={() => formRef.current?.requestSubmit()} busy={saving}>
            {trip ? "Save changes" : "Add trip"}
          </AdminButton>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={(e) => void handleSubmit(e)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <FiledYearWarning
          filedYears={filedYears}
          spans={[
            { from: form.date, to: form.date },
            ...(trip ? [{ from: trip.date, to: trip.date }] : []),
          ]}
          className="sm:col-span-2"
        />
        <AdminField
          label="Who"
          htmlFor={`${idBase}-who`}
          optional
          hint="Pick a contact to fill in their address and the km."
          className="sm:col-span-2"
        >
          <ContactNameInput
            id={`${idBase}-who`}
            value={who}
            onChange={changeWho}
            onPick={pickContact}
            contacts={searchable}
            placeholder="Search your contacts"
            className={ADMIN_CONTROL_CLS}
          />
        </AdminField>
        <AdminField
          label="Where to"
          htmlFor={`${idBase}-address`}
          optional
          hint="Saved with the trip. Google works out the km there and back from your base address."
          className="sm:col-span-2"
        >
          <div className="flex gap-2 max-sm:flex-col">
            <div className="min-w-0 flex-1">
              <AddressAutocomplete
                id={`${idBase}-address`}
                value={form.destination}
                onChange={(v) => setField("destination", v)}
                // Picking a suggestion is a clear ask, so look it up straight away.
                onPlaceSelected={(place) => void lookUpKm(place.formattedAddress)}
                onKeyDown={(e) => {
                  // Enter looks the address up instead of submitting the trip.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void lookUpKm();
                  }
                }}
                placeholder="Street address"
                maxLength={MAX_DESTINATION_LEN}
                inputClassName={ADMIN_CONTROL_CLS}
              />
            </div>
            <AdminButton
              variant="secondary"
              onClick={() => void lookUpKm()}
              busy={lookingUp}
              disabled={!form.destination.trim()}
              className="shrink-0"
            >
              Get km from Google
            </AdminButton>
          </div>
          {lookup && (
            <p
              role="status"
              className={cn(
                "mt-2 text-sm",
                lookup.ok ? "text-admin-text-secondary" : "text-coquelicot-700",
              )}
            >
              {lookup.text}
            </p>
          )}
        </AdminField>
        <AdminField label="Date" htmlFor={`${idBase}-date`} required>
          <AdminInput
            id={`${idBase}-date`}
            type="date"
            required
            value={form.date}
            onChange={(e) => setField("date", e.target.value)}
            className="h-10"
          />
        </AdminField>
        <AdminField label="Km (round trip)" htmlFor={`${idBase}-km`} required>
          <AdminInput
            id={`${idBase}-km`}
            type="number"
            inputMode="decimal"
            required
            min={0.1}
            max={MAX_TRIP_KM}
            step={0.1}
            value={form.km}
            onChange={(e) => setField("km", e.target.value)}
            className="h-10"
          />
        </AdminField>
        <AdminField
          label="Purpose"
          htmlFor={`${idBase}-purpose`}
          required
          className="sm:col-span-2"
        >
          <AdminInput
            id={`${idBase}-purpose`}
            type="text"
            required
            maxLength={200}
            placeholder="Job: Jane Smith, or Parts run to PB Tech"
            value={form.purpose}
            onChange={(e) => setField("purpose", e.target.value)}
            className="h-10"
          />
        </AdminField>
        <AdminField label="Notes" htmlFor={`${idBase}-notes`} optional className="sm:col-span-2">
          <AdminTextarea
            id={`${idBase}-notes`}
            rows={3}
            maxLength={1000}
            value={form.notes}
            onChange={(e) => setField("notes", e.target.value)}
          />
        </AdminField>
        {trip?.bookingId && (
          <p className="text-sm text-admin-muted sm:col-span-2">
            Logged from a job. It stays linked to that job when you edit it.
          </p>
        )}
        {error && (
          <Notice tone="warn" role="alert" className="sm:col-span-2">
            {error}
          </Notice>
        )}
      </form>
    </Modal>
  );
}
