"use client";
// src/features/business/components/trips/TripFormModal.tsx
// Add or edit one trip: date, round-trip km, purpose and notes. Saves through the trips
// API and hands the stored row back. The parent mounts it per trip (keyed), so the form
// starts from that trip's values without an effect.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Modal } from "@/features/admin/components/ui/Modal";
import { MAX_TRIP_KM, type TripApiResponse, type TripRow } from "@/features/business/lib/trips";
import { Notice } from "@/shared/components/Notice";
import type React from "react";
import { useId, useRef, useState } from "react";

/** Props for {@link TripFormModal}. */
interface TripFormModalProps {
  /** Trip being edited, or null to add a new one. */
  trip: TripRow | null;
  /** Date a new trip starts on (YYYY-MM-DD). */
  defaultDate: string;
  /** Called after a successful save with the stored row. */
  onSaved: (trip: TripRow) => void;
  /** Closes the dialog without saving. */
  onClose: () => void;
}

/** The form's field values, all as typed. */
interface TripForm {
  date: string;
  km: string;
  purpose: string;
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
        notes: trip.notes ?? "",
      }
    : { date: defaultDate, km: "", purpose: "", notes: "" };
}

/**
 * Trip add/edit dialog.
 * @param props - Component props.
 * @param props.trip - Trip being edited, or null to add one.
 * @param props.defaultDate - Date a new trip starts on.
 * @param props.onSaved - Called with the stored row after a save.
 * @param props.onClose - Closes the dialog.
 * @returns The dialog element.
 */
export function TripFormModal({
  trip,
  defaultDate,
  onSaved,
  onClose,
}: TripFormModalProps): React.ReactElement {
  const idBase = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [initial] = useState(() => initialForm(trip, defaultDate));
  const [form, setForm] = useState<TripForm>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    form.date !== initial.date ||
    form.km !== initial.km ||
    form.purpose !== initial.purpose ||
    form.notes !== initial.notes;

  /**
   * Updates one field.
   * @param field - Field to change.
   * @param value - New value as typed.
   */
  function setField(field: keyof TripForm, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }));
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
