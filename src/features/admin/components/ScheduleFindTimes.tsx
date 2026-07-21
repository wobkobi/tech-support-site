"use client";
// src/features/admin/components/ScheduleFindTimes.tsx
/**
 * @description Inline "next open times" bar for the admin schedule. Shows a few
 * genuinely-bookable start times (one per hour, spread across days) for a short or
 * long job so the operator can read them out on the phone; tapping a time opens the
 * manual-booking form prefilled. Entering the customer's address - typed or picked
 * from a contact - gates the times by the real drive to/from the surrounding jobs.
 * Data comes from /api/admin/schedule/suggest-times, which reuses the public
 * availability engine so slots match what customers can actually book.
 */

import { ManualBookingModal } from "@/features/admin/components/ManualBookingModal";
import { cn } from "@/shared/lib/cn";
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
      const res = await fetch("/api/admin/contacts", { headers: {} });
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
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-semibold text-slate-700">Next open times</span>

        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {(["short", "long"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-semibold transition-colors",
                duration === d
                  ? "bg-russian-violet text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {d === "short" ? "Short" : "Long"}
            </button>
          ))}
        </div>

        <div ref={addressWrapRef} className="relative">
          <input
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
            className="h-9 w-56 rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
          />
          {contactMatches.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-72 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {contactMatches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAddress(c.address ?? "");
                      setContactsOpen(false);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100"
                  >
                    <span className="font-medium text-slate-700">{c.name}</span>
                    <span className="block truncate text-xs text-slate-400">{c.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {loading && <span className="text-sm text-slate-400">Finding...</span>}
          {!loading && error && <span className="text-sm text-red-600">{error}</span>}
          {!loading && !error && slots?.length === 0 && (
            <span className="text-sm text-slate-400">
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
                className="inline-flex items-center gap-1.5 rounded-md bg-russian-violet/10 px-2.5 py-1 text-sm font-medium text-russian-violet hover:bg-russian-violet/20"
              >
                {slot.dayLabel} · {slot.timeLabel}
                {slot.driveNote && (
                  <span className="text-xs font-normal text-russian-violet/70">
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
    </div>
  );
}
