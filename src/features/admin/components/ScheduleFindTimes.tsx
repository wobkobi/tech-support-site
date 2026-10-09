"use client";
// src/features/admin/components/ScheduleFindTimes.tsx
// Inline "next open times" bar for the admin schedule. Shows a few genuinely-bookable
// start times (one per hour, spread across days) for a short or long job so the operator
// can read them out on the phone; tapping a time opens the manual-booking form prefilled.
// Entering the customer's address - typed or picked from a contact - gates the times by
// the real drive to/from the surrounding jobs. Data comes from
// /api/admin/schedule/suggest-times, which reuses the public availability engine so slots
// match what customers can actually book.

import { ManualBookingModal } from "@/features/admin/components/ManualBookingModal";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card } from "@/features/admin/components/ui/Card";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import type React from "react";
import { useEffect, useRef, useState } from "react";

interface SuggestedSlot {
  dateKey: string;
  startIso: string;
  startHour: number;
  minute: number;
  dayLabel: string;
  timeLabel: string;
  driveNote?: string;
}

interface ContactSuggestion {
  id: string;
  name: string;
  address: string | null;
}

// A handful to offer, not a wall of times.
const SLOT_COUNT = 6;

/**
 * "Next open times" bar: a Short/Long toggle, an optional customer/address box
 * (with contact lookup), and tap-to-book spaced suggestions.
 * @returns The find-times bar element.
 */
export function ScheduleFindTimes(): React.ReactElement {
  const [duration, setDuration] = useState<"short" | "long">("short");
  const [address, setAddress] = useState("");
  const [debouncedAddress, setDebouncedAddress] = useState("");
  const [contacts, setContacts] = useState<ContactSuggestion[] | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);

  const [slots, setSlots] = useState<SuggestedSlot[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a booking closes so the freshly-taken slot drops off the list.
  const [reloadKey, setReloadKey] = useState(0);
  const [bookingSlotIso, setBookingSlotIso] = useState<string | null>(null);
  const [bookingDurationMin, setBookingDurationMin] = useState<60 | 120>(60);

  const addressWrapRef = useRef<HTMLDivElement>(null);

  // Debounce the address so gating (Google calls) doesn't fire on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedAddress(address.trim()), 600);
    return () => clearTimeout(id);
  }, [address]);

  // Close the contact dropdown on an outside click.
  useEffect(() => {
    /**
     * Hides the contact dropdown when a click lands outside the address box.
     * @param e - Pointer event captured at document level.
     */
    function onDocClick(e: MouseEvent): void {
      if (!addressWrapRef.current?.contains(e.target as Node)) setContactsOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    /** Loads the next spaced open times for the current job length + address. */
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/schedule/suggest-times", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration,
            limit: SLOT_COUNT,
            address: debouncedAddress || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          slots?: SuggestedSlot[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load times.");
          setSlots(null);
        } else {
          setSlots(data.slots ?? []);
        }
      } catch (err) {
        console.error("[ScheduleFindTimes] request failed", err);
        if (!cancelled) {
          setError("Network error.");
          setSlots(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [duration, reloadKey, debouncedAddress]);

  /** Loads contacts once (lazily, on first focus) so the address box can autofill. */
  async function loadContacts(): Promise<void> {
    if (contacts !== null) return;
    try {
      const res = await fetch("/api/admin/contacts");
      if (!res.ok) return;
      const data = (await res.json()) as { ok?: boolean; contacts?: ContactSuggestion[] };
      if (data.ok && data.contacts) setContacts(data.contacts);
      else setContacts([]);
    } catch (err) {
      console.error("[ScheduleFindTimes] contacts load failed", err);
      setContacts([]);
    }
  }

  const query = address.trim().toLowerCase();
  const contactMatches =
    contactsOpen && query.length >= 2 && contacts
      ? contacts.filter((c) => c.address && c.name.toLowerCase().includes(query)).slice(0, 6)
      : [];

  return (
    <Card padding="sm" className="mb-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-bold text-admin-text">Next open times</span>

        <div className={SEGMENTED_GROUP_CLS}>
          {(["short", "long"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              className={segmentedButtonClass(duration === d)}
            >
              {d === "short" ? "Short" : "Long"}
            </button>
          ))}
        </div>

        <div ref={addressWrapRef} className="relative w-full sm:w-auto">
          <AdminInput
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setContactsOpen(true);
            }}
            onFocus={() => {
              void loadContacts();
              setContactsOpen(true);
            }}
            placeholder="Customer address (optional)"
            className="h-10 sm:w-56"
          />
          {contactMatches.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-admin-border bg-admin-surface py-1 shadow-lg sm:w-72">
              {contactMatches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAddress(c.address ?? "");
                      setContactsOpen(false);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-admin-bg"
                  >
                    <span className="font-semibold text-admin-text">{c.name}</span>
                    <span className="block truncate text-sm text-admin-muted">{c.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Full row on a phone, so the times start at the left edge instead of
            wrapping into whatever space the address input leaves. */}
        <div className="flex basis-full flex-wrap items-center gap-1.5 sm:flex-1 sm:basis-auto">
          {loading && <span className="text-sm text-admin-muted">Finding...</span>}
          {!loading && error && <span className="text-sm text-red-600">{error}</span>}
          {!loading && !error && slots?.length === 0 && (
            <span className="text-sm text-admin-muted">
              {debouncedAddress
                ? "No times that fit the drive."
                : "No openings in the next few weeks."}
            </span>
          )}
          {!loading &&
            !error &&
            slots?.map((slot) => (
              <button
                key={slot.startIso}
                type="button"
                onClick={() => {
                  setBookingDurationMin(duration === "long" ? 120 : 60);
                  setBookingSlotIso(slot.startIso);
                }}
                title={
                  slot.driveNote ? `${slot.driveNote} from your previous job` : "Book this time"
                }
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-russian-violet/10 px-3 py-1 text-sm font-semibold text-russian-violet hover:bg-russian-violet/20"
              >
                {slot.dayLabel} · {slot.timeLabel}
                {slot.driveNote && (
                  <span className="text-sm font-normal text-russian-violet/80">
                    ({slot.driveNote})
                  </span>
                )}
              </button>
            ))}
        </div>
      </div>

      {bookingSlotIso && (
        <ManualBookingModal
          startAtIso={bookingSlotIso}
          initialDurationMinutes={bookingDurationMin}
          onClose={() => {
            setBookingSlotIso(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </Card>
  );
}
