// src/features/booking/components/BookingForm.tsx
/**
 * @file BookingForm.tsx
 * @description Booking form with duration selection (1hr vs 2hr jobs).
 */

"use client";

import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import {
  BOOKING_FIELD_LIMITS,
  splitUnitFromAddress,
  SUB_SLOT_MINUTES,
  validateEmail,
  type BookableDay,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import { fetchQuickEstimate } from "@/features/business/lib/quick-estimate";
import { Button } from "@/shared/components/Button";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import { validatePhone } from "@/shared/lib/normalise-phone";
import type { EstimatorRange } from "@/shared/lib/settings/types";
import { useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FaCheck } from "react-icons/fa6";

/** localStorage key for the new-booking draft. Bumped when the shape changes. */
const DRAFT_KEY = "booking-draft-v2";
/** Soft warning kicks in this many chars before the notes hard cap. */
const NOTES_WARN_GAP = 50;

/**
 * Formats a job duration in minutes as a short label ("1 hour", "2 hours", "90 min").
 * @param mins - Duration in minutes.
 * @returns Human label.
 */
function durationText(mins: number): string {
  if (mins % 60 === 0) {
    const h = mins / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${mins} min`;
}

interface BookingDraft {
  duration: JobDuration;
  name: string;
  email: string;
  phone: string;
  meetingType: "in-person" | "remote" | "";
  unit: string;
  address: string;
  notes: string;
  dateKey?: string;
  timeOfDay?: TimeOfDay;
  startMinute?: StartMinute;
}

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
  /** Live job durations (minutes) from availability settings; drives the picker labels. */
  durations: { short: number; long: number };
  cancelToken?: string;
  initialValues?: BookingFormInitialValues;
  /** Live estimator range widths - enables the inline "get a rough estimate" (new bookings only). */
  estimatorRange?: EstimatorRange;
  /** Min billable minutes (live setting) for the inline estimate. */
  minBillableMins?: number;
  /** Travel floor (live setting) for the inline estimate. */
  minTravelCharge?: number;
}

/**
 * Booking form component with duration selection
 * @param props - Component props
 * @param props.availableDays - Array of available booking days
 * @param props.durations - Live job durations (minutes) for the picker labels.
 * @param props.cancelToken - Cancel token for edit mode; omit for new bookings
 * @param props.initialValues - Pre-filled values for edit mode
 * @param props.estimatorRange - Live estimator range widths; enables the inline rough estimate.
 * @param props.minBillableMins - Min billable minutes for the inline estimate.
 * @param props.minTravelCharge - Travel floor for the inline estimate.
 * @returns Booking form element
 */
export default function BookingForm({
  availableDays,
  durations,
  cancelToken,
  initialValues,
  estimatorRange,
  minBillableMins,
  minTravelCharge,
}: BookingFormProps): React.ReactElement {
  const router = useRouter();
  const isEditMode = Boolean(cancelToken);
  // Estimate id sent with the booking so it can snapshot which public quote the
  // customer saw - seeded from the /pricing wizard's "Book now" link
  // (?estimate=<id>, 24-hex) and replaced if they run the inline estimate below.
  const estimateParam = useSearchParams().get("estimate");
  const [estimateId, setEstimateId] = useState<string | undefined>(
    estimateParam && /^[a-f0-9]{24}$/i.test(estimateParam) ? estimateParam : undefined,
  );
  // Inline "get a rough estimate" state (new bookings only).
  const [estimating, setEstimating] = useState(false);
  const [quote, setQuote] = useState<{ low: number; high: number } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const canInlineEstimate =
    !isEditMode && estimatorRange != null && minBillableMins != null && minTravelCharge != null;

  // Duration choices built from the live settings; labels reflect the operator's
  // configured short/long lengths. Descriptions stay as fixed copy.
  const durationOptions: { value: JobDuration; label: string; description: string }[] = [
    {
      value: "short",
      label: `Standard (${durationText(durations.short)})`,
      description: "Most common appointment length",
    },
    {
      value: "long",
      label: `Extended (${durationText(durations.long)})`,
      description: "For complex issues or multiple tasks",
    },
  ];

  // Form state. `selectedDateKey` is stored instead of the full BookableDay
  // object so that when `availableDays` changes (e.g. after router.refresh on
  // a 409), we always read the latest slot data from props during render -
  // no useEffect-driven reconciliation needed.
  const [duration, setDuration] = useState<JobDuration>(initialValues?.duration ?? "short");
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(() => {
    if (initialValues?.dateKey && availableDays.some((d) => d.dateKey === initialValues.dateKey)) {
      return initialValues.dateKey;
    }
    return availableDays.find((d) => d.hasAnySlots)?.dateKey ?? availableDays[0]?.dateKey ?? null;
  });
  const [selectedTime, setSelectedTime] = useState<TimeOfDay | null>(
    initialValues?.timeOfDay ?? null,
  );
  const [selectedMinute, setSelectedMinute] = useState<StartMinute>(
    initialValues?.startMinute ?? 0,
  );

  // Resolve the BookableDay object from the stored key on every render. If the
  // pick has since disappeared from the prop (refresh, etc.), this returns null
  // and the time picker hides until the user picks again.
  const selectedDay: BookableDay | null = selectedDateKey
    ? (availableDays.find((d) => d.dateKey === selectedDateKey) ?? null)
    : null;
  const [name, setName] = useState(initialValues?.name ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [meetingType, setMeetingType] = useState<"in-person" | "remote" | "">(
    initialValues?.meetingType ?? "",
  );
  // Unit kept separate so Places autocomplete can predict the street part
  // (NZ "N/" prefixes break predictions). Re-combined on submit, split on
  // pre-fill, so saved addresses stay in "12/160 Kepa Road Orakei" shape.
  const initialSplit = splitUnitFromAddress(initialValues?.address ?? "");
  const [unit, setUnit] = useState(initialSplit.unit);
  const [address, setAddress] = useState(initialSplit.rest);
  // True after picking an autocomplete suggestion (or pre-filled in edit mode);
  // any keystroke resets it. Drives the green-tick hint + submit-time geocode.
  const [addressVerified, setAddressVerified] = useState(Boolean(initialValues?.address));
  // True after a failed submit-time geocode so a second click submits as-is.
  // Resets on any address change to re-check different mistypes.
  const [addressOverrideAcked, setAddressOverrideAcked] = useState(false);
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  // Honeypot: real users never see/fill this; bots typically auto-fill any
  // input that looks like a contact field. A non-empty value tells the server
  // to fake a success response without creating a booking.
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /**
   * Runs the inline rough estimate from the current description + meeting +
   * address, shows the range, and captures the logged estimate id so the
   * booking snapshots the quote the customer saw.
   * @returns Resolves when the estimate completes.
   */
  async function runInlineEstimate(): Promise<void> {
    if (!estimatorRange || minBillableMins == null || minTravelCharge == null) return;
    setEstimating(true);
    setQuoteError(null);
    try {
      const res = await fetchQuickEstimate({
        description: notes.trim(),
        meeting: meetingType === "remote" ? "remote" : "in-person",
        address: meetingType === "remote" ? undefined : combineUnitAndAddress(unit, address),
        estimatorRange,
        minBillableMins,
        minTravelCharge,
      });
      setQuote({ low: res.low, high: res.high });
      if (res.estimateId) setEstimateId(res.estimateId);
    } catch {
      setQuoteError("Couldn't get an estimate just now - you can still book.");
    } finally {
      setEstimating(false);
    }
  }
  const [error, setError] = useState<string | null>(null);
  // Submit-time validation errors. Rendered both in a top summary and inline.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // True when the server returned 409 (someone booked the same slot first).
  // Drives a more prominent error with a "Refresh available times" link.
  const [slotStale, setSlotStale] = useState(false);
  const [contactHint, setContactHint] = useState<string | null>(null);
  // True once a localStorage draft has been restored, so the UI can offer a
  // "Clear form" affordance. New-booking mode only.
  const [draftRestored, setDraftRestored] = useState(false);
  // Lit when notes paste is trimmed to fit the cap; auto-clears after 4s.
  const [pasteTrimmed, setPasteTrimmed] = useState(false);
  // True once AddressAutocomplete reports the Maps API is unavailable. The
  // form then skips the "must pick a suggestion" gate.
  const [mapsFallback, setMapsFallback] = useState(false);

  // Submit guards. `submittingRef` blocks Enter-key spam regardless of React's
  // setState timing. `idempotencyKey` is generated once per mount via the lazy
  // useState initialiser (which is allowed to call impure functions); the
  // server logs it so a retried submit can be correlated with the original.
  const submittingRef = useRef(false);
  const [idempotencyKey] = useState<string>(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  // Aborts the previous /contact-lookup request when the user blurs a new
  // email; without this, a slow first response could overwrite the second.
  const contactLookupAbortRef = useRef<AbortController | null>(null);
  // Latest email being looked up; the response handler drops anything stale.
  const contactLookupEmailRef = useRef<string>("");
  // Debounced draft writer.
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Suppress the very first save so we don't immediately re-persist what we
  // just restored.
  const draftLoadedRef = useRef(false);

  /**
   * On email blur (new bookings only): look up the email in contacts and
   * pre-fill name / phone / address for any fields the user left empty.
   * Aborts the prior request and drops the response if the email-in-flight
   * no longer matches what the user has typed.
   */
  async function handleEmailBlur(): Promise<void> {
    if (isEditMode) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return;

    // Cancel any prior request so a slow earlier response can't overwrite a
    // faster newer one.
    contactLookupAbortRef.current?.abort();
    const controller = new AbortController();
    contactLookupAbortRef.current = controller;
    contactLookupEmailRef.current = trimmed;

    try {
      const res = await fetch(`/api/booking/contact-lookup?email=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok: boolean;
        name?: string;
        phone?: string | null;
        address?: string | null;
      };
      if (!data.ok) return;
      // Drop the response if the user has since blurred a different email.
      if (contactLookupEmailRef.current !== trimmed) return;
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
    } catch (err) {
      // AbortError on supersede + any network failure are non-fatal; pre-fill
      // is best-effort.
      if ((err as { name?: string } | null)?.name === "AbortError") return;
    }
  }

  // Synchronise the selected time during render if it's no longer available
  // for the current day + duration (e.g. after a router.refresh changed slot
  // availability). The `selectedTime !== null` guard prevents an infinite
  // setState loop - once we null the selection, the next render sees null and
  // stops. This is the React-recommended "adjust state when a prop changes"
  // pattern, used instead of a useEffect.
  if (selectedTime !== null && selectedDay) {
    const window = selectedDay.timeWindows.find((w) => w.value === selectedTime);
    const sub = window?.subSlots.find((s) => s.minute === selectedMinute);
    const available = duration === "short" ? !!sub?.availableShort : !!sub?.availableLong;
    if (!available) {
      setSelectedTime(null);
      setSelectedMinute(0);
    }
  }

  // Restore a localStorage draft on mount (new-booking mode only). Selection
  // (dateKey/timeOfDay/startMinute) is only restored when it still matches a
  // currently-available slot - otherwise we silently drop those fields so the
  // user picks a fresh time without seeing a misleading pre-pick.
  //
  // The setState-in-effect lint is intentionally suppressed: localStorage is
  // unavailable during SSR, so the read cannot move to a useState lazy
  // initialiser (it would either crash server-side or cause a hydration
  // mismatch). This is the canonical "read once from an external source on
  // mount" pattern.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isEditMode) return;
    if (draftLoadedRef.current) return;
    draftLoadedRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<BookingDraft>;
      if (draft.duration === "short" || draft.duration === "long") setDuration(draft.duration);
      if (typeof draft.name === "string" && draft.name) setName(draft.name);
      if (typeof draft.email === "string" && draft.email) setEmail(draft.email);
      if (typeof draft.phone === "string" && draft.phone) setPhone(draft.phone);
      if (draft.meetingType === "in-person" || draft.meetingType === "remote") {
        setMeetingType(draft.meetingType);
      }
      if (typeof draft.unit === "string") setUnit(draft.unit);
      if (typeof draft.address === "string" && draft.address) {
        setAddress(draft.address);
        setAddressVerified(true);
      }
      if (typeof draft.notes === "string" && draft.notes) setNotes(draft.notes);

      // Try to restore the time selection if the slot is still bookable.
      if (draft.dateKey && draft.timeOfDay && availableDays.length > 0) {
        const day = availableDays.find((d) => d.dateKey === draft.dateKey);
        const win = day?.timeWindows.find((w) => w.value === draft.timeOfDay);
        const minute = (draft.startMinute ?? 0) as StartMinute;
        const sub = win?.subSlots.find((s) => s.minute === minute);
        const desiredDuration = draft.duration === "long" ? "long" : "short";
        const available = desiredDuration === "short" ? sub?.availableShort : sub?.availableLong;
        if (day && win && available) {
          setSelectedDateKey(day.dateKey);
          setSelectedTime(draft.timeOfDay);
          setSelectedMinute(minute);
        }
      }

      setDraftRestored(true);
    } catch (err) {
      console.warn("[BookingForm] Failed to restore draft:", err);
    }
    // availableDays is a render-stable prop; we intentionally only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist draft on change (debounced). Skipped in edit mode and during the
  // initial restore tick.
  useEffect(() => {
    if (isEditMode) return;
    if (!draftLoadedRef.current) return;
    if (typeof window === "undefined") return;

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const draft: BookingDraft = {
        duration,
        name,
        email,
        phone,
        meetingType,
        unit,
        address,
        notes,
        dateKey: selectedDay?.dateKey,
        timeOfDay: selectedTime ?? undefined,
        startMinute: selectedTime ? selectedMinute : undefined,
      };
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // Quota / private-mode: persistence is best-effort.
      }
    }, 300);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [
    isEditMode,
    duration,
    name,
    email,
    phone,
    meetingType,
    unit,
    address,
    notes,
    selectedDay,
    selectedTime,
    selectedMinute,
  ]);

  // Auto-clear the "paste was trimmed" hint after a few seconds.
  useEffect(() => {
    if (!pasteTrimmed) return;
    const t = setTimeout(() => setPasteTrimmed(false), 4000);
    return () => clearTimeout(t);
  }, [pasteTrimmed]);

  /**
   * Clear the saved draft + reset all form fields the user filled in. Leaves
   * the schedule selection alone since that's already constrained by what's
   * available.
   */
  function clearDraft(): void {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Ignore - removal is best-effort.
      }
    }
    setName("");
    setEmail("");
    setPhone("");
    setMeetingType("");
    setUnit("");
    setAddress("");
    setAddressVerified(false);
    setAddressOverrideAcked(false);
    setNotes("");
    setContactHint(null);
    setFieldErrors({});
    setError(null);
    setDraftRestored(false);
  }

  const weekdays = availableDays.filter((d) => !d.isWeekend);
  const weekends = availableDays.filter((d) => d.isWeekend);

  /**
   * Handle day selection and reset time if needed
   * @param day - Selected bookable day
   */
  function handleDaySelect(day: BookableDay): void {
    setSelectedDateKey(day.dateKey);
    // Picking a different day clears the stale-slot warning if it was set.
    setSlotStale(false);
    // Time + minute validity gets re-checked during render against the new day
    // (see the synchronise-during-render block above); no extra work needed.
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
   * Format a sub-slot time label, e.g. startHour=14, minute=15 > "2:15pm".
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
   * Handle form submission. The `submittingRef` guard blocks Enter-key spam
   * (the disabled prop on the submit button doesn't catch keyboard submits
   * from inside a focused text field).
   * @param e - Form event
   */
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);

    // Collect all failures so the user fixes them in one pass. Keys match
    // the input ids used below for aria-describedby + summary anchors.
    const fe: Record<string, string> = {};
    if (!duration) fe.duration = "Please select job duration.";
    if (!selectedDay) fe.day = "Please select a day and time.";
    if (!selectedTime) fe.time = "Please select a time.";
    if (!name.trim()) fe.name = "Please enter your name.";
    if (validateEmail(email) !== "ok") {
      fe.email = "Please enter a valid email address.";
    }
    const phoneCheck = validatePhone(phone).result;
    if (meetingType === "in-person") {
      if (!phone.trim()) {
        fe.phone = "Please enter a phone number so I can contact you about arrival.";
      } else if (phoneCheck === "invalid") {
        fe.phone = "Please enter a valid phone number.";
      }
    } else if (phoneCheck === "invalid") {
      fe.phone = "Please enter a valid phone number, or leave it blank.";
    }
    if (!meetingType) fe.meetingType = "Please select in-person or remote.";
    if (meetingType === "in-person" && !address.trim()) {
      fe.address = "Please enter your address for in-person appointments.";
    }
    if (!notes.trim()) {
      fe.notes = "Please describe what you need help with.";
    } else if (notes.trim().length < BOOKING_FIELD_LIMITS.notesMin) {
      fe.notes = `Please describe the issue in at least ${BOOKING_FIELD_LIMITS.notesMin} characters so I have enough context.`;
    }

    setFieldErrors(fe);
    if (Object.keys(fe).length > 0) return;

    // Field-errors guard above guarantees these are set; narrow for TS.
    if (!selectedDay || !selectedTime || !duration || !meetingType) return;

    submittingRef.current = true;
    setSubmitting(true);

    // Soft geocode check for typed-but-not-picked addresses. First failure flips
    // addressOverrideAcked so a second click submits anyway. Network errors
    // don't block submission - clarify out-of-band if needed.
    // Skipped entirely in maps-fallback mode because we can't expect a verified
    // pick when the autocomplete widget is unavailable.
    if (meetingType === "in-person" && !addressVerified && !addressOverrideAcked && !mapsFallback) {
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
            submittingRef.current = false;
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
            idempotencyKey,
            estimateId,
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
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      // Successful submit: clear the saved draft so the next page load is a
      // clean slate.
      if (!isEditMode && typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(DRAFT_KEY);
        } catch {
          // Ignore - cleanup is best-effort.
        }
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
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      // `noValidate` so the JS error-summary takes over from native browser
      // tooltips; required + aria-required stay for assistive tech.
      noValidate
      className={cn("flex flex-col gap-8")}
      autoComplete="off"
    >
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
        <div id="booking-duration">
          <label className={cn("text-rich-black mb-2 block text-base font-semibold")}>
            How long do you need? <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <div className={cn("grid gap-3 sm:grid-cols-2")}>
            {durationOptions.map((opt) => (
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
        <div id="booking-day">
          <label className={cn("text-rich-black mb-2 block text-base font-semibold")}>
            Choose a day
          </label>
          <p className={cn("text-rich-black/60 mb-2 text-base")}>
            All times shown in NZ time (Auckland).
          </p>

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
                  {/* pt-5 reserves space above the first row for the
                      Today/Tomorrow labels that sit fully outside their button. */}
                  <div
                    className={cn(
                      "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-2 gap-y-3 pt-5",
                    )}
                  >
                    {weekdays.map((day) => (
                      <div key={day.dateKey} className={cn("relative")}>
                        {(day.isToday || day.isTomorrow) && day.hasAnySlots && (
                          <span
                            className={cn(
                              "text-coquelicot-600 absolute -top-5 left-0 right-0 text-center text-[10px] font-bold uppercase tracking-wide",
                            )}
                          >
                            {day.isToday ? "Today" : "Tomorrow"}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={!day.hasAnySlots}
                          onClick={() => handleDaySelect(day)}
                          className={cn(
                            "w-full whitespace-nowrap rounded-lg border px-3 py-3 text-base font-medium",
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
                      </div>
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
                  <div
                    className={cn(
                      "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-2 gap-y-3 pt-3",
                    )}
                  >
                    {weekends.map((day) => (
                      <div key={day.dateKey} className={cn("relative")}>
                        {(day.isToday || day.isTomorrow) && day.hasAnySlots && (
                          <span
                            className={cn(
                              "text-coquelicot-600 absolute -top-5 left-0 right-0 text-center text-[10px] font-bold uppercase tracking-wide",
                            )}
                          >
                            {day.isToday ? "Today" : "Tomorrow"}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={!day.hasAnySlots}
                          onClick={() => handleDaySelect(day)}
                          className={cn(
                            "w-full whitespace-nowrap rounded-lg border px-3 py-3 text-base font-medium",
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
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Time Selection */}
        {selectedDay && (
          <div
            id="booking-time"
            className={cn("flex flex-col gap-3")}
            aria-live="polite"
            aria-atomic="false"
          >
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
              required
              aria-required
              maxLength={BOOKING_FIELD_LIMITS.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!fieldErrors.name || undefined}
              aria-describedby={fieldErrors.name ? "booking-name-error" : undefined}
              className={cn(
                "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
                "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
                fieldErrors.name && "border-coquelicot-500/60",
              )}
            />
            {fieldErrors.name && (
              <p id="booking-name-error" className={cn("text-coquelicot-600 text-sm")}>
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className={cn("flex flex-col gap-1.5")}>
            <label
              htmlFor="booking-email"
              className={cn("text-rich-black text-base font-semibold")}
            >
              Email <span className={cn("text-coquelicot-500")}>*</span>
            </label>
            <EmailInput
              id="booking-email"
              value={email}
              onChange={(next) => {
                setEmail(next);
                setContactHint(null);
              }}
              onBlur={handleEmailBlur}
              error={fieldErrors.email}
              errorId="booking-email-error"
              required
              maxLength={BOOKING_FIELD_LIMITS.email}
              errorMessages={{ invalid: "Please enter a valid email address." }}
              className={cn(
                "border-seasalt-400/80 bg-seasalt text-rich-black border px-4 py-3 text-base",
                "focus:border-russian-violet focus:ring-russian-violet/30 focus:ring-1",
              )}
            />
            {contactHint && <p className={cn("text-rich-black/70 text-sm")}>{contactHint}</p>}
          </div>
        </div>

        <div id="booking-phone-wrap" className={cn("flex flex-col gap-1.5")}>
          <label htmlFor="booking-phone" className={cn("text-rich-black text-base font-semibold")}>
            Phone{" "}
            {meetingType === "in-person" ? (
              <span className={cn("text-coquelicot-500")}>*</span>
            ) : (
              <span className={cn("text-rich-black/70 text-base")}>(optional)</span>
            )}
          </label>
          <PhoneInput
            id="booking-phone"
            value={phone}
            onChange={setPhone}
            required={meetingType === "in-person"}
            error={fieldErrors.phone}
            errorId="booking-phone-error"
            maxLength={BOOKING_FIELD_LIMITS.phone}
            errorMessages={{ invalid: "Please enter a valid phone number." }}
            className={cn(
              "border-seasalt-400/80 bg-seasalt text-rich-black border px-4 py-3 text-base",
              "focus:border-russian-violet focus:ring-russian-violet/30 focus:ring-1",
              "sm:max-w-sm",
            )}
          />
          {meetingType === "in-person" && (
            <p className={cn("text-rich-black/60 text-sm")}>
              Needed so I can contact you on arrival (running late, gate codes, etc.).
            </p>
          )}
        </div>

        {/* Meeting Type */}
        <div id="booking-meeting-type" className={cn("flex flex-col gap-2")}>
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
                <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-start")}>
                  <div className={cn("flex flex-col gap-1 sm:w-44")}>
                    <label
                      htmlFor="booking-unit"
                      className={cn("text-rich-black/80 truncate text-sm font-medium")}
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
                      className={cn("text-rich-black/80 text-sm font-medium")}
                    >
                      Street address
                    </label>
                    <AddressAutocomplete
                      id="booking-address"
                      value={address}
                      maxLength={BOOKING_FIELD_LIMITS.address}
                      onChange={(v) => {
                        setAddress(v);
                        // Any keystroke invalidates the prior pick. onChange
                        // fires before onPlaceSelected on a real pick, so
                        // batched updates leave verified=true on suggestions.
                        // Skipped in fallback mode - there's no autocomplete to
                        // verify against.
                        if (!mapsFallback) {
                          setAddressVerified(false);
                          setAddressOverrideAcked(false);
                        }
                      }}
                      onPlaceSelected={() => setAddressVerified(true)}
                      onFallbackMode={() => {
                        setMapsFallback(true);
                        // No suggestions available > accept the typed address
                        // outright; the existing submit-time geocode (skipped
                        // in this mode) was the only thing that would have
                        // gated submission.
                        setAddressVerified(true);
                      }}
                      placeholder="Start typing your street address..."
                      required
                      aria-invalid={!!fieldErrors.address || undefined}
                      aria-describedby={fieldErrors.address ? "booking-address-error" : undefined}
                    />
                    {fieldErrors.address && (
                      <p id="booking-address-error" className={cn("text-coquelicot-600 text-sm")}>
                        {fieldErrors.address}
                      </p>
                    )}
                    {address.trim() &&
                      !mapsFallback &&
                      (addressVerified ? (
                        <p
                          className={cn(
                            "text-sm font-medium text-green-700",
                            "flex items-center gap-1",
                          )}
                        >
                          <FaCheck className={cn("h-4 w-4")} aria-hidden /> Address verified
                        </p>
                      ) : (
                        <p className={cn("text-sm text-slate-600")}>
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
            required
            aria-required
            maxLength={BOOKING_FIELD_LIMITS.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onPaste={(e) => {
              // Detect when the paste would push us past maxLength so the user
              // gets a hint that their text was trimmed (browsers silently
              // truncate on maxLength). textarea selection range narrows the
              // check to whatever the paste is actually replacing.
              const pasted = e.clipboardData.getData("text") ?? "";
              const target = e.currentTarget;
              const selectionLen = (target.selectionEnd ?? 0) - (target.selectionStart ?? 0);
              const projected = notes.length - selectionLen + pasted.length;
              if (projected > BOOKING_FIELD_LIMITS.notes) {
                setPasteTrimmed(true);
              }
            }}
            aria-invalid={!!fieldErrors.notes || undefined}
            aria-describedby={fieldErrors.notes ? "booking-notes-error" : "booking-notes-counter"}
            className={cn(
              "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
              "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
              fieldErrors.notes && "border-coquelicot-500/60",
            )}
            placeholder="e.g., Wi-Fi not working, need help with email setup, laptop running slow..."
          />
          <div
            id="booking-notes-counter"
            className={cn("flex items-center justify-between gap-3 text-sm")}
          >
            <span
              className={cn(pasteTrimmed ? "text-coquelicot-600" : "text-rich-black/60")}
              aria-live="polite"
            >
              {pasteTrimmed
                ? `Pasted text was trimmed to fit the ${BOOKING_FIELD_LIMITS.notes}-character limit.`
                : " "}
            </span>
            <span
              className={cn(
                "tabular-nums",
                notes.length >= BOOKING_FIELD_LIMITS.notes - NOTES_WARN_GAP
                  ? "text-coquelicot-600 font-medium"
                  : "text-rich-black/60",
              )}
            >
              {notes.length} / {BOOKING_FIELD_LIMITS.notes}
            </span>
          </div>
          {fieldErrors.notes && (
            <p id="booking-notes-error" className={cn("text-coquelicot-600 text-sm")}>
              {fieldErrors.notes}
            </p>
          )}
        </div>

        {canInlineEstimate && (
          <div className={cn("flex flex-col gap-2")}>
            <button
              type="button"
              onClick={() => void runInlineEstimate()}
              disabled={estimating || notes.trim().length < BOOKING_FIELD_LIMITS.notesMin}
              className={cn(
                "border-russian-violet/40 text-russian-violet hover:bg-russian-violet/5 self-start rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50",
              )}
            >
              {estimating ? "Estimating..." : "Get a rough estimate"}
            </button>
            {quote && (
              <p className={cn("text-rich-black text-sm")}>
                Rough estimate:{" "}
                <strong>
                  ${quote.low} &ndash; ${quote.high}
                </strong>
                . A ballpark from your description - the final cost is confirmed before any work.
              </p>
            )}
            {quoteError && <p className={cn("text-coquelicot-600 text-sm")}>{quoteError}</p>}
          </div>
        )}
      </fieldset>

      {/* Booking summary - live recap of what's selected so the user can see
          their choices before submit. */}
      {(() => {
        const activeWindow =
          selectedDay && selectedTime
            ? (selectedDay.timeWindows.find((w) => w.value === selectedTime) ?? null)
            : null;
        const timeLabel = activeWindow
          ? subSlotLabel(activeWindow.startHour, selectedMinute)
          : null;
        const durationLabel = durationOptions.find((d) => d.value === duration)?.label ?? null;
        const combinedAddress =
          meetingType === "in-person" ? combineUnitAndAddress(unit, address) : "";
        return (
          <section
            aria-label="Your appointment so far"
            className={cn(
              "border-moonstone-500/30 bg-moonstone-600/5 flex flex-col gap-2 rounded-lg border p-4",
            )}
          >
            <div className={cn("flex items-start justify-between gap-3")}>
              <h3 className={cn("text-russian-violet text-base font-bold sm:text-lg")}>
                Your appointment
              </h3>
              {draftRestored && (
                <button
                  type="button"
                  onClick={clearDraft}
                  className={cn(
                    "text-rich-black/70 text-sm underline underline-offset-2",
                    "hover:text-rich-black focus:ring-russian-violet/30 rounded focus:outline-none focus:ring-2",
                  )}
                >
                  Clear form
                </button>
              )}
            </div>
            <dl className={cn("grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-base")}>
              <dt className={cn("text-rich-black/60")}>Length</dt>
              <dd className={cn("text-rich-black")}>
                {durationLabel ?? <span className={cn("text-rich-black/50")}>—</span>}
              </dd>

              <dt className={cn("text-rich-black/60")}>Date</dt>
              <dd className={cn("text-rich-black")}>
                {selectedDay ? (
                  selectedDay.fullLabel
                ) : (
                  <span className={cn("text-rich-black/50")}>—</span>
                )}
              </dd>

              <dt className={cn("text-rich-black/60")}>Time</dt>
              <dd className={cn("text-rich-black")}>
                {timeLabel ? (
                  <>
                    {timeLabel} <span className={cn("text-rich-black/60 text-sm")}>NZ time</span>
                  </>
                ) : (
                  <span className={cn("text-rich-black/50")}>—</span>
                )}
              </dd>

              <dt className={cn("text-rich-black/60")}>Meeting</dt>
              <dd className={cn("text-rich-black capitalize")}>
                {meetingType ? (
                  meetingType.replace("-", " ")
                ) : (
                  <span className={cn("text-rich-black/50")}>—</span>
                )}
              </dd>

              {meetingType === "in-person" && (
                <>
                  <dt className={cn("text-rich-black/60")}>Address</dt>
                  <dd className={cn("text-rich-black wrap-break-word")}>
                    {combinedAddress.trim() ? (
                      combinedAddress
                    ) : (
                      <span className={cn("text-rich-black/50")}>—</span>
                    )}
                  </dd>
                </>
              )}
            </dl>
          </section>
        );
      })()}

      {/* Cancellation / rescheduling policy - keeps expectations clear so a
          customer who later wants to change their booking knows it's easy. */}
      <p className={cn("text-rich-black/70 text-sm")}>
        Need to change or cancel? Use the link in the confirmation email any time before your
        appointment, or text/call directly.
      </p>

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
            Tap below to load the up-to-date availability - your form details will stay where they
            are.
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
      {Object.keys(fieldErrors).length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className={cn(
            "border-coquelicot-500/50 bg-coquelicot-500/10 text-rich-black rounded-md border p-4",
          )}
        >
          <p className={cn("text-base font-semibold")}>Please fix the following:</p>
          <ul className={cn("mt-1 list-disc space-y-0.5 pl-5 text-base")}>
            {Object.entries(fieldErrors).map(([key, msg]) => {
              const anchors: Record<string, string> = {
                duration: "booking-duration",
                day: "booking-day",
                time: "booking-time",
                name: "booking-name",
                email: "booking-email",
                phone: "booking-phone",
                meetingType: "booking-meeting-type",
                address: "booking-address",
                notes: "booking-notes",
              };
              const anchor = anchors[key];
              return (
                <li key={key}>
                  {anchor ? (
                    <a href={`#${anchor}`} className={cn("underline")}>
                      {msg}
                    </a>
                  ) : (
                    msg
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && (
        <p className={cn("text-coquelicot-600 text-base font-medium")} role="alert">
          {error}
        </p>
      )}

      {/* Submit band: sticky to the viewport bottom on mobile so users on a
          long form never lose sight of the action; inline on >=sm. */}
      <div
        className={cn(
          "sticky bottom-0 -mx-5 flex flex-wrap items-center gap-4 border-t",
          "border-seasalt-400/80 bg-seasalt/90 px-5 py-3 backdrop-blur-md",
          "sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none",
        )}
      >
        <Button
          type="submit"
          variant="secondary"
          size="md"
          aria-busy={submitting}
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
        {Object.keys(fieldErrors).length > 0 && (
          <a
            href="#booking-duration"
            className={cn("text-coquelicot-600 text-sm font-medium underline sm:hidden")}
          >
            {Object.keys(fieldErrors).length} issue
            {Object.keys(fieldErrors).length === 1 ? "" : "s"} - tap to review
          </a>
        )}
        {isEditMode && cancelToken && (
          <Button
            href={`/booking/cancel?token=${encodeURIComponent(cancelToken)}`}
            variant="ghost"
            size="md"
            disabled={submitting}
          >
            Cancel booking instead
          </Button>
        )}
      </div>
    </form>
  );
}
