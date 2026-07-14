"use client";
// src/features/admin/components/ManualBookingModal.tsx
/**
 * @description Modal for adding a booking from the admin schedule view. Used when
 * Harrison takes a booking over the phone or by email - prefills date/time from
 * the clicked slot and POSTs to the admin booking-create endpoint.
 */

import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import {
  combineUnitAndAddress,
  splitUnitFromAddress,
  validateEmail,
} from "@/features/booking/lib/booking";
import { Button } from "@/shared/components/Button";
import { EmailInput } from "@/shared/components/EmailInput";
import { Field } from "@/shared/components/Field";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import { formatNZPhone, validatePhone } from "@/shared/lib/normalise-phone";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

const NZ_TZ = "Pacific/Auckland";

interface ContactSuggestion {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

interface ManualBookingModalProps {
  startAtIso: string;
  onClose: () => void;
  /** Prefill the duration toggle (defaults to 60min). Set by the find-times tool. */
  initialDurationMinutes?: 60 | 120;
}

/**
 * Modal form for manual booking creation from the admin schedule grid.
 * @param props - Component props.
 * @param props.startAtIso - Prefilled start time (ISO 8601) derived from the clicked slot.
 * @param props.onClose - Called when the modal should close (cancel or success).
 * @param props.initialDurationMinutes - Prefilled job length (defaults to 60min).
 * @returns Modal element.
 */
export function ManualBookingModal({
  startAtIso,
  onClose,
  initialDurationMinutes = 60,
}: ManualBookingModalProps): React.ReactElement {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const nameWrapRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Unit kept separate from the street address, same as the public booking form:
  // Google Places autocomplete predicts the street but rarely the apartment/unit,
  // so without its own box the unit gets lost.
  const [unit, setUnit] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<60 | 120>(initialDurationMinutes);
  // Auto-size from the job notes: an estimate over an hour bumps the duration to
  // 2 hours, unless the operator has set it by hand.
  const [durationManuallySet, setDurationManuallySet] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimateHint, setEstimateHint] = useState<string | null>(null);
  const lastEstimatedNotes = useRef("");
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [startAtLocal, setStartAtLocal] = useState(() => toLocalInputValue(startAtIso));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<ContactSuggestion[]>([]);
  const [nameListOpen, setNameListOpen] = useState(false);

  /**
   * Estimates job duration from the notes via the pricing estimator and bumps the
   * duration to 2 hours when it runs over an hour. Skips when the operator set the
   * duration by hand, the notes are too short, or they're unchanged since the last
   * estimate; a rate-limit or failure just leaves the current duration in place.
   */
  async function estimateFromNotes(): Promise<void> {
    if (durationManuallySet) return;
    const desc = notes.trim();
    if (desc.length < 8 || desc === lastEstimatedNotes.current) return;
    lastEstimatedNotes.current = desc;
    setEstimating(true);
    try {
      const res = await fetch("/api/pricing/estimate-duration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc }),
      });
      if (!res.ok) return; // rate-limited or failed: leave the duration untouched
      const data = (await res.json()) as { result?: { estimatedMins?: number } };
      const mins = data.result?.estimatedMins;
      if (typeof mins !== "number" || durationManuallySet) return;
      setDurationMinutes(mins > 60 ? 120 : 60);
      setEstimateHint(
        mins > 60 ? `Notes estimate ~${mins} min - set to 2 hours` : `Notes estimate ~${mins} min`,
      );
    } catch (err) {
      console.error("[ManualBookingModal] duration estimate failed", err);
    } finally {
      setEstimating(false);
    }
  }

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    /**
     * Loads existing contacts so the customer-name field can autofill from them.
     * Failure is non-fatal > the form still works without suggestions.
     */
    async function loadContacts(): Promise<void> {
      try {
        const res = await fetch("/api/admin/contacts", {
          headers: {},
        });
        if (!res.ok) return;
        const data = (await res.json()) as { ok?: boolean; contacts?: ContactSuggestion[] };
        if (data.ok && data.contacts) setContacts(data.contacts);
      } catch (err) {
        console.error("[ManualBookingModal] contacts load failed", err);
      }
    }
    void loadContacts();
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
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (validateEmail(email) !== "ok") {
      setError("Enter a valid email address.");
      return;
    }
    const phoneCheck = validatePhone(phone);
    if (phoneCheck.result === "invalid") {
      setError("Enter a valid phone number, or leave it blank.");
      return;
    }
    const phoneE164 = phoneCheck.e164;

    setSubmitting(true);
    try {
      const startAt = fromLocalInputValue(startAtLocal);
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phoneE164 || null,
          address: combineUnitAndAddress(unit, address) || null,
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="manual-booking-title" className="text-lg font-bold text-russian-violet">
            New booking
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
          >
            <FaXmark />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Start" htmlFor="mb-start" required>
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
                onChange={(e) => {
                  setDurationMinutes(Number(e.target.value) as 60 | 120);
                  setDurationManuallySet(true);
                  setEstimateHint(null);
                }}
                className={textInputClasses}
              >
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
              </select>
              {estimating && (
                <p className="mt-1 text-xs text-slate-400">Estimating from notes...</p>
              )}
              {!estimating && estimateHint && (
                <p className="mt-1 text-xs text-slate-500">{estimateHint}</p>
              )}
            </Field>
          </div>

          <Field label="Customer name" htmlFor="mb-name" required>
            <div
              ref={nameWrapRef}
              className="relative"
              onBlur={(e) => {
                if (!nameWrapRef.current?.contains(e.relatedTarget as Node)) {
                  setNameListOpen(false);
                }
              }}
            >
              <input
                ref={nameRef}
                id="mb-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameListOpen(true);
                }}
                onFocus={() => setNameListOpen(true)}
                autoComplete="off"
                required
                maxLength={100}
                className={textInputClasses}
              />
              {nameListOpen &&
                contacts.length > 0 &&
                (() => {
                  const q = name.trim().toLowerCase();
                  const matches = contacts.filter((c) => {
                    if (!q) return true;
                    return (
                      c.name.toLowerCase().includes(q) ||
                      c.email?.toLowerCase().includes(q) ||
                      c.address?.toLowerCase().includes(q) ||
                      c.phone?.includes(q)
                    );
                  });
                  if (matches.length === 0) return null;
                  return (
                    <div className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                      {matches.slice(0, 30).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setName(c.name);
                            setEmail(c.email ?? "");
                            setPhone(c.phone ? formatNZPhone(c.phone) : "");
                            // Split the stored address back into unit + street so the
                            // dedicated unit box stays populated on edit.
                            {
                              const split = splitUnitFromAddress(c.address ?? "");
                              setUnit(split.unit);
                              setAddress(split.rest);
                            }
                            setNameListOpen(false);
                          }}
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <span className="text-sm font-medium text-slate-800">{c.name}</span>
                          {c.address && <span className="text-xs text-slate-500">{c.address}</span>}
                          <span className="text-xs text-slate-400">
                            {[c.email, c.phone ? formatNZPhone(c.phone) : null]
                              .filter(Boolean)
                              .join(" · ") || "No contact info"}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
            </div>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Phone" htmlFor="mb-phone" optional>
              <PhoneInput id="mb-phone" value={phone} onChange={setPhone} />
            </Field>
            <Field label="Email" htmlFor="mb-email" required>
              <EmailInput
                id="mb-email"
                value={email}
                onChange={setEmail}
                required
                maxLength={320}
              />
            </Field>
          </div>

          {/* Stack below sm: the unit input + address autocomplete can't both
              shrink to fit three tracks on a narrow phone, and this modal is
              fixed-position so the page-level overflow clip doesn't contain it. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Apt / Unit" htmlFor="mb-unit" optional>
              <input
                id="mb-unit"
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                autoComplete="off"
                maxLength={20}
                placeholder="12"
                className={textInputClasses}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address" htmlFor="mb-address" optional>
                <AddressAutocomplete
                  id="mb-address"
                  value={address}
                  onChange={setAddress}
                  placeholder="Street address"
                  maxLength={250}
                />
              </Field>
            </div>
          </div>

          <Field label="Notes" htmlFor="mb-notes" optional>
            <textarea
              id="mb-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => void estimateFromNotes()}
              rows={3}
              maxLength={2000}
              className={cn(textInputClasses, "resize-y")}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={sendConfirmation}
              onChange={(e) => setSendConfirmation(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Send confirmation email to customer
          </label>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="secondary" size="sm" disabled={submitting}>
              {submitting ? "Saving..." : "Create booking"}
            </Button>
          </div>
        </form>
      </div>
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
