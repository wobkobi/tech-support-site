"use client";
// src/features/admin/components/ScheduleFindTimes.tsx
// "Next open times" bar: a few bookable starts in the week on screen to read out on the phone,
// optionally gated by the drive from a customer address. Uses the public availability engine
// via the API.

import { ManualBookingModal } from "@/features/admin/components/ManualBookingModal";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { Card } from "@/features/admin/components/ui/Card";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { mondayOf } from "@/features/admin/lib/schedule-types";
import { spreadEvenly } from "@/features/admin/lib/spread-evenly";
import { addDaysToDateKey, nzTodayKey } from "@/shared/lib/timezone-utils";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useRef, useState } from "react";

interface SuggestedSlot {
  startIso: string;
  timeLabel: string;
  driveNote?: string;
}

interface SuggestedDay {
  dateKey: string;
  dayLabel: string;
  slots: SuggestedSlot[];
}

/** One dropdown: a weekday, or Saturday and Sunday together. */
interface DayGroup {
  key: string;
  days: SuggestedDay[];
}

interface ContactSuggestion {
  id: string;
  name: string;
  address: string | null;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Times in one dropdown; the weekend's two days share it.
const PER_DROPDOWN = 5;

/**
 * Whether a date key falls on a Saturday or Sunday.
 * @param key - Date key (YYYY-MM-DD).
 * @returns True on a weekend day.
 */
function isWeekend(key: string): boolean {
  const dow = new Date(`${key}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Splits one dropdown's worth of times across a weekend: Saturday takes the larger half,
 * and a day short of its half leaves the rest to the other. Each day's share stays spread
 * across that day.
 * @param sat - Saturday and its times.
 * @param sun - The Sunday after it and its times.
 * @returns Both days, holding PER_DROPDOWN times between them.
 */
function shareWeekend(sat: SuggestedDay, sun: SuggestedDay): SuggestedDay[] {
  const satCount = Math.min(
    sat.slots.length,
    Math.max(Math.ceil(PER_DROPDOWN / 2), PER_DROPDOWN - sun.slots.length),
  );
  const sunCount = Math.min(sun.slots.length, PER_DROPDOWN - satCount);
  return [
    { ...sat, slots: spreadEvenly(sat.slots, satCount) },
    { ...sun, slots: spreadEvenly(sun.slots, sunCount) },
  ];
}

/**
 * Groups days for the dropdowns: one per weekday, with a Saturday and the Sunday after it
 * sharing one (and its five times).
 * @param days - Days with openings, in date order.
 * @returns Dropdown groups, in date order.
 */
function groupDays(days: SuggestedDay[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const day of days) {
    const last = groups.at(-1);
    const lastDay = last?.days.at(-1);
    if (
      last &&
      lastDay &&
      isWeekend(lastDay.dateKey) &&
      isWeekend(day.dateKey) &&
      addDaysToDateKey(lastDay.dateKey, 1) === day.dateKey
    ) {
      last.days = shareWeekend(lastDay, day);
    } else groups.push({ key: day.dateKey, days: [day] });
  }
  return groups;
}

/**
 * Option text for a time, with the drive when gated by address.
 * @param slot - The suggested time.
 * @returns "2:00pm" or "2:00pm (18 min drive)".
 */
function slotOptionLabel(slot: SuggestedSlot): string {
  return slot.driveNote ? `${slot.timeLabel} (${slot.driveNote})` : slot.timeLabel;
}

/**
 * Short label for a Monday-to-Sunday range: "2-8 Nov", or "26 Oct - 1 Nov" across months.
 * @param startKey - Monday's date key (YYYY-MM-DD).
 * @param endKey - Sunday's date key (YYYY-MM-DD).
 * @returns The range label.
 */
function weekRangeLabel(startKey: string, endKey: string): string {
  /**
   * Formats a date key as a day, with the month when asked.
   * @param key - Date key (YYYY-MM-DD).
   * @param withMonth - Whether to add the short month name.
   * @returns "2" or "2 Nov".
   */
  const fmt = (key: string, withMonth: boolean): string =>
    new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NZ", {
      timeZone: "UTC",
      day: "numeric",
      ...(withMonth ? { month: "short" } : {}),
    });
  return startKey.slice(0, 7) === endKey.slice(0, 7)
    ? `${fmt(startKey, false)}-${fmt(endKey, true)}`
    : `${fmt(startKey, true)} - ${fmt(endKey, true)}`;
}

/**
 * "Next open times" bar: a Short/Long toggle, an optional customer/address box
 * (with contact lookup), and a dropdown per day (the weekend shares one) of up to five
 * spread-out times, each opening the booking form. Follows the week on screen through the
 * schedule's `?weekStart=` or `?day=` param.
 * @returns The find-times bar element.
 */
export function ScheduleFindTimes(): React.ReactElement {
  // The week and day views update these with replaceState, which useSearchParams sees.
  const searchParams = useSearchParams();
  const dayParam = searchParams.get("day");
  const weekParam = searchParams.get("weekStart");
  const todayKey = nzTodayKey();
  const thisWeekKey = mondayOf(todayKey);
  const weekStartKey =
    dayParam && DATE_KEY_RE.test(dayParam)
      ? mondayOf(dayParam)
      : weekParam && DATE_KEY_RE.test(weekParam)
        ? mondayOf(weekParam)
        : thisWeekKey;
  const weekEndKey = addDaysToDateKey(weekStartKey, 6);
  const isThisWeek = weekStartKey === thisWeekKey;
  const weekOver = weekEndKey < todayKey;

  const [duration, setDuration] = useState<"short" | "long">("short");
  const [address, setAddress] = useState("");
  const [debouncedAddress, setDebouncedAddress] = useState("");
  const [contacts, setContacts] = useState<ContactSuggestion[] | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);

  const [days, setDays] = useState<SuggestedDay[] | null>(null);
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
    /** Loads spaced open times in the week on screen for the current job length + address. */
    async function load(): Promise<void> {
      setError(null);
      if (weekOver) {
        setDays([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/admin/schedule/suggest-times", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration,
            fromDateKey: weekStartKey,
            toDateKey: weekEndKey,
            address: debouncedAddress || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          days?: SuggestedDay[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load times.");
          setDays(null);
        } else {
          setDays(data.days ?? []);
        }
      } catch (err) {
        console.error("[ScheduleFindTimes] request failed", err);
        if (!cancelled) {
          setError("Network error.");
          setDays(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [duration, reloadKey, debouncedAddress, weekStartKey, weekEndKey, weekOver]);

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
        <span className="text-sm font-bold text-admin-text">
          {isThisWeek
            ? "Next open times"
            : `Open times ${weekRangeLabel(weekStartKey, weekEndKey)}`}
        </span>

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

        {/* Full row on a phone so the times start at the left edge. */}
        <div className="flex basis-full flex-wrap items-center gap-1.5 sm:flex-1 sm:basis-auto">
          {loading && <span className="text-sm text-admin-muted">Finding...</span>}
          {!loading && error && <span className="text-sm text-red-600">{error}</span>}
          {!loading && !error && days?.length === 0 && (
            <span className="text-sm text-admin-muted">
              {weekOver
                ? "That week is over."
                : debouncedAddress
                  ? "No times that fit the drive."
                  : isThisWeek
                    ? "No openings left this week."
                    : "No openings that week."}
            </span>
          )}
          {/* Picking a time opens the booking form; the select itself stays on the day. */}
          {!loading &&
            !error &&
            groupDays(days ?? []).map((group) => {
              const label = group.days.length > 1 ? "Weekend" : group.days[0]!.dayLabel;
              return (
                <AdminSelect
                  key={group.key}
                  value=""
                  aria-label={`Open times, ${label}`}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setBookingDurationMin(duration === "long" ? 120 : 60);
                    setBookingSlotIso(e.target.value);
                  }}
                  className="h-10 w-auto px-2 font-semibold"
                >
                  <option value="">{label}</option>
                  {group.days.length > 1
                    ? group.days.map((day) => (
                        <optgroup key={day.dateKey} label={day.dayLabel}>
                          {day.slots.map((slot) => (
                            <option key={slot.startIso} value={slot.startIso}>
                              {slotOptionLabel(slot)}
                            </option>
                          ))}
                        </optgroup>
                      ))
                    : group.days[0]!.slots.map((slot) => (
                        <option key={slot.startIso} value={slot.startIso}>
                          {slotOptionLabel(slot)}
                        </option>
                      ))}
                </AdminSelect>
              );
            })}
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
