// src/features/booking/components/BookingForm.tsx
/**
 * @file BookingForm.tsx
 * @description Booking form with duration selection (1hr vs 2hr jobs).
 */

"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import {
  DURATION_OPTIONS,
  SUB_SLOT_MINUTES,
  BOOKING_FIELD_LIMITS,
  EMAIL_REGEX,
  type BookableDay,
  type TimeOfDay,
  type StartMinute,
  type JobDuration,
} from "@/features/booking/lib/booking";
import { normalizePhone, isValidPhone } from "@/shared/lib/normalize-phone";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";

export interface BookingFormInitialValues {
  duration: JobDuration;
  dateKey: string;
  timeOfDay: TimeOfDay;
  startMinute?: StartMinute;
  name: string;
  email: string;
  phone: string;
  meetingType: "in-person" | "remote" | "";
  address: string;
  notes: string;
}

/**
 * Splits an NZ-style apartment-prefixed address ("12/160 Kepa Road Orakei")
 * into its unit number and the street-and-rest. Returns unit="" when no unit
 * prefix is detected. Matches 1-4 digits with an optional letter suffix
 * (e.g. "12", "12A") followed by "/" and at least one more char.
 * @param addr - Saved address string, possibly with a unit prefix.
 * @returns Object with `unit` (may be empty) and `rest` (the street + suburb).
 */
function splitUnitFromAddress(addr: string): { unit: string; rest: string } {
  const trimmed = addr.trim();
  const m = trimmed.match(/^(\d{1,4}[A-Za-z]?)\/(.+)$/);
  if (!m) return { unit: "", rest: trimmed };
  return { unit: m[1], rest: m[2].trim() };
}

/**
 * Combines a unit number and a street-and-rest back into the saved address
 * string ("12/160 Kepa Road Orakei"). Returns just the rest when no unit is
 * present, so non-apartment addresses are unchanged.
 * @param unit - Apartment / unit number, may be empty.
 * @param rest - Street address + suburb.
 * @returns Combined address string suitable for persistence.
 */
function combineUnitAndAddress(unit: string, rest: string): string {
  const u = unit.trim();
  const r = rest.trim();
  return u ? `${u}/${r}` : r;
}

export interface BookingFormProps {
  availableDays: BookableDay[];
  cancelToken?: string;
  initialValues?: BookingFormInitialValues;
}

/**
 * Booking form component with duration selection
 * @param props - Component props
 * @param props.availableDays - Array of available booking days
 * @param props.cancelToken - Cancel token for edit mode; omit for new bookings
 * @param props.initialValues - Pre-filled values for edit mode
 * @returns Booking form element
 */
export default function BookingForm({
  availableDays,
  cancelToken,
  initialValues,
}: BookingFormProps): React.ReactElement {
  const router = useRouter();
  const isEditMode = Boolean(cancelToken);

  // Form state
  const [duration, setDuration] = useState<JobDuration>(initialValues?.duration ?? "short");
  const [selectedDay, setSelectedDay] = useState<BookableDay | null>(null);
  const [selectedTime, setSelectedTime] = useState<TimeOfDay | null>(
    initialValues?.timeOfDay ?? null,
  );
  const [selectedMinute, setSelectedMinute] = useState<StartMinute>(
    initialValues?.startMinute ?? 0,
  );
  const [name, setName] = useState(initialValues?.name ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [meetingType, setMeetingType] = useState<"in-person" | "remote" | "">(
    initialValues?.meetingType ?? "",
  );
  // Apartment / unit number is stored separately so Google Places autocomplete
  // can predict the street part (predictions go cold for NZ "N/" prefixes).
  // We re-combine on submit and split on pre-fill so saved addresses stay in
  // the standard "12/160 Kepa Road Orakei" shape.
  const initialSplit = splitUnitFromAddress(initialValues?.address ?? "");
  const [unit, setUnit] = useState(initialSplit.unit);
  const [address, setAddress] = useState(initialSplit.rest);
  // True after the customer picks an autocomplete suggestion; resets to false
  // on any subsequent keystroke. In edit mode the saved address is treated as
  // verified (it was accepted on its original submission). Drives the
  // green-tick hint + the optional submit-time geocode fallback.
  const [addressVerified, setAddressVerified] = useState(Boolean(initialValues?.address));
  // Flipped true after the submit-time geocode check fails so the customer can
  // click Submit a second time to proceed with their typed address as-is.
  // Reset whenever the address changes (so a different mistyped address gets
  // re-checked, not silently bypassed).
  const [addressOverrideAcked, setAddressOverrideAcked] = useState(false);
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  // Honeypot: real users never see/fill this; bots typically auto-fill any
  // input that looks like a contact field. A non-empty value tells the server
  // to fake a success response without creating a booking.
  const [website, setWebsite] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the server returned 409 (someone booked the same slot first).
  // Drives a more prominent error with a "Refresh available times" link.
  const [slotStale, setSlotStale] = useState(false);
  const [contactHint, setContactHint] = useState<string | null>(null);

  /**
   * On email blur (new bookings only): look up the email in contacts and
   * pre-fill name / phone / address for any fields the user left empty.
   */
  async function handleEmailBlur(): Promise<void> {
    if (isEditMode) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return;
    try {
      const res = await fetch(`/api/booking/contact-lookup?email=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok: boolean;
        name?: string;
        phone?: string | null;
        address?: string | null;
      };
      if (!data.ok) return;
      const filled: string[] = [];
      if (data.name && !name.trim()) {
        setName(data.name);
        filled.push("name");
      }
      if (data.phone && !phone.trim()) {
        setPhone(data.phone);
        filled.push("phone");
      }
      if (data.address && !address.trim() && !unit.trim()) {
        const split = splitUnitFromAddress(data.address);
        setUnit(split.unit);
        setAddress(split.rest);
        filled.push("address");
      }
      if (filled.length > 0) {
        setContactHint(`Pre-filled from your previous booking: ${filled.join(", ")}.`);
      }
    } catch {
      // Silently ignore - pre-fill is best-effort
    }
  }

  // Auto-select day on mount: pre-select initial day in edit mode, else first available
  useEffect(() => {
    if (availableDays.length > 0) {
      if (initialValues?.dateKey) {
        const preselected = availableDays.find((d) => d.dateKey === initialValues.dateKey);
        if (preselected) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSelectedDay(preselected);
          return;
        }
      }
      const firstAvailable = availableDays.find((d) => d.hasAnySlots);
      setSelectedDay(firstAvailable ?? availableDays[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Split days into weekdays and weekends
  const weekdays = availableDays.filter((d) => !d.isWeekend);
  const weekends = availableDays.filter((d) => d.isWeekend);

  /**
   * Handle day selection and reset time if needed
   * @param day - Selected bookable day
   */
  function handleDaySelect(day: BookableDay): void {
    setSelectedDay(day);
    // Picking a different day clears the stale-slot warning if it was set.
    setSlotStale(false);
    // Reset time if current selection + minute not available on new day
    if (selectedTime) {
      const window = day.timeWindows.find((w) => w.value === selectedTime);
      const sub = window?.subSlots.find((s) => s.minute === selectedMinute);
      const available = duration === "short" ? sub?.availableShort : sub?.availableLong;
      if (!available) {
        setSelectedTime(null);
        setSelectedMinute(0);
      }
    }
  }

  /**
   * Handle duration change and reset time if needed
   * @param newDuration - Selected job duration
   */
  function handleDurationChange(newDuration: JobDuration): void {
    setDuration(newDuration);
    // Reset time if current selection + minute not available for new duration
    if (selectedTime && selectedDay) {
      const window = selectedDay.timeWindows.find((w) => w.value === selectedTime);
      const sub = window?.subSlots.find((s) => s.minute === selectedMinute);
      const available = newDuration === "short" ? sub?.availableShort : sub?.availableLong;
      if (!available) {
        setSelectedTime(null);
        setSelectedMinute(0);
      }
    }
  }

  /**
   * Format a sub-slot time label, e.g. startHour=14, minute=15 → "2:15pm"
   * @param startHour - The hour in 24h format (e.g. 14 for 2pm)
   * @param minute - Minutes past the hour (0, 15, 30, or 45)
   * @returns Formatted time string (e.g. "2:15pm")
   */
  function subSlotLabel(startHour: number, minute: StartMinute): string {
    const period = startHour < 12 ? "am" : "pm";
    const h = startHour > 12 ? startHour - 12 : startHour;
    return minute === 0 ? `${h}:00${period}` : `${h}:${String(minute).padStart(2, "0")}${period}`;
  }

  /**
   * Handle form submission
   * @param e - Form event
   */
  async function handleSubmit(e: React.SubmitEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!duration) {
      setError("Please select job duration.");
      return;
    }
    if (!selectedDay) {
      setError("Please select a day and time.");
      return;
    }
    if (!selectedTime) {
      setError("Please select a time.");
      return;
    }
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!email.trim() || !EMAIL_REGEX.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    // Phone is optional, but if present must be valid. Re-run validation here
    // in case the user typed without blurring (phoneError only sets on blur).
    if (phone.trim()) {
      const phoneOk = isValidPhone(normalizePhone(phone));
      if (!phoneOk) {
        setPhoneError("Please enter a valid phone number.");
        setError("Please fix the phone number, or leave it blank.");
        return;
      }
    }
    if (!meetingType) {
      setError("Please select in-person or remote.");
      return;
    }
    if (meetingType === "in-person" && !address.trim()) {
      setError("Please enter your address for in-person appointments.");
      return;
    }
    if (!notes.trim()) {
      setError("Please describe what you need help with.");
      return;
    }
    if (notes.trim().length < BOOKING_FIELD_LIMITS.notesMin) {
      setError(
        `Please describe the issue in at least ${BOOKING_FIELD_LIMITS.notesMin} characters so I have enough context.`,
      );
      return;
    }

    setSubmitting(true);

    // Soft geocode check for typed-but-not-picked addresses. First failure
    // sets addressOverrideAcked so the customer can click Submit again to
    // proceed. Network/API outages don't block submission - the booking
    // still goes through and I can clarify if needed.
    if (meetingType === "in-person" && !addressVerified && !addressOverrideAcked) {
      try {
        const verifyRes = await fetch("/api/pricing/travel-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destination: combineUnitAndAddress(unit, address) }),
        });
        if (verifyRes.ok) {
          const data = (await verifyRes.json()) as { distanceKm?: number };
          if (!data.distanceKm) {
            setError(
              "We couldn't find that address on the map. Double-check the spelling, or click Submit again to use it as-is.",
            );
            setAddressOverrideAcked(true);
            setSubmitting(false);
            return;
          }
        }
      } catch {
        // Verification failed (network / API outage) - fall through and submit
        // anyway. Don't block legit bookings on a Google API hiccup.
      }
    }

    try {
      const endpoint = isEditMode ? "/api/booking/edit" : "/api/booking/request";
      const payload = isEditMode
        ? {
            cancelToken,
            dateKey: selectedDay.dateKey,
            timeOfDay: selectedTime,
            startMinute: selectedMinute,
            duration,
            name: name.trim(),
            phone: phone.trim() || undefined,
            meetingType,
            address: meetingType === "in-person" ? combineUnitAndAddress(unit, address) : undefined,
            notes: notes.trim(),
          }
        : {
            dateKey: selectedDay.dateKey,
            timeOfDay: selectedTime,
            startMinute: selectedMinute,
            duration,
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim() || undefined,
            meetingType,
            address: meetingType === "in-person" ? combineUnitAndAddress(unit, address) : undefined,
            notes: notes.trim(),
            website,
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string; cancelToken?: string };

      if (!res.ok) {
        if (res.status === 409) {
          // Someone else booked this slot between page load and submit. Show
          // the dedicated stale-slot UI so the customer can refresh and pick
          // another time rather than re-clicking submit into a dead slot.
          setSlotStale(true);
          setError(null);
        } else {
          setError(data.error || "Could not submit request.");
        }
        setSubmitting(false);
        return;
      }

      if (isEditMode) {
        router.push(`/booking/success?cancelToken=${encodeURIComponent(cancelToken!)}`);
      } else {
        const successUrl = data.cancelToken
          ? `/booking/success?cancelToken=${encodeURIComponent(data.cancelToken)}`
          : "/booking/success";
        router.push(successUrl);
      }
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("flex flex-col gap-8")} autoComplete="off">
      {/* Honeypot: visually hidden + off-screen + tab-skipped + aria-hidden.
          Real users never see or focus this. Bots that auto-fill contact-
          style inputs will fill it, and the server fakes a success response
          without creating a booking. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        <label htmlFor="booking-website">Website (leave blank)</label>
        <input
          id="booking-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      {/* ── Section 1: Scheduling ── */}
      <fieldset className={cn("flex flex-col gap-6")}>
        <legend className={cn("text-russian-violet mb-1 text-xl font-bold sm:text-2xl")}>
          Schedule
        </legend>

        {/* Duration */}
        <div>
          <label className={cn("text-rich-black mb-2 block text-base font-semibold")}>
            How long do you need? <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <div className={cn("grid gap-3 sm:grid-cols-2")}>
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleDurationChange(opt.value)}
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors",
                  duration === opt.value
                    ? "border-russian-violet bg-russian-violet/10"
                    : "border-seasalt-400/60 bg-seasalt hover:border-russian-violet/40",
                )}
              >
                <div className={cn("flex items-start justify-between")}>
                  <div>
                    <p className={cn("text-rich-black text-base font-semibold")}>{opt.label}</p>
                    <p className={cn("text-rich-black/70 mt-1 text-base")}>{opt.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <p className={cn("text-rich-black/60 mt-2 text-base")}>
            Duration is just an estimate for scheduling. Most appointments are 1 hour. Choose 2
            hours if you have multiple issues or complex setup needs.
          </p>
        </div>

        {/* Day Selection */}
        <div>
          <label className={cn("text-rich-black mb-2 block text-base font-semibold")}>
            Choose a day
          </label>

          {!availableDays.some((d) => d.hasAnySlots) ? (
            <p className={cn("text-rich-black/70 text-base")}>
              No availability in the next two weeks. Please call or text me directly.
            </p>
          ) : (
            <div className={cn("space-y-3")}>
              {weekdays.length > 0 && (
                <div>
                  <p
                    className={cn(
                      "text-rich-black/60 mb-1.5 text-base font-medium uppercase tracking-wide",
                    )}
                  >
                    Weekdays
                  </p>
                  <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
                    {weekdays.map((day) => (
                      <button
                        key={day.dateKey}
                        type="button"
                        disabled={!day.hasAnySlots}
                        onClick={() => handleDaySelect(day)}
                        className={cn(
                          "whitespace-nowrap rounded-lg border px-3 py-3 text-base font-medium",
                          !day.hasAnySlots && "cursor-not-allowed opacity-50",
                          selectedDay?.dateKey === day.dateKey
                            ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                            : day.hasAnySlots
                              ? "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                              : "border-seasalt-400/40 bg-seasalt-900/20 text-rich-black/60",
                          day.isToday &&
                            day.hasAnySlots &&
                            "ring-coquelicot-500/50 ring-2 ring-offset-1",
                        )}
                      >
                        {day.dayLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {weekends.length > 0 && (
                <div>
                  <p
                    className={cn(
                      "text-rich-black/60 mb-1.5 text-base font-medium uppercase tracking-wide",
                    )}
                  >
                    Weekends
                  </p>
                  <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
                    {weekends.map((day) => (
                      <button
                        key={day.dateKey}
                        type="button"
                        disabled={!day.hasAnySlots}
                        onClick={() => handleDaySelect(day)}
                        className={cn(
                          "whitespace-nowrap rounded-lg border px-3 py-3 text-base font-medium",
                          !day.hasAnySlots && "cursor-not-allowed opacity-50",
                          selectedDay?.dateKey === day.dateKey
                            ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                            : day.hasAnySlots
                              ? "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                              : "border-seasalt-400/40 bg-seasalt-900/20 text-rich-black/60",
                        )}
                      >
                        {day.dayLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Time Selection */}
        {selectedDay && (
          <div className={cn("flex flex-col gap-3")}>
            <label className={cn("text-rich-black block text-base font-semibold")}>
              Start time for {selectedDay.fullLabel}
            </label>

            {selectedDay.timeWindows.every((w) =>
              duration === "short" ? !w.availableShort : !w.availableLong,
            ) ? (
              <div className={cn("border-seasalt-400/80 bg-seasalt-900/30 rounded-lg border p-4")}>
                <p className={cn("text-rich-black/70 text-base")}>
                  Sorry, no {duration === "short" ? "1-hour" : "2-hour"} slots available on this
                  day.
                  {duration === "long" && " Try selecting 1 hour instead, or choose another day."}
                </p>
              </div>
            ) : (
              <>
                {/* Hour picker */}
                <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2")}>
                  {selectedDay.timeWindows.map((window) => {
                    const available =
                      duration === "short" ? window.availableShort : window.availableLong;
                    const isSelected = selectedTime === window.value;
                    return (
                      <button
                        key={window.value}
                        type="button"
                        disabled={!available}
                        onClick={() => {
                          setSelectedTime(window.value);
                          const firstAvailable = window.subSlots.find((s) =>
                            duration === "short" ? s.availableShort : s.availableLong,
                          );
                          setSelectedMinute(firstAvailable?.minute ?? 0);
                        }}
                        className={cn(
                          "rounded-lg border px-4 py-2.5 text-base font-medium",
                          !available && "cursor-not-allowed opacity-40",
                          isSelected
                            ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                            : available
                              ? "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                              : "border-seasalt-400/40 bg-seasalt-900/30 text-rich-black/60",
                        )}
                      >
                        {window.label}
                      </button>
                    );
                  })}
                </div>

                {/* Sub-slot picker - shown once an hour is selected */}
                {selectedTime &&
                  (() => {
                    const activeWindow = selectedDay.timeWindows.find(
                      (w) => w.value === selectedTime,
                    );
                    if (!activeWindow) return null;
                    return (
                      <div className={cn("flex flex-wrap gap-2")}>
                        {SUB_SLOT_MINUTES.map((minute) => {
                          const sub = activeWindow.subSlots.find((s) => s.minute === minute)!;
                          const available =
                            duration === "short" ? sub.availableShort : sub.availableLong;
                          return (
                            <button
                              key={minute}
                              type="button"
                              disabled={!available}
                              onClick={() => setSelectedMinute(minute)}
                              className={cn(
                                "rounded-lg border px-4 py-2 text-base font-medium",
                                !available && "cursor-not-allowed opacity-40",
                                selectedMinute === minute
                                  ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                                  : available
                                    ? "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                                    : "border-seasalt-400/40 bg-seasalt-900/30 text-rich-black/60",
                              )}
                            >
                              {subSlotLabel(activeWindow.startHour, minute)}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
              </>
            )}
          </div>
        )}
      </fieldset>

      {/* Divider */}
      <hr className={cn("border-seasalt-400/80")} />

      {/* ── Section 2: Your details ── */}
      <fieldset className={cn("flex flex-col gap-6")}>
        <legend className={cn("text-russian-violet mb-1 text-xl font-bold sm:text-2xl")}>
          Your details
        </legend>

        <div className={cn("grid gap-4 sm:grid-cols-2")}>
          <div className={cn("flex flex-col gap-1.5")}>
            <label htmlFor="booking-name" className={cn("text-rich-black text-base font-semibold")}>
              Name <span className={cn("text-coquelicot-500")}>*</span>
            </label>
            <input
              id="booking-name"
              type="text"
              autoComplete="name"
              maxLength={BOOKING_FIELD_LIMITS.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(
                "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
                "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
              )}
            />
          </div>

          <div className={cn("flex flex-col gap-1.5")}>
            <label
              htmlFor="booking-email"
              className={cn("text-rich-black text-base font-semibold")}
            >
              Email <span className={cn("text-coquelicot-500")}>*</span>
            </label>
            <input
              id="booking-email"
              type="email"
              autoComplete="email"
              maxLength={BOOKING_FIELD_LIMITS.email}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setContactHint(null);
              }}
              onBlur={handleEmailBlur}
              className={cn(
                "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
                "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
              )}
            />
            {contactHint && <p className={cn("text-rich-black/50 text-xs")}>{contactHint}</p>}
          </div>
        </div>

        <div className={cn("flex flex-col gap-1.5")}>
          <label htmlFor="booking-phone" className={cn("text-rich-black text-base font-semibold")}>
            Phone <span className={cn("text-rich-black/70 text-base")}>(optional)</span>
          </label>
          <input
            id="booking-phone"
            type="tel"
            autoComplete="tel"
            maxLength={BOOKING_FIELD_LIMITS.phone}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneError(null);
            }}
            onBlur={() => {
              if (phone.trim() && !isValidPhone(normalizePhone(phone))) {
                setPhoneError("Please enter a valid phone number.");
              }
            }}
            className={cn(
              "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
              "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
              "sm:max-w-sm",
              phoneError && "border-coquelicot-500/60",
            )}
          />
          {phoneError && <p className={cn("text-coquelicot-600 text-sm")}>{phoneError}</p>}
        </div>

        {/* Meeting Type */}
        <div className={cn("flex flex-col gap-2")}>
          <label className={cn("text-rich-black text-base font-semibold")}>
            Meeting type <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
            <button
              type="button"
              onClick={() => setMeetingType("in-person")}
              className={cn(
                "whitespace-nowrap rounded-lg border px-5 py-2.5 text-base font-medium transition-colors",
                meetingType === "in-person"
                  ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                  : "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
              )}
            >
              In-person
            </button>
            <button
              type="button"
              onClick={() => setMeetingType("remote")}
              className={cn(
                "whitespace-nowrap rounded-lg border px-5 py-2.5 text-base font-medium transition-colors",
                meetingType === "remote"
                  ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                  : "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
              )}
            >
              Remote
            </button>
          </div>
        </div>

        {/* Address (only for in-person) - animated reveal */}
        <div
          className={cn(
            "grid transition-all duration-300 ease-in-out",
            meetingType === "in-person"
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className={cn(meetingType === "in-person" ? "overflow-visible" : "overflow-hidden")}>
            <div className={cn("pb-0.5 pt-0.5")}>
              <div className={cn("text-rich-black mb-2 block text-base font-semibold")}>
                Address <span className={cn("text-coquelicot-500")}>*</span>
              </div>
              {/* Only mount when in-person so Google Maps script never loads for remote sessions */}
              {meetingType === "in-person" && (
                <div className={cn("flex flex-col gap-2 sm:flex-row")}>
                  <div className={cn("flex flex-col gap-1 sm:w-32")}>
                    <label
                      htmlFor="booking-unit"
                      className={cn("text-rich-black/70 text-xs font-medium")}
                    >
                      Apt / Unit (optional)
                    </label>
                    <input
                      id="booking-unit"
                      type="text"
                      value={unit}
                      onChange={(e) => {
                        setUnit(e.target.value);
                        // Unit edits invalidate any prior submit-time geocode
                        // override so the new combined address gets re-checked.
                        setAddressOverrideAcked(false);
                      }}
                      placeholder="e.g. 12"
                      inputMode="text"
                      autoComplete="off"
                      maxLength={8}
                      className={cn(
                        "border-seasalt-400/80 bg-seasalt text-rich-black w-full rounded-md border px-4 py-3 text-base",
                        "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
                      )}
                    />
                  </div>
                  <div className={cn("flex flex-1 flex-col gap-1")}>
                    <label
                      htmlFor="booking-address"
                      className={cn("text-rich-black/70 text-xs font-medium")}
                    >
                      Street address
                    </label>
                    <AddressAutocomplete
                      id="booking-address"
                      value={address}
                      maxLength={BOOKING_FIELD_LIMITS.address}
                      onChange={(v) => {
                        setAddress(v);
                        // Any typing invalidates the prior pick. The onChange
                        // fires before onPlaceSelected on a pick, so React
                        // batches both updates and the final state is
                        // verified=true. Keystrokes leave it at false.
                        setAddressVerified(false);
                        setAddressOverrideAcked(false);
                      }}
                      onPlaceSelected={() => setAddressVerified(true)}
                      placeholder="Start typing your street address..."
                      required
                    />
                    {address.trim() &&
                      (addressVerified ? (
                        <p
                          className={cn(
                            "text-xs font-medium text-green-700",
                            "flex items-center gap-1",
                          )}
                        >
                          <span aria-hidden="true">✓</span> Address verified
                        </p>
                      ) : (
                        <p className={cn("text-xs text-slate-500")}>
                          Pick a suggestion from the dropdown to verify your address.
                        </p>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </fieldset>

      {/* Divider */}
      <hr className={cn("border-seasalt-400/80")} />

      {/* ── Section 3: Describe the issue ── */}
      <fieldset className={cn("flex flex-col gap-6")}>
        <legend className={cn("text-russian-violet mb-1 text-xl font-bold sm:text-2xl")}>
          Describe the issue
        </legend>

        <div className={cn("flex flex-col gap-1.5")}>
          <label htmlFor="booking-notes" className={cn("text-rich-black text-base font-semibold")}>
            What do you need help with? <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <textarea
            id="booking-notes"
            name="booking-notes-no-autofill"
            autoComplete="new-password"
            rows={4}
            maxLength={BOOKING_FIELD_LIMITS.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={cn(
              "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
              "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
            )}
            placeholder="e.g., Wi-Fi not working, need help with email setup, laptop running slow..."
          />
        </div>
      </fieldset>

      {/* Submit */}
      {slotStale && (
        <div
          role="alert"
          className={cn(
            "border-coquelicot-500/40 bg-coquelicot-50 rounded-md border p-4",
            "flex flex-col gap-2",
          )}
        >
          <p className={cn("text-coquelicot-700 text-base font-medium")}>
            That time slot was just taken by another customer.
          </p>
          <p className={cn("text-rich-black/70 text-sm")}>
            Refresh the page to load the up-to-date availability, then pick another time.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setSlotStale(false);
              router.refresh();
            }}
          >
            Refresh available times
          </Button>
        </div>
      )}
      {error && (
        <p className={cn("text-coquelicot-600 text-base font-medium")} role="alert">
          {error}
        </p>
      )}

      <div className={cn("flex flex-wrap items-center gap-4")}>
        <Button
          type="submit"
          variant="secondary"
          size="md"
          disabled={submitting || !availableDays.some((d) => d.hasAnySlots)}
        >
          {submitting
            ? isEditMode
              ? "Saving..."
              : "Sending..."
            : isEditMode
              ? "Save changes"
              : "Submit request"}
        </Button>
      </div>
    </form>
  );
}
