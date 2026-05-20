"use client";
// src/features/admin/components/ManualBookingModal.tsx
/**
 * @file ManualBookingModal.tsx
 * @description Modal for adding a booking from the admin schedule view. Used when
 * Harrison takes a booking over the phone or by email - prefills date/time from
 * the clicked slot and POSTs to the admin booking-create endpoint.
 */

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { FaXmark } from "react-icons/fa6";
import { cn } from "@/shared/lib/cn";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";

const NZ_TZ = "Pacific/Auckland";

interface ManualBookingModalProps {
  token: string;
  startAtIso: string;
  onClose: () => void;
}

/**
 * Modal form for manual booking creation from the admin schedule grid.
 * @param props - Component props.
 * @param props.token - Admin token forwarded as x-admin-secret header.
 * @param props.startAtIso - Prefilled start time (ISO 8601) derived from the clicked slot.
 * @param props.onClose - Called when the modal should close (cancel or success).
 * @returns Modal element.
 */
export function ManualBookingModal({
  token,
  startAtIso,
  onClose,
}: ManualBookingModalProps): React.ReactElement {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<60 | 120>(60);
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [startAtLocal, setStartAtLocal] = useState(() => toLocalInputValue(startAtIso));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    /**
     * Closes the modal when Escape is pressed.
     * @param e - Keyboard event captured at document level.
     */
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Submits the manual booking. Validates locally then POSTs to the admin
   * create endpoint. On success refreshes the schedule page so the new booking
   * appears in the grid; on failure surfaces the error message inline.
   * @param e - Submit event from the form.
   * @returns Promise that resolves once the request settles.
   */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }

    setSubmitting(true);
    try {
      const startAt = fromLocalInputValue(startAtLocal);
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": token,
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          notes: notes.trim(),
          startAt: startAt.toISOString(),
          durationMinutes,
          sendConfirmation,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to create booking.");
        setSubmitting(false);
        return;
      }
      router.refresh();
      onClose();
    } catch (err) {
      console.error("[ManualBookingModal] submit failed", err);
      setError("Network error - try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-booking-title"
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center",
      )}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn("max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl")}
      >
        <div
          className={cn("flex items-center justify-between border-b border-slate-200 px-5 py-4")}
        >
          <h2 id="manual-booking-title" className={cn("text-russian-violet text-lg font-bold")}>
            New booking
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100",
            )}
          >
            <FaXmark />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={cn("space-y-4 px-5 py-5")}>
          <div className={cn("grid grid-cols-2 gap-3")}>
            <Field label="Start" htmlFor="mb-start">
              <input
                id="mb-start"
                type="datetime-local"
                value={startAtLocal}
                onChange={(e) => setStartAtLocal(e.target.value)}
                required
                className={textInputClasses}
              />
            </Field>
            <Field label="Duration" htmlFor="mb-duration">
              <select
                id="mb-duration"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value) as 60 | 120)}
                className={textInputClasses}
              >
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
              </select>
            </Field>
          </div>

          <Field label="Customer name" htmlFor="mb-name">
            <input
              ref={nameRef}
              id="mb-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              className={textInputClasses}
            />
          </Field>

          <div className={cn("grid grid-cols-2 gap-3")}>
            <Field label="Phone" htmlFor="mb-phone">
              <input
                id="mb-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={32}
                className={textInputClasses}
              />
            </Field>
            <Field label="Email" htmlFor="mb-email">
              <input
                id="mb-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={320}
                className={textInputClasses}
              />
            </Field>
          </div>

          <Field label="Address" htmlFor="mb-address">
            <AddressAutocomplete
              id="mb-address"
              value={address}
              onChange={setAddress}
              placeholder="Street address"
              maxLength={250}
            />
          </Field>

          <Field label="Notes" htmlFor="mb-notes">
            <textarea
              id="mb-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              className={cn(textInputClasses, "resize-y")}
            />
          </Field>

          <label className={cn("flex items-center gap-2 text-sm text-slate-700")}>
            <input
              type="checkbox"
              checked={sendConfirmation}
              onChange={(e) => setSendConfirmation(e.target.checked)}
              className={cn("h-4 w-4 rounded border-slate-300")}
            />
            Send confirmation email to customer
          </label>

          {error && (
            <p
              role="alert"
              className={cn(
                "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700",
              )}
            >
              {error}
            </p>
          )}

          <div className={cn("flex justify-end gap-2 pt-2")}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className={cn(
                "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50",
              )}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                "bg-russian-violet hover:bg-russian-violet/90 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50",
              )}
            >
              {submitting ? "Saving..." : "Create booking"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}

/**
 * Renders a labelled form field with consistent spacing.
 * @param props - Field props.
 * @param props.label - Visible label text.
 * @param props.htmlFor - Input id the label associates with.
 * @param props.children - Field input element(s).
 * @returns Labelled field element.
 */
function Field({ label, htmlFor, children }: FieldProps): React.ReactElement {
  return (
    <div>
      <label htmlFor={htmlFor} className={cn("mb-1 block text-xs font-semibold text-slate-600")}>
        {label}
      </label>
      {children}
    </div>
  );
}

const textInputClasses = cn(
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800",
  "focus:border-russian-violet focus:outline-none focus:ring-2 focus:ring-russian-violet/30",
);

/**
 * Converts a UTC ISO timestamp to a NZ-local "YYYY-MM-DDTHH:mm" string suitable
 * for an `<input type="datetime-local">` value.
 * @param iso - UTC ISO timestamp.
 * @returns NZ-local datetime string.
 */
function toLocalInputValue(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NZ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${map.get("hour")}:${map.get("minute")}`;
}

/**
 * Parses a NZ-local "YYYY-MM-DDTHH:mm" datetime-local input value back into a
 * UTC Date, applying the right NZDT/NZST offset for the chosen date.
 * @param local - Input value from a datetime-local field, interpreted as NZ time.
 * @returns UTC Date.
 */
function fromLocalInputValue(local: string): Date {
  const [datePart, timePart] = local.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  const offset = getPacificAucklandOffset(y, m, d);
  return new Date(Date.UTC(y, m - 1, d, hh - offset, mm, 0));
}
